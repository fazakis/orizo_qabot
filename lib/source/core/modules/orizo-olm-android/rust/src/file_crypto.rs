//! Bounded file AEAD with the existing XChaCha20-Poly1305 wire format.
//! Input authentication uses an unlinked ciphertext snapshot. Only after its
//! full tag verifies can any plaintext be written; rewrap never stages plaintext.
use super::BridgeError;
use chacha20::{
    XChaCha20,
    cipher::{KeyIvInit, StreamCipher, StreamCipherSeek},
};
use poly1305::{
    Poly1305,
    universal_hash::{KeyInit, UniversalHash},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use zeroize::{Zeroize, Zeroizing};

// Preserve the messaging upload limit. Memory is independent of file length.
const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
// Only locally sealed originals may exceed the wire limit; memory stays 64 KiB.
const MAX_LOCAL_FILE_BYTES: u64 = 512 * 1024 * 1024;
// Full chunks are a multiple of the Poly1305 block size. Only the last chunk
// is padded; arbitrary short reads must never introduce intermediate padding.
const CHUNK_BYTES: usize = 64 * 1024;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceAead {
    key: Vec<u8>,
    nonce: Vec<u8>,
    aad: String,
}
impl Drop for SourceAead {
    fn drop(&mut self) {
        self.key.zeroize();
        self.nonce.zeroize();
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    input_path: String,
    output_path: String,
    roots: Vec<String>,
    key: Vec<u8>,
    nonce: Vec<u8>,
    aad: String,
    decrypt: bool,
    #[serde(default)]
    local_storage: bool,
    #[serde(default)]
    expected_sha256: Option<String>,
    #[serde(default)]
    source: Option<SourceAead>,
}
impl Drop for Request {
    fn drop(&mut self) {
        self.key.zeroize();
        self.nonce.zeroize();
    }
}
fn io_error(_: std::io::Error) -> BridgeError {
    BridgeError::InvalidRequest
}
fn hex(hash: impl AsRef<[u8]>) -> String {
    hash.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// RustCrypto primitives, following RFC 8439's AEAD construction. XChaCha's
/// subkey/nonce derivation is handled by the existing RustCrypto cipher.
struct FileCipher {
    stream: XChaCha20,
    mac: Poly1305,
    aad_len: u64,
}
impl FileCipher {
    fn new(key: &[u8], nonce: &[u8], aad: &[u8]) -> Result<Self, BridgeError> {
        let mut stream =
            XChaCha20::new_from_slices(key, nonce).map_err(|_| BridgeError::InvalidRequest)?;
        let mut mac_key = Zeroizing::new([0u8; 32]);
        stream
            .try_apply_keystream(&mut *mac_key)
            .map_err(|_| BridgeError::MessageEncoding)?;
        let mut mac =
            Poly1305::new_from_slice(&*mac_key).map_err(|_| BridgeError::InvalidRequest)?;
        stream
            .try_seek(64u64)
            .map_err(|_| BridgeError::MessageEncoding)?;
        mac.update_padded(aad);
        Ok(Self {
            stream,
            mac,
            aad_len: aad.len() as u64,
        })
    }
    fn lengths(&mut self, size: u64) {
        let mut block = poly1305::Block::default();
        block[..8].copy_from_slice(&self.aad_len.to_le_bytes());
        block[8..].copy_from_slice(&size.to_le_bytes());
        self.mac.update(&[block]);
    }
    fn apply(&mut self, bytes: &mut [u8]) -> Result<(), BridgeError> {
        self.stream
            .try_apply_keystream(bytes)
            .map_err(|_| BridgeError::MessageEncoding)
    }
}

struct Temporary {
    path: PathBuf,
    file: File,
}
impl Temporary {
    fn new(parent: &Path) -> Result<Self, BridgeError> {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|_| BridgeError::InvalidRequest)?;
        let path = parent.join(format!(".crypto-{:x}.tmp", u128::from_le_bytes(random)));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(&path).map_err(io_error)?;
        Ok(Self { path, file })
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}
fn require_eof(file: &mut File) -> Result<(), BridgeError> {
    let mut extra = [0];
    if file.read(&mut extra).map_err(io_error)? != 0 {
        return Err(BridgeError::InvalidRequest);
    }
    Ok(())
}

/// Authenticate and snapshot the exact ciphertext bytes being verified. Reading
/// the source twice would allow source mutation between validation/decryption.
fn authenticate(
    input: &mut File,
    parent: &Path,
    size: u64,
    cipher: &mut FileCipher,
    expected: Option<&str>,
    buffer: &mut [u8],
) -> Result<(Temporary, String), BridgeError> {
    let mut snapshot = Temporary::new(parent)?;
    // Both mobile targets are Unix: no named ciphertext scratch survives a crash.
    #[cfg(unix)]
    fs::remove_file(&snapshot.path).map_err(io_error)?;
    let mut digest = Sha256::new();
    let mut remaining = size;
    while remaining > 0 {
        let count = remaining.min(buffer.len() as u64) as usize;
        let chunk = &mut buffer[..count];
        input.read_exact(chunk).map_err(io_error)?;
        cipher.mac.update_padded(chunk);
        digest.update(&*chunk);
        snapshot.file.write_all(chunk).map_err(io_error)?;
        remaining -= count as u64;
    }
    let mut tag = poly1305::Tag::default();
    input.read_exact(&mut tag).map_err(io_error)?;
    digest.update(tag);
    require_eof(input)?;
    let digest = hex(digest.finalize());
    cipher.lengths(size);
    // UniversalHash::verify is constant-time. No decrypt or plaintext write yet.
    let mac = std::mem::replace(&mut cipher.mac, Poly1305::new(&Default::default()));
    mac.verify(&tag).map_err(|_| BridgeError::Decryption)?;
    if expected.is_some_and(|expected| expected != digest) {
        return Err(BridgeError::Decryption);
    }
    snapshot.file.seek(SeekFrom::Start(0)).map_err(io_error)?;
    Ok((snapshot, digest))
}

pub(super) fn transform(payload: &str) -> Result<Value, BridgeError> {
    let request: Request =
        serde_json::from_str(payload).map_err(|_| BridgeError::InvalidRequest)?;
    let invalid = || BridgeError::InvalidRequest;
    if request.key.len() != 32 || request.nonce.len() != 24 || request.aad.len() > 4096 {
        return Err(invalid());
    }
    if request.source.as_ref().is_some_and(|source| {
        request.decrypt
            || source.key.len() != 32
            || source.nonce.len() != 24
            || source.aad.len() > 4096
    }) {
        return Err(invalid());
    }
    let roots: Vec<_> = request
        .roots
        .iter()
        .filter_map(|r| fs::canonicalize(r).ok())
        .collect();
    let input_path = fs::canonicalize(&request.input_path).map_err(|_| invalid())?;
    let output = PathBuf::from(&request.output_path);
    let parent = fs::canonicalize(output.parent().ok_or_else(invalid)?).map_err(|_| invalid())?;
    if !roots.iter().any(|r| input_path.starts_with(r))
        || !roots.iter().any(|r| parent.starts_with(r))
    {
        return Err(invalid());
    }
    let output = parent.join(output.file_name().ok_or_else(invalid)?);
    if input_path == output || output.is_symlink() {
        return Err(invalid());
    }
    let mut input = File::open(input_path).map_err(io_error)?;
    let metadata = input.metadata().map_err(io_error)?;
    if !metadata.is_file() {
        return Err(invalid());
    }
    let input_size = metadata.len();
    let encrypted_input = request.decrypt || request.source.is_some();
    let plaintext_size = if encrypted_input {
        input_size.checked_sub(16).ok_or_else(invalid)?
    } else {
        input_size
    };
    let local_only = request.local_storage
        && request.source.is_none()
        && (request.aad.starts_with("message-local-bytes-v1:")
            || request.aad.starts_with("message-local-record-v1:"));
    let limit = if local_only {
        MAX_LOCAL_FILE_BYTES
    } else {
        MAX_FILE_BYTES
    };
    if plaintext_size > limit {
        return Err(invalid());
    }
    let mut buffer = Zeroizing::new(vec![0u8; CHUNK_BYTES]);
    let mut destination_cipher =
        FileCipher::new(&request.key, &request.nonce, request.aad.as_bytes())?;
    let mut source_cipher = request
        .source
        .as_ref()
        .map(|s| FileCipher::new(&s.key, &s.nonce, s.aad.as_bytes()))
        .transpose()?;
    let mut snapshot = None;
    let mut ciphertext_sha256 = None;
    if encrypted_input {
        let cipher = if request.decrypt {
            &mut destination_cipher
        } else {
            source_cipher.as_mut().ok_or_else(invalid)?
        };
        let (copy, digest) = authenticate(
            &mut input,
            &parent,
            plaintext_size,
            cipher,
            request.expected_sha256.as_deref(),
            &mut buffer,
        )?;
        snapshot = Some(copy);
        if request.decrypt {
            ciphertext_sha256 = Some(digest);
        }
    }
    // This is the first possible plaintext file creation, after authentication.
    let mut temporary = Temporary::new(&parent)?;
    let source = match &mut snapshot {
        Some(s) => &mut s.file,
        None => &mut input,
    };
    let mut remaining = plaintext_size;
    let mut digest = Sha256::new();
    while remaining > 0 {
        let count = remaining.min(CHUNK_BYTES as u64) as usize;
        let chunk = &mut buffer[..count];
        source.read_exact(chunk).map_err(io_error)?;
        if let Some(cipher) = &mut source_cipher {
            cipher.apply(chunk)?;
        }
        destination_cipher.apply(chunk)?;
        if !request.decrypt {
            destination_cipher.mac.update_padded(chunk);
            digest.update(&*chunk);
        }
        temporary.file.write_all(chunk).map_err(io_error)?;
        chunk.zeroize();
        remaining -= count as u64;
    }
    require_eof(source)?;
    if !request.decrypt {
        destination_cipher.lengths(plaintext_size);
        let tag = destination_cipher.mac.finalize();
        temporary.file.write_all(&tag).map_err(io_error)?;
        digest.update(tag);
        ciphertext_sha256 = Some(hex(digest.finalize()));
    }
    temporary.file.sync_all().map_err(io_error)?;
    fs::rename(&temporary.path, &output).map_err(io_error)?;
    Ok(
        json!({"inputSize":input_size,"plaintextSize":plaintext_size,
        "outputSize":plaintext_size + if request.decrypt {0} else {16},
        "ciphertextSha256":ciphertext_sha256.ok_or_else(invalid)?}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    use chacha20poly1305::{XChaCha20Poly1305, XNonce, aead::AeadInOut};
    fn fixture() -> Value {
        serde_json::from_str(include_str!("../tests/fixtures/file-crypto-noble.json")).unwrap()
    }
    fn workspace() -> PathBuf {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let path =
            std::env::temp_dir().join(format!("orizo-file-test-{:x}", u128::from_le_bytes(random)));
        fs::create_dir_all(&path).unwrap();
        path
    }
    fn bytes(value: &Value) -> Vec<u8> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap() as u8)
            .collect()
    }
    fn request(root: &std::path::Path, decrypt: bool) -> Value {
        let f = fixture();
        json!({"roots":[root],"inputPath":root.join("input"),"outputPath":root.join("output"),"key":f["key"],"nonce":f["nonce"],"aad":f["aad"],"decrypt":decrypt})
    }
    #[test]
    fn encrypt_and_decrypt_match_existing_noble_wire_format() {
        let root = workspace();
        let f = fixture();
        fs::write(root.join("input"), bytes(&f["plaintext"])).unwrap();
        let result = transform(&request(&root, false).to_string()).unwrap();
        assert_eq!(
            fs::read(root.join("output")).unwrap(),
            bytes(&f["ciphertext"])
        );
        assert_eq!(result["ciphertextSha256"], f["sha256"]);
        fs::write(root.join("input"), bytes(&f["ciphertext"])).unwrap();
        let mut r = request(&root, true);
        r["expectedSha256"] = f["sha256"].clone();
        transform(&r.to_string()).unwrap();
        assert_eq!(
            fs::read(root.join("output")).unwrap(),
            bytes(&f["plaintext"])
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corruption_wrong_aad_and_hash_never_replace_destination() {
        let root = workspace();
        let f = fixture();
        fs::write(root.join("output"), b"existing").unwrap();
        let mut cipher = bytes(&f["ciphertext"]);
        cipher[0] ^= 1;
        fs::write(root.join("input"), cipher).unwrap();
        assert!(transform(&request(&root, true).to_string()).is_err());
        fs::write(root.join("input"), bytes(&f["ciphertext"])).unwrap();
        let mut r = request(&root, true);
        r["aad"] = json!("another-conversation");
        assert!(transform(&r.to_string()).is_err());
        let mut r = request(&root, true);
        r["expectedSha256"] = json!("wrong");
        assert!(transform(&r.to_string()).is_err());
        assert_eq!(fs::read(root.join("output")).unwrap(), b"existing");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn reencrypt_authenticates_local_cipher_and_matches_existing_wire_without_plaintext_files() {
        let root = workspace();
        let f = fixture();
        let source_key = vec![7u8; 32];
        let source_nonce = vec![8u8; 24];
        let mut local = bytes(&f["plaintext"]);
        XChaCha20Poly1305::new_from_slice(&source_key)
            .unwrap()
            .encrypt_in_place(
                &XNonce::try_from(source_nonce.as_slice()).unwrap(),
                b"local-context",
                &mut local,
            )
            .unwrap();
        fs::write(root.join("input"), &local).unwrap();
        let mut r = request(&root, false);
        r["source"] = json!({"key":source_key,"nonce":source_nonce,"aad":"local-context"});
        let result = transform(&r.to_string()).unwrap();
        assert_eq!(fs::read(root.join("input")).unwrap(), local);
        assert_eq!(
            fs::read(root.join("output")).unwrap(),
            bytes(&f["ciphertext"])
        );
        assert_eq!(
            result["plaintextSize"].as_u64().unwrap(),
            bytes(&f["plaintext"]).len() as u64
        );
        assert_eq!(result["ciphertextSha256"], f["sha256"]);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::write(root.join("output"), b"preserve").unwrap();
        r["source"]["aad"] = json!("wrong-context");
        assert!(transform(&r.to_string()).is_err());
        assert_eq!(fs::read(root.join("output")).unwrap(), b"preserve");
        r["source"]["aad"] = json!("local-context");
        r["decrypt"] = json!(true);
        assert!(transform(&r.to_string()).is_err());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn paths_and_size_are_bounded() {
        let root = workspace();
        let outside = workspace();
        fs::write(outside.join("input"), b"private").unwrap();
        let mut r = request(&root, false);
        r["inputPath"] = json!(outside.join("input"));
        assert!(transform(&r.to_string()).is_err());
        let file = File::create(root.join("input")).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        assert!(transform(&request(&root, false).to_string()).is_err());
        assert!(!root.join("output").exists());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
    #[test]
    fn large_local_original_does_not_raise_wire_or_reencrypt_limit() {
        let root = workspace();
        let file = File::create(root.join("input")).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        let mut r = request(&root, false);
        r["localStorage"] = json!(true);
        assert!(transform(&r.to_string()).is_err()); // wire AAD cannot opt in
        r["aad"] = json!("message-local-bytes-v1:outbox-attachment:test");
        assert!(transform(&r.to_string()).is_ok());
        r["source"] = json!({"key": r["key"], "nonce": r["nonce"], "aad": r["aad"]});
        r["inputPath"] = json!(root.join("output"));
        r["outputPath"] = json!(root.join("wire"));
        assert!(transform(&r.to_string()).is_err()); // never upload a large original
        let oversized = File::create(root.join("oversized")).unwrap();
        oversized.set_len(MAX_LOCAL_FILE_BYTES + 1).unwrap();
        r["source"] = serde_json::Value::Null;
        r["inputPath"] = json!(root.join("oversized"));
        assert!(transform(&r.to_string()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn chunk_boundaries_match_monolithic_aead_and_round_trip() {
        let root = workspace();
        let f = fixture();
        let key = bytes(&f["key"]);
        let nonce = bytes(&f["nonce"]);
        for size in [
            0,
            1,
            15,
            16,
            17,
            63,
            64,
            65,
            CHUNK_BYTES - 1,
            CHUNK_BYTES,
            CHUNK_BYTES + 1,
            CHUNK_BYTES * 2,
            CHUNK_BYTES * 2 + 15,
            CHUNK_BYTES * 3 + 17,
            MAX_FILE_BYTES as usize,
        ] {
            let plaintext: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
            let mut expected = plaintext.clone();
            XChaCha20Poly1305::new_from_slice(&key)
                .unwrap()
                .encrypt_in_place(
                    &XNonce::try_from(nonce.as_slice()).unwrap(),
                    f["aad"].as_str().unwrap().as_bytes(),
                    &mut expected,
                )
                .unwrap();
            fs::write(root.join("input"), &plaintext).unwrap();
            let result = transform(&request(&root, false).to_string()).unwrap();
            assert_eq!(result["outputSize"], size + 16);
            assert_eq!(
                fs::read(root.join("output")).unwrap(),
                expected,
                "length {size}"
            );
            assert_eq!(result["ciphertextSha256"], hex(Sha256::digest(&expected)));
            fs::write(root.join("input"), &expected).unwrap();
            transform(&request(&root, true).to_string()).unwrap();
            assert_eq!(fs::read(root.join("output")).unwrap(), plaintext);
            if size > CHUNK_BYTES {
                *expected.last_mut().unwrap() ^= 1;
                fs::write(root.join("input"), &expected).unwrap();
                fs::write(root.join("output"), b"preserve").unwrap();
                assert!(transform(&request(&root, true).to_string()).is_err());
                assert_eq!(fs::read(root.join("output")).unwrap(), b"preserve");
                assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
            }
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn authenticated_snapshot_is_independent_of_later_source_mutation() {
        let root = workspace();
        let f = fixture();
        fs::write(root.join("input"), bytes(&f["ciphertext"])).unwrap();
        let key = bytes(&f["key"]);
        let nonce = bytes(&f["nonce"]);
        let mut cipher =
            FileCipher::new(&key, &nonce, f["aad"].as_str().unwrap().as_bytes()).unwrap();
        let mut buffer = vec![0u8; CHUNK_BYTES];
        let (mut snapshot, _) = authenticate(
            &mut File::open(root.join("input")).unwrap(),
            &root,
            bytes(&f["plaintext"]).len() as u64,
            &mut cipher,
            None,
            &mut buffer,
        )
        .unwrap();
        fs::write(root.join("input"), b"changed source").unwrap();
        let mut saved = vec![];
        snapshot.file.read_to_end(&mut saved).unwrap();
        cipher.apply(&mut saved).unwrap();
        assert_eq!(saved, bytes(&f["plaintext"]));
        #[cfg(unix)]
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        drop(snapshot);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn multichunk_rewrap_preserves_wire_format_and_cleans_failed_output() {
        let root = workspace();
        let f = fixture();
        let plaintext: Vec<u8> = (0..CHUNK_BYTES * 3 + 17).map(|i| (i % 251) as u8).collect();
        let mut local = plaintext.clone();
        let source_key = vec![7u8; 32];
        let source_nonce = vec![8u8; 24];
        XChaCha20Poly1305::new_from_slice(&source_key)
            .unwrap()
            .encrypt_in_place(
                &XNonce::try_from(source_nonce.as_slice()).unwrap(),
                b"local",
                &mut local,
            )
            .unwrap();
        let mut expected = plaintext;
        XChaCha20Poly1305::new_from_slice(&bytes(&f["key"]))
            .unwrap()
            .encrypt_in_place(
                &XNonce::try_from(bytes(&f["nonce"]).as_slice()).unwrap(),
                f["aad"].as_str().unwrap().as_bytes(),
                &mut expected,
            )
            .unwrap();
        fs::write(root.join("input"), local).unwrap();
        let mut r = request(&root, false);
        r["source"] = json!({"key":source_key,"nonce":source_nonce,"aad":"local"});
        transform(&r.to_string()).unwrap();
        assert_eq!(fs::read(root.join("output")).unwrap(), expected);
        // Failed publish must not retain a plaintext or ciphertext scratch file.
        fs::create_dir(root.join("destination-directory")).unwrap();
        r["outputPath"] = json!(root.join("destination-directory"));
        assert!(transform(&r.to_string()).is_err());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 3);
        fs::remove_dir_all(root).unwrap();
    }
}
