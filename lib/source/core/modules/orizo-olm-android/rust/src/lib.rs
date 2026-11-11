mod file_crypto;
mod local_records;
mod message_aead;
mod message_projection;
mod notification_envelopes;
mod recovery_envelopes;

use std::{
    collections::BTreeMap,
    panic::{AssertUnwindSafe, catch_unwind},
};

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
#[cfg(target_os = "android")]
use jni::{
    JNIEnv,
    objects::{JByteArray, JClass, JString},
    sys::jbyteArray,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vodozemac::{
    Curve25519PublicKey, Ed25519PublicKey, Ed25519Signature,
    olm::{
        Account, AccountPickle, OlmMessage, Session, SessionConfig, SessionCreationError,
        SessionPickle,
    },
};
use zeroize::Zeroize;

const STATE_REVISION: u32 = 2;
const LEGACY_STATE_REVISION: u32 = 1;
const MAX_PENDING_DECRYPTS: usize = 4096;
const ENGINE_VERSION: &str = "vodozemac-0.10.0+2c3d967b4cd5";
const MAX_SESSIONS_PER_DEVICE: usize = 8;
const BRIDGE_MAGIC: u32 = 0x4f4c4d42;
const BRIDGE_VERSION: u8 = 1;
const STATE_MAGIC: &[u8; 4] = b"OOS1";
const JOURNALED_STATE_MAGIC: &[u8; 4] = b"OOS2";
const STATE_NONCE_BYTES: usize = 24;
const MAX_DECRYPT_BATCH: usize = 500;
const RECOVERY_KDF_MEMORY_KIB: u32 = 32 * 1024;
const RECOVERY_KDF_ITERATIONS: u32 = 3;
const RECOVERY_KDF_PARALLELISM: u32 = 1;
const RECOVERY_KDF_OUTPUT_BYTES: usize = 32;
const RECOVERY_KDF_SALT_BYTES: usize = 16;
const MAX_RECOVERY_PASSWORD_BYTES: usize = 1024;

#[derive(Debug, Error)]
enum RecoveryKdfError {
    #[error("The recovery password KDF input is invalid.")]
    InvalidInput,
    #[error("The recovery password KDF failed.")]
    Failed,
}

fn derive_recovery_passphrase_key(
    password: &[u8],
    salt: &[u8],
) -> Result<[u8; RECOVERY_KDF_OUTPUT_BYTES], RecoveryKdfError> {
    if password.is_empty()
        || password.len() > MAX_RECOVERY_PASSWORD_BYTES
        || salt.len() != RECOVERY_KDF_SALT_BYTES
    {
        return Err(RecoveryKdfError::InvalidInput);
    }
    let params = Params::new(
        RECOVERY_KDF_MEMORY_KIB,
        RECOVERY_KDF_ITERATIONS,
        RECOVERY_KDF_PARALLELISM,
        Some(RECOVERY_KDF_OUTPUT_BYTES),
    )
    .map_err(|_| RecoveryKdfError::Failed)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut output = [0u8; RECOVERY_KDF_OUTPUT_BYTES];
    if argon2
        .hash_password_into(password, salt, &mut output)
        .is_err()
    {
        output.zeroize();
        return Err(RecoveryKdfError::Failed);
    }
    Ok(output)
}

#[derive(Debug, Error)]
enum BridgeError {
    #[error("The native Olm request is invalid.")]
    InvalidRequest,
    #[error("The native Olm account is not available.")]
    AccountUnavailable,
    #[error("The legacy Olm account could not be imported.")]
    LegacyAccountImport,
    #[error("The imported Olm identity does not match the registered device.")]
    IdentityMismatch,
    #[error("The Olm public key is invalid.")]
    InvalidPublicKey,
    #[error("The Olm signature is invalid.")]
    InvalidSignature,
    #[error("The Olm session could not be created.")]
    SessionCreation,
    #[error("The matching Olm session is not available.")]
    SessionUnavailable,
    #[error("The one-time key for this historical Olm message is not available.")]
    OneTimeKeyUnavailable,
    #[error("The Olm message could not be encoded.")]
    MessageEncoding,
    #[error("The Olm message could not be decrypted.")]
    Decryption,
    #[error("The native Olm state is invalid.")]
    InvalidState,
    #[error("Pending decrypted messages must be saved before more envelopes can be opened.")]
    JournalFull,
}

impl BridgeError {
    fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest => "E_OLM_INVALID_REQUEST",
            Self::AccountUnavailable => "E_OLM_ACCOUNT_UNAVAILABLE",
            Self::LegacyAccountImport => "E_OLM_LEGACY_ACCOUNT_IMPORT",
            Self::IdentityMismatch => "E_OLM_IDENTITY_MISMATCH",
            Self::InvalidPublicKey => "E_OLM_INVALID_PUBLIC_KEY",
            Self::InvalidSignature => "E_OLM_INVALID_SIGNATURE",
            Self::SessionCreation => "E_OLM_SESSION_CREATION",
            Self::SessionUnavailable => "E_OLM_SESSION_UNAVAILABLE",
            Self::OneTimeKeyUnavailable => "E_OLM_ONE_TIME_KEY_UNAVAILABLE",
            Self::MessageEncoding => "E_OLM_MESSAGE_ENCODING",
            Self::Decryption => "E_OLM_DECRYPTION",
            Self::InvalidState => "E_OLM_INVALID_STATE",
            Self::JournalFull => "E_OLM_JOURNAL_FULL",
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSession {
    device_id: String,
    identity_key: String,
    session_generation: u64,
    pickle: SessionPickle,
}

#[derive(Clone, Serialize, Deserialize)]
struct PendingDecryptResult {
    fingerprint: String,
    result: Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredState {
    revision: u32,
    account_id: String,
    account: AccountPickle,
    sessions: Vec<StoredSession>,
    #[serde(default)]
    journal_enabled: bool,
    #[serde(default)]
    pending_decrypts: BTreeMap<String, PendingDecryptResult>,
}

struct RuntimeSession {
    device_id: String,
    identity_key: String,
    session_generation: u64,
    session: Session,
}

struct RuntimeState {
    account_id: String,
    account: Account,
    sessions: Vec<RuntimeSession>,
    journal_enabled: bool,
    pending_decrypts: BTreeMap<String, PendingDecryptResult>,
}

impl RuntimeState {
    fn from_bytes(
        raw: Option<&[u8]>,
        account_id: &str,
        state_key: &[u8; 32],
    ) -> Result<Self, BridgeError> {
        let raw = raw
            .filter(|value| !value.is_empty())
            .ok_or(BridgeError::AccountUnavailable)?;
        let stored = open_stored_state(raw, account_id, state_key)?;
        if ![LEGACY_STATE_REVISION, STATE_REVISION].contains(&stored.revision)
            || stored.account_id != account_id
            || (stored.revision == LEGACY_STATE_REVISION
                && (stored.journal_enabled || !stored.pending_decrypts.is_empty()))
            || (stored.revision == STATE_REVISION && !stored.journal_enabled)
        {
            return Err(BridgeError::InvalidState);
        }
        Ok(Self {
            journal_enabled: stored.journal_enabled,
            pending_decrypts: stored.pending_decrypts,
            account_id: stored.account_id,
            account: Account::from_pickle(stored.account),
            sessions: stored
                .sessions
                .into_iter()
                .map(|value| {
                    Ok(RuntimeSession {
                        device_id: value.device_id,
                        identity_key: value.identity_key,
                        session_generation: value.session_generation,
                        session: Session::from_pickle(value.pickle),
                    })
                })
                .collect::<Result<Vec<_>, BridgeError>>()?,
        })
    }

    fn into_bytes(self, state_key: &[u8; 32]) -> Result<Vec<u8>, BridgeError> {
        seal_stored_state(
            &StoredState {
                revision: if self.journal_enabled {
                    STATE_REVISION
                } else {
                    LEGACY_STATE_REVISION
                },
                journal_enabled: self.journal_enabled,
                pending_decrypts: self.pending_decrypts,
                account_id: self.account_id,
                account: self.account.pickle(),
                sessions: self
                    .sessions
                    .into_iter()
                    .map(|value| StoredSession {
                        device_id: value.device_id,
                        identity_key: value.identity_key,
                        session_generation: value.session_generation,
                        pickle: value.session.pickle(),
                    })
                    .collect(),
            },
            state_key,
        )
    }
}

fn state_aad(account_id: &str, revision: u32) -> Vec<u8> {
    format!("orizo-olm-native-state-v{revision}:{account_id}").into_bytes()
}

fn open_stored_state(
    raw: &[u8],
    account_id: &str,
    state_key: &[u8; 32],
) -> Result<StoredState, BridgeError> {
    if raw.len() <= STATE_MAGIC.len() + STATE_NONCE_BYTES
        || (&raw[..STATE_MAGIC.len()] != STATE_MAGIC
            && &raw[..STATE_MAGIC.len()] != JOURNALED_STATE_MAGIC)
    {
        return Err(BridgeError::InvalidState);
    }
    let nonce_start = STATE_MAGIC.len();
    let ciphertext_start = nonce_start + STATE_NONCE_BYTES;
    let cipher = XChaCha20Poly1305::new(state_key.into());
    let nonce = XNonce::from(
        <[u8; STATE_NONCE_BYTES]>::try_from(&raw[nonce_start..ciphertext_start])
            .map_err(|_| BridgeError::InvalidState)?,
    );
    let mut plaintext = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &raw[ciphertext_start..],
                aad: &state_aad(
                    account_id,
                    if &raw[..4] == JOURNALED_STATE_MAGIC {
                        STATE_REVISION
                    } else {
                        LEGACY_STATE_REVISION
                    },
                ),
            },
        )
        .map_err(|_| BridgeError::InvalidState)?;
    let parsed: Result<StoredState, _> =
        serde_json::from_slice(&plaintext).map_err(|_| BridgeError::InvalidState);
    plaintext.zeroize();
    let parsed = parsed?;
    let expected_revision = if &raw[..4] == JOURNALED_STATE_MAGIC {
        STATE_REVISION
    } else {
        LEGACY_STATE_REVISION
    };
    if parsed.revision != expected_revision {
        return Err(BridgeError::InvalidState);
    }
    Ok(parsed)
}

fn seal_stored_state(state: &StoredState, state_key: &[u8; 32]) -> Result<Vec<u8>, BridgeError> {
    let mut plaintext = serde_json::to_vec(state).map_err(|_| BridgeError::InvalidState)?;
    let mut nonce = [0u8; STATE_NONCE_BYTES];
    if getrandom::fill(&mut nonce).is_err() {
        plaintext.zeroize();
        return Err(BridgeError::InvalidState);
    }
    let cipher = XChaCha20Poly1305::new(state_key.into());
    let xnonce = XNonce::from(nonce);
    let ciphertext = cipher.encrypt(
        &xnonce,
        Payload {
            msg: &plaintext,
            aad: &state_aad(&state.account_id, state.revision),
        },
    );
    plaintext.zeroize();
    let ciphertext = ciphertext.map_err(|_| BridgeError::InvalidState)?;
    let mut output = Vec::with_capacity(STATE_MAGIC.len() + STATE_NONCE_BYTES + ciphertext.len());
    output.extend_from_slice(if state.revision == STATE_REVISION {
        JOURNALED_STATE_MAGIC
    } else {
        STATE_MAGIC
    });
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);
    nonce.zeroize();
    Ok(output)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapRequest {
    account_id: String,
    #[serde(default)]
    legacy_account_pickle: Option<String>,
    #[serde(default)]
    legacy_pickle_key: Option<String>,
    #[serde(default)]
    legacy_sessions: Vec<LegacySession>,
    #[serde(default)]
    expected_identity_key: Option<String>,
    #[serde(default)]
    expected_signing_key: Option<String>,
    #[serde(default = "default_one_time_key_count")]
    one_time_key_count: usize,
}

const fn default_one_time_key_count() -> usize {
    40
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacySession {
    device_id: String,
    identity_key: String,
    #[serde(default)]
    session_generation: u64,
    #[serde(default)]
    session_id: String,
    pickle: String,
    #[serde(default)]
    pickle_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CountRequest {
    count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FallbackKeyRequest {
    device_id: String,
    #[serde(default)]
    rotate: bool,
}

/// Domain-separated statement a device signs for its published fallback key.
/// Senders verify it with the device's certificate-bound signing key, so a
/// server cannot substitute a fallback key it controls (audit F19).
fn fallback_key_statement(device_id: &str, key_id: &str, public_key: &str) -> String {
    format!("orizo-message-fallback-key-v1\n{device_id}\n{key_id}\n{public_key}")
}

fn signed_fallback_keys(account: &Account, device_id: &str) -> Vec<Value> {
    account
        .fallback_key()
        .into_iter()
        .map(|(key_id, key)| {
            let key_id = key_id.to_base64();
            let public_key = key.to_base64();
            let signature = account
                .sign(fallback_key_statement(device_id, &key_id, &public_key))
                .to_base64();
            json!({ "keyId": key_id, "publicKey": public_key, "signature": signature })
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignRequest {
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyRequest {
    signing_key: String,
    message: String,
    signature: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionTarget {
    device_id: String,
    identity_key: String,
    #[serde(default)]
    session_generation: u64,
}

#[derive(Deserialize)]
struct SessionsRequest {
    recipients: Vec<SessionTarget>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptTarget {
    device_id: String,
    identity_key: String,
    #[serde(default)]
    session_generation: u64,
    #[serde(default)]
    one_time_key: Option<String>,
    plaintext: String,
}

#[derive(Deserialize)]
struct EncryptRequest {
    recipients: Vec<EncryptTarget>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecryptRequest {
    #[serde(default)]
    replay_id: String,
    device_id: String,
    identity_key: String,
    #[serde(default)]
    session_generation: u64,
    message_type: usize,
    ciphertext: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexedDecryptRequest {
    #[serde(default)]
    replay_id: String,
    index: usize,
    device_id: String,
    identity_key: String,
    #[serde(default)]
    session_generation: u64,
    message_type: usize,
    ciphertext: String,
}

impl From<IndexedDecryptRequest> for DecryptRequest {
    fn from(value: IndexedDecryptRequest) -> Self {
        Self {
            replay_id: value.replay_id,
            device_id: value.device_id,
            identity_key: value.identity_key,
            session_generation: value.session_generation,
            message_type: value.message_type,
            ciphertext: value.ciphertext,
        }
    }
}

#[derive(Deserialize)]
struct DecryptBatchRequest {
    envelopes: Vec<IndexedDecryptRequest>,
}

#[derive(Serialize)]
struct NativeError {
    code: &'static str,
    message: String,
}

struct OperationResult {
    state: Option<Vec<u8>>,
    result: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountNamespace {
    account_id: String,
}

fn parse<T: DeserializeOwned>(payload: &str) -> Result<T, BridgeError> {
    serde_json::from_str(payload).map_err(|_| BridgeError::InvalidRequest)
}

fn unpublished_one_time_keys(account: &Account) -> BTreeMap<String, String> {
    account
        .one_time_keys()
        .into_iter()
        .map(|(key_id, key)| (key_id.to_base64(), key.to_base64()))
        .collect()
}

fn public_account(account: &Account) -> Value {
    json!({
        "identityKey": account.curve25519_key().to_base64(),
        "signingKey": account.ed25519_key().to_base64(),
        "maxOneTimeKeys": account.max_number_of_one_time_keys(),
        "unpublishedOneTimeKeys": unpublished_one_time_keys(account),
    })
}

fn validate_expected_identity(
    account: &Account,
    identity_key: Option<&str>,
    signing_key: Option<&str>,
) -> Result<(), BridgeError> {
    if identity_key.is_some_and(|value| value != account.curve25519_key().to_base64())
        || signing_key.is_some_and(|value| value != account.ed25519_key().to_base64())
    {
        return Err(BridgeError::IdentityMismatch);
    }
    Ok(())
}

fn bootstrap(
    payload: &str,
    existing_state: Option<&[u8]>,
    state_key: &[u8; 32],
) -> Result<OperationResult, BridgeError> {
    let request: BootstrapRequest = parse(payload)?;
    if request.account_id.is_empty() {
        return Err(BridgeError::InvalidRequest);
    }
    if existing_state.is_some_and(|value| !value.is_empty()) {
        let state = RuntimeState::from_bytes(existing_state, &request.account_id, state_key)?;
        validate_expected_identity(
            &state.account,
            request.expected_identity_key.as_deref(),
            request.expected_signing_key.as_deref(),
        )?;
        let mut result = public_account(&state.account);
        result["created"] = json!(false);
        result["migrated"] = json!(false);
        result["activationRequired"] = json!(false);
        result["importedSessionCount"] = json!(0);
        result["skippedSessionCount"] = json!(0);
        return Ok(OperationResult {
            state: None,
            result,
        });
    }

    let migrated = request.legacy_account_pickle.is_some();
    let mut account = match (
        request.legacy_account_pickle,
        request.legacy_pickle_key.as_deref(),
    ) {
        (Some(pickle), Some(key)) => Account::from_libolm_pickle(&pickle, key.as_bytes())
            .map_err(|_| BridgeError::LegacyAccountImport)?,
        (None, None) => {
            let mut account = Account::new();
            let count = request
                .one_time_key_count
                .min(account.max_number_of_one_time_keys());
            account.generate_one_time_keys(count);
            account
        }
        _ => return Err(BridgeError::InvalidRequest),
    };

    validate_expected_identity(
        &account,
        request.expected_identity_key.as_deref(),
        request.expected_signing_key.as_deref(),
    )?;

    let mut sessions = Vec::with_capacity(request.legacy_sessions.len());
    let mut skipped_session_count = 0usize;
    for legacy in request.legacy_sessions {
        let Some(pickle_key) = legacy
            .pickle_key
            .as_deref()
            .or(request.legacy_pickle_key.as_deref())
        else {
            skipped_session_count += 1;
            continue;
        };
        let Ok(session) = Session::from_libolm_pickle(&legacy.pickle, pickle_key.as_bytes()) else {
            skipped_session_count += 1;
            continue;
        };
        let imported_session_id = session.session_id();
        if legacy.device_id.is_empty()
            || Curve25519PublicKey::from_base64(&legacy.identity_key).is_err()
            || (!legacy.session_id.is_empty() && legacy.session_id != imported_session_id)
            || sessions.iter().any(|candidate: &RuntimeSession| {
                candidate.session.session_id() == imported_session_id
            })
            || sessions
                .iter()
                .filter(|candidate| candidate.device_id == legacy.device_id)
                .count()
                >= MAX_SESSIONS_PER_DEVICE
        {
            skipped_session_count += 1;
            continue;
        }
        sessions.push(RuntimeSession {
            device_id: legacy.device_id,
            identity_key: legacy.identity_key,
            session_generation: legacy.session_generation,
            session,
        });
    }
    let imported_session_count = sessions.len();
    // An imported libolm account can legitimately have no unpublished keys.
    // Key replenishment remains an explicit caller operation after server
    // registration inventory has been checked.
    if !migrated && account.one_time_keys().is_empty() && request.one_time_key_count > 0 {
        let count = request
            .one_time_key_count
            .min(account.max_number_of_one_time_keys());
        account.generate_one_time_keys(count);
    }

    let mut result = public_account(&account);
    result["created"] = json!(!migrated);
    result["migrated"] = json!(migrated);
    result["activationRequired"] = json!(true);
    result["importedSessionCount"] = json!(imported_session_count);
    result["skippedSessionCount"] = json!(skipped_session_count);
    let state = RuntimeState {
        account_id: request.account_id,
        journal_enabled: false,
        pending_decrypts: BTreeMap::new(),
        account,
        sessions,
    }
    .into_bytes(state_key)?;
    Ok(OperationResult {
        state: Some(state),
        result,
    })
}

fn clone_session(session: &Session) -> Result<Session, BridgeError> {
    let encoded = serde_json::to_vec(&session.pickle()).map_err(|_| BridgeError::InvalidState)?;
    let pickle: SessionPickle =
        serde_json::from_slice(&encoded).map_err(|_| BridgeError::InvalidState)?;
    Ok(Session::from_pickle(pickle))
}

fn decode_message(message_type: usize, ciphertext: &str) -> Result<OlmMessage, BridgeError> {
    serde_json::from_value(json!({ "type": message_type, "body": ciphertext }))
        .map_err(|_| BridgeError::MessageEncoding)
}

fn encode_message(message: &OlmMessage) -> Result<(usize, String), BridgeError> {
    let encoded = serde_json::to_value(message).map_err(|_| BridgeError::MessageEncoding)?;
    let message_type = encoded
        .get("type")
        .and_then(Value::as_u64)
        .ok_or(BridgeError::MessageEncoding)? as usize;
    let body = encoded
        .get("body")
        .and_then(Value::as_str)
        .ok_or(BridgeError::MessageEncoding)?
        .to_owned();
    Ok((message_type, body))
}

fn matching_session(session: &RuntimeSession, target: &SessionTarget) -> bool {
    session.device_id == target.device_id
        && session.identity_key == target.identity_key
        && session.session_generation == target.session_generation
}

fn clear_account_one_time_keys(account: &Account) -> Result<Account, BridgeError> {
    // vodozemac intentionally retains far more private OTKs than its public
    // upload target so late pre-key messages remain decryptable. A server-side
    // session-generation reset is the one case where those private halves are
    // known to be invalid. Rebuild the pinned AccountPickle with empty OTK maps
    // while preserving identity/signing keys and its monotonic key counter.
    let mut pickle =
        serde_json::to_value(account.pickle()).map_err(|_| BridgeError::InvalidState)?;
    let one_time_keys = pickle
        .get_mut("one_time_keys")
        .and_then(Value::as_object_mut)
        .ok_or(BridgeError::InvalidState)?;
    one_time_keys.insert("public_keys".to_owned(), json!({}));
    one_time_keys.insert("private_keys".to_owned(), json!({}));
    let pickle: AccountPickle =
        serde_json::from_value(pickle).map_err(|_| BridgeError::InvalidState)?;
    Ok(Account::from_pickle(pickle))
}

fn decrypt_one(state: &mut RuntimeState, request: DecryptRequest) -> Result<Value, BridgeError> {
    // Capability-gated by the caller. Old clients do not opt into a journal
    // they cannot drain. The replay ID is bound to the exact authenticated
    // envelope parameters, not just a caller-supplied message identifier.
    if request.replay_id.is_empty() {
        return decrypt_unjournaled(state, request);
    }
    if request.replay_id.len() > 160 || request.ciphertext.len() > 4096 {
        return Err(BridgeError::InvalidRequest);
    }
    let digest = Sha256::digest(
        serde_json::to_vec(&json!([
            request.device_id,
            request.identity_key,
            request.session_generation,
            request.message_type,
            request.ciphertext
        ]))
        .map_err(|_| BridgeError::InvalidRequest)?,
    );
    let fingerprint: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    if let Some(pending) = state.pending_decrypts.get(&request.replay_id) {
        if pending.fingerprint != fingerprint {
            return Err(BridgeError::InvalidRequest);
        }
        return Ok(pending.result.clone());
    }
    if state.pending_decrypts.len() >= MAX_PENDING_DECRYPTS {
        return Err(BridgeError::JournalFull);
    }
    let replay_id = request.replay_id.clone();
    let result = decrypt_unjournaled(state, request)?;
    // This journal hands off content keys, never arbitrary message bodies.
    // Malformed sender payloads must not poison startup recovery for the account.
    let valid_key = result["plaintext"]
        .as_str()
        .and_then(|value| STANDARD.decode(value).ok())
        .map(|mut key| {
            let valid = key.len() == 32;
            key.zeroize();
            valid
        })
        .unwrap_or(false);
    if !valid_key {
        return Ok(result);
    }
    state.journal_enabled = true;
    state.pending_decrypts.insert(
        replay_id,
        PendingDecryptResult {
            fingerprint,
            result: result.clone(),
        },
    );
    Ok(result)
}

fn decrypt_unjournaled(
    state: &mut RuntimeState,
    request: DecryptRequest,
) -> Result<Value, BridgeError> {
    let message = decode_message(request.message_type, &request.ciphertext)?;
    let target = SessionTarget {
        device_id: request.device_id.clone(),
        identity_key: request.identity_key.clone(),
        session_generation: request.session_generation,
    };
    let candidate_indices: Vec<_> = state
        .sessions
        .iter()
        .enumerate()
        .filter_map(|(index, session)| matching_session(session, &target).then_some(index))
        .collect();
    for index in candidate_indices {
        let mut candidate = clone_session(&state.sessions[index].session)?;
        if let Ok(plaintext) = candidate.decrypt(&message) {
            let plaintext = String::from_utf8(plaintext).map_err(|_| BridgeError::Decryption)?;
            let session_id = candidate.session_id();
            state.sessions[index].session = candidate;
            return Ok(json!({
                "plaintext": plaintext,
                "sessionId": session_id,
                "createdInbound": false,
            }));
        }
    }
    if request.message_type != 0 {
        return Err(BridgeError::SessionUnavailable);
    }
    let sender_key = Curve25519PublicKey::from_base64(&request.identity_key)
        .map_err(|_| BridgeError::InvalidPublicKey)?;
    let OlmMessage::PreKey(pre_key_message) = &message else {
        return Err(BridgeError::MessageEncoding);
    };

    // Creating an inbound session consumes a one-time key. Work on a cloned
    // account so a malformed envelope cannot partially mutate the batch state.
    let mut candidate_account = Account::from_pickle(state.account.pickle());
    let inbound = candidate_account
        .create_inbound_session(SessionConfig::version_1(), sender_key, pre_key_message)
        .map_err(|error| match error {
            // An old pre-key envelope may outlive its consumed OTK/session.
            // Report that precise absence without accepting plaintext or
            // resetting state. MAC, identity and format failures stay errors.
            SessionCreationError::MissingOneTimeKey(_) => BridgeError::OneTimeKeyUnavailable,
            _ => BridgeError::Decryption,
        })?;
    let plaintext = String::from_utf8(inbound.plaintext).map_err(|_| BridgeError::Decryption)?;
    let session_id = inbound.session.session_id();
    state.account = candidate_account;
    state.sessions.insert(
        0,
        RuntimeSession {
            device_id: request.device_id.clone(),
            identity_key: request.identity_key,
            session_generation: request.session_generation,
            session: inbound.session,
        },
    );
    let mut seen = 0usize;
    state.sessions.retain(|candidate| {
        if candidate.device_id != request.device_id {
            return true;
        }
        seen += 1;
        seen <= MAX_SESSIONS_PER_DEVICE
    });
    Ok(json!({
        "plaintext": plaintext,
        "sessionId": session_id,
        "createdInbound": true,
    }))
}

fn handle_operation(
    operation: &str,
    payload: &str,
    existing_state: Option<&[u8]>,
    state_key: &[u8; 32],
) -> Result<OperationResult, BridgeError> {
    if operation == "projectMessageControls" {
        return Ok(OperationResult {
            state: None,
            result: message_projection::transform(payload)?,
        });
    }
    if operation == "recoveryEnvelopes" {
        return Ok(OperationResult {
            state: None,
            result: recovery_envelopes::transform(payload)?,
        });
    }
    if operation == "notificationEnvelopes" {
        return Ok(OperationResult {
            state: None,
            result: notification_envelopes::transform(payload)?,
        });
    }
    if operation == "messageAead" {
        return Ok(OperationResult {
            state: None,
            result: message_aead::transform(payload)?,
        });
    }
    if operation == "messageAeadBatch" {
        return Ok(OperationResult {
            state: None,
            result: message_aead::transform_batch(payload)?,
        });
    }
    if operation == "localRecords" {
        return Ok(OperationResult {
            state: None,
            result: local_records::transform(payload)?,
        });
    }
    if operation == "fileCrypto" {
        return Ok(OperationResult {
            state: None,
            result: file_crypto::transform(payload)?,
        });
    }
    if operation == "bootstrap" {
        return bootstrap(payload, existing_state, state_key);
    }
    if operation == "verify" {
        let request: VerifyRequest = parse(payload)?;
        let key = Ed25519PublicKey::from_base64(&request.signing_key)
            .map_err(|_| BridgeError::InvalidPublicKey)?;
        let signature = Ed25519Signature::from_base64(&request.signature)
            .map_err(|_| BridgeError::InvalidSignature)?;
        key.verify(request.message.as_bytes(), &signature)
            .map_err(|_| BridgeError::InvalidSignature)?;
        return Ok(OperationResult {
            state: None,
            result: json!({ "valid": true }),
        });
    }

    let namespace: AccountNamespace = parse(payload)?;
    if namespace.account_id.is_empty() {
        return Err(BridgeError::InvalidRequest);
    }
    let mut state = RuntimeState::from_bytes(existing_state, &namespace.account_id, state_key)?;
    match operation {
        "identity" => Ok(OperationResult {
            state: None,
            result: public_account(&state.account),
        }),
        "generateOneTimeKeys" => {
            let request: CountRequest = parse(payload)?;
            let available = state
                .account
                .max_number_of_one_time_keys()
                .saturating_sub(state.account.stored_one_time_key_count());
            let count = request.count.min(available);
            state.account.generate_one_time_keys(count);
            let keys = unpublished_one_time_keys(&state.account);
            Ok(OperationResult {
                state: Some(state.into_bytes(state_key)?),
                result: json!({ "oneTimeKeys": keys }),
            })
        }
        "fallbackKey" => {
            // Fallback keys are used only when every one-time key has been
            // claimed. Rotating keeps the current key as "previous" (so a
            // session started against it still decrypts) and forgets the one
            // before that; at most two private parts are retained.
            let request: FallbackKeyRequest = parse(payload)?;
            if request.device_id.is_empty() || request.device_id.len() > 256 {
                return Err(BridgeError::InvalidRequest);
            }
            if request.rotate {
                state.account.forget_fallback_key();
                state.account.generate_fallback_key();
            }
            let keys = signed_fallback_keys(&state.account, &request.device_id);
            Ok(OperationResult {
                state: if request.rotate {
                    Some(state.into_bytes(state_key)?)
                } else {
                    None
                },
                result: json!({ "fallbackKeys": keys }),
            })
        }
        "markOneTimeKeysPublished" => {
            state.account.mark_keys_as_published();
            Ok(OperationResult {
                state: Some(state.into_bytes(state_key)?),
                result: json!({ "published": true }),
            })
        }
        "sign" => {
            let request: SignRequest = parse(payload)?;
            Ok(OperationResult {
                state: None,
                result: json!({ "signature": state.account.sign(request.message).to_base64() }),
            })
        }
        "hasSessions" => {
            let request: SessionsRequest = parse(payload)?;
            let sessions: Vec<_> = request
                .recipients
                .iter()
                .map(|target| {
                    json!({
                        "deviceId": target.device_id,
                        "available": state.sessions.iter().any(|session| matching_session(session, target)),
                    })
                })
                .collect();
            Ok(OperationResult {
                state: None,
                result: json!({ "sessions": sessions }),
            })
        }
        "encryptForDevices" => {
            let request: EncryptRequest = parse(payload)?;
            let mut envelopes = Vec::new();
            let mut skipped = Vec::new();
            for recipient in request.recipients {
                let target = SessionTarget {
                    device_id: recipient.device_id.clone(),
                    identity_key: recipient.identity_key.clone(),
                    session_generation: recipient.session_generation,
                };
                let existing_index = state
                    .sessions
                    .iter()
                    .position(|session| matching_session(session, &target));
                let (mut session, created_session) = if let Some(index) = existing_index {
                    (clone_session(&state.sessions[index].session)?, false)
                } else if let Some(one_time_key) = recipient.one_time_key.as_deref() {
                    let identity_key = Curve25519PublicKey::from_base64(&recipient.identity_key)
                        .map_err(|_| BridgeError::InvalidPublicKey)?;
                    let one_time_key = Curve25519PublicKey::from_base64(one_time_key)
                        .map_err(|_| BridgeError::InvalidPublicKey)?;
                    (
                        state
                            .account
                            .create_outbound_session(
                                SessionConfig::version_1(),
                                identity_key,
                                one_time_key,
                            )
                            .map_err(|_| BridgeError::SessionCreation)?,
                        true,
                    )
                } else {
                    skipped.push(recipient.device_id);
                    continue;
                };
                let message = session
                    .encrypt(recipient.plaintext.as_bytes())
                    .map_err(|_| BridgeError::SessionCreation)?;
                let (message_type, ciphertext) = encode_message(&message)?;
                let session_id = session.session_id();
                if let Some(index) = existing_index {
                    state.sessions[index].session = session;
                } else {
                    state.sessions.insert(
                        0,
                        RuntimeSession {
                            device_id: recipient.device_id.clone(),
                            identity_key: recipient.identity_key,
                            session_generation: recipient.session_generation,
                            session,
                        },
                    );
                    let mut seen = 0usize;
                    state.sessions.retain(|candidate| {
                        if candidate.device_id != recipient.device_id {
                            return true;
                        }
                        seen += 1;
                        seen <= MAX_SESSIONS_PER_DEVICE
                    });
                }
                envelopes.push(json!({
                    "deviceId": recipient.device_id,
                    "messageType": message_type,
                    "ciphertext": ciphertext,
                    "sessionId": session_id,
                    "createdSession": created_session,
                }));
            }
            Ok(OperationResult {
                state: Some(state.into_bytes(state_key)?),
                result: json!({ "envelopes": envelopes, "skippedDeviceIds": skipped }),
            })
        }
        "pendingDecrypts" => {
            let results: Vec<Value> = state.pending_decrypts.iter().take(MAX_DECRYPT_BATCH)
                .map(|(id, entry)| json!({ "messageId": id, "plaintext": entry.result["plaintext"] })).collect();
            Ok(OperationResult {
                state: None,
                result: json!({ "results": results }),
            })
        }
        "acknowledgeDecrypts" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Acknowledgments {
                message_ids: Vec<String>,
            }
            let request: Acknowledgments = parse(payload)?;
            if request.message_ids.len() > MAX_DECRYPT_BATCH {
                return Err(BridgeError::InvalidRequest);
            }
            let mut removed = 0;
            for id in request.message_ids {
                if state.pending_decrypts.remove(&id).is_some() {
                    removed += 1;
                }
            }
            Ok(OperationResult {
                state: if removed > 0 {
                    Some(state.into_bytes(state_key)?)
                } else {
                    None
                },
                result: json!({ "acknowledged": removed }),
            })
        }
        "decryptEnvelope" => {
            let request: DecryptRequest = parse(payload)?;
            let result = decrypt_one(&mut state, request)?;
            Ok(OperationResult {
                state: Some(state.into_bytes(state_key)?),
                result,
            })
        }
        "decryptEnvelopes" => {
            let request: DecryptBatchRequest = parse(payload)?;
            if request.envelopes.is_empty() || request.envelopes.len() > MAX_DECRYPT_BATCH {
                return Err(BridgeError::InvalidRequest);
            }
            let mut results: Vec<Option<Value>> =
                (0..request.envelopes.len()).map(|_| None).collect();
            let mut retry = Vec::new();
            // Message API pages are newest-first. Ratchets must advance in
            // chronological order; otherwise a 50-row page can exceed Olm's
            // 40 skipped-message-key window and make older rows undecryptable.
            for (position, indexed) in request.envelopes.into_iter().enumerate().rev() {
                let index = indexed.index;
                let request: DecryptRequest = indexed.into();
                match decrypt_one(&mut state, request.clone()) {
                    Ok(mut result) => {
                        result["index"] = json!(index);
                        result["ok"] = json!(true);
                        results[position] = Some(result);
                    }
                    Err(BridgeError::SessionUnavailable) => {
                        // API history is newest-first. A continuation can
                        // precede its older pre-key message in this page; retry
                        // once after later items have had a chance to establish
                        // the session and populate skipped-message keys.
                        retry.push((position, index, request));
                    }
                    Err(error) => {
                        results[position] = Some(json!({
                            "index": index,
                            "ok": false,
                            "code": error.code(),
                            "message": error.to_string(),
                        }));
                    }
                }
            }
            retry.sort_by(|left, right| right.0.cmp(&left.0));
            for (position, index, request) in retry {
                results[position] = Some(match decrypt_one(&mut state, request) {
                    Ok(mut result) => {
                        result["index"] = json!(index);
                        result["ok"] = json!(true);
                        result
                    }
                    Err(error) => json!({
                        "index": index,
                        "ok": false,
                        "code": error.code(),
                        "message": error.to_string(),
                    }),
                });
            }
            let results = results
                .into_iter()
                .collect::<Option<Vec<_>>>()
                .ok_or(BridgeError::InvalidState)?;
            Ok(OperationResult {
                state: Some(state.into_bytes(state_key)?),
                result: json!({ "results": results }),
            })
        }
        "clearSessions" => {
            let cleared_session_count = state.sessions.len();
            state.sessions.clear();
            Ok(OperationResult {
                state: Some(state.into_bytes(state_key)?),
                result: json!({ "clearedSessionCount": cleared_session_count }),
            })
        }
        "resetSessionsAndOneTimeKeys" => {
            let request: CountRequest = parse(payload)?;
            let cleared_session_count = state.sessions.len();
            let identity_key = state.account.curve25519_key();
            let signing_key = state.account.ed25519_key();
            state.sessions.clear();
            state.account = clear_account_one_time_keys(&state.account)?;
            if state.account.curve25519_key() != identity_key
                || state.account.ed25519_key() != signing_key
            {
                return Err(BridgeError::InvalidState);
            }
            let count = request
                .count
                .min(state.account.max_number_of_one_time_keys());
            state.account.generate_one_time_keys(count);
            let one_time_keys = unpublished_one_time_keys(&state.account);
            Ok(OperationResult {
                state: Some(state.into_bytes(state_key)?),
                result: json!({
                    "clearedSessionCount": cleared_session_count,
                    "oneTimeKeys": one_time_keys,
                }),
            })
        }
        "diagnostics" => Ok(OperationResult {
            state: None,
            result: json!({
                "engine": "vodozemac",
                "engineVersion": ENGINE_VERSION,
                "bridgeRevision": STATE_REVISION,
                "sessionCount": state.sessions.len(),
                "storedOneTimeKeyCount": state.account.stored_one_time_key_count(),
                "unpublishedOneTimeKeyCount": state.account.one_time_keys().len(),
            }),
        }),
        _ => Err(BridgeError::InvalidRequest),
    }
}

fn encode_wire(status: u8, result: &[u8], state: Option<&[u8]>) -> Vec<u8> {
    let state = state.unwrap_or_default();
    let mut output = Vec::with_capacity(14 + result.len() + state.len());
    output.extend_from_slice(&BRIDGE_MAGIC.to_be_bytes());
    output.push(BRIDGE_VERSION);
    output.push(status);
    output.extend_from_slice(&(result.len() as u32).to_be_bytes());
    output.extend_from_slice(result);
    output.extend_from_slice(&(state.len() as u32).to_be_bytes());
    output.extend_from_slice(state);
    output
}

fn response_bytes(
    operation: &str,
    payload: &str,
    state: Option<&[u8]>,
    state_key: &[u8; 32],
) -> Vec<u8> {
    match catch_unwind(AssertUnwindSafe(|| {
        handle_operation(operation, payload, state, state_key)
    })) {
        Ok(Ok(output)) => {
            let mut state = output.state;
            let mut result = serde_json::to_vec(&output.result).unwrap_or_else(|_| b"{}".to_vec());
            let response = encode_wire(1, &result, state.as_deref());
            result.zeroize();
            if let Some(state) = state.as_mut() {
                state.zeroize();
            }
            response
        }
        Ok(Err(error)) => {
            let mut result = serde_json::to_vec(&NativeError {
                code: error.code(),
                message: error.to_string(),
            })
            .unwrap_or_else(|_| b"{}".to_vec());
            let response = encode_wire(0, &result, None);
            result.zeroize();
            response
        }
        Err(_) => {
            let mut result = serde_json::to_vec(&NativeError {
                code: "E_OLM_NATIVE_PANIC",
                message: "The native Olm operation failed safely.".to_owned(),
            })
            .unwrap_or_else(|_| b"{}".to_vec());
            let response = encode_wire(0, &result, None);
            result.zeroize();
            response
        }
    }
}

#[cfg(target_os = "android")]
fn jstring_to_string(env: &mut JNIEnv<'_>, value: &JString<'_>) -> Option<String> {
    env.get_string(value).ok().map(Into::into)
}

#[unsafe(no_mangle)]
#[cfg(target_os = "android")]
pub extern "system" fn Java_expo_modules_orizoolmandroid_NativeOlmBridge_invoke(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    operation: JString<'_>,
    payload: JString<'_>,
    state: JByteArray<'_>,
    state_key: JByteArray<'_>,
) -> jbyteArray {
    let operation = jstring_to_string(&mut env, &operation).unwrap_or_default();
    let mut payload = jstring_to_string(&mut env, &payload).unwrap_or_default();
    let mut state = env.convert_byte_array(&state).unwrap_or_default();
    let mut state_key_raw = env.convert_byte_array(&state_key).unwrap_or_default();
    let mut state_key = [0u8; 32];
    if state_key_raw.len() != state_key.len() {
        state_key_raw.zeroize();
        payload.zeroize();
        state.zeroize();
        let mut error = serde_json::to_vec(&NativeError {
            code: "E_OLM_STORAGE_KEY",
            message: "The native Olm storage key is invalid.".to_owned(),
        })
        .unwrap_or_else(|_| b"{}".to_vec());
        let mut response = encode_wire(0, &error, None);
        error.zeroize();
        let output = env
            .byte_array_from_slice(&response)
            .map(|value| value.into_raw())
            .unwrap_or(std::ptr::null_mut());
        response.zeroize();
        return output;
    }
    state_key.copy_from_slice(&state_key_raw);
    state_key_raw.zeroize();
    let mut response = response_bytes(
        &operation,
        &payload,
        (!state.is_empty()).then_some(state.as_slice()),
        &state_key,
    );
    let output = env
        .byte_array_from_slice(&response)
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut());
    state_key.zeroize();
    state.zeroize();
    payload.zeroize();
    response.zeroize();
    output
}

#[unsafe(no_mangle)]
#[cfg(target_os = "android")]
pub extern "system" fn Java_expo_modules_orizoolmandroid_NativeOlmBridge_deriveRecoveryPassphraseKey(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    password: JByteArray<'_>,
    salt: JByteArray<'_>,
) -> jbyteArray {
    let password_length = env.get_array_length(&password).unwrap_or_default();
    let salt_length = env.get_array_length(&salt).unwrap_or_default();
    if password_length <= 0
        || password_length as usize > MAX_RECOVERY_PASSWORD_BYTES
        || salt_length as usize != RECOVERY_KDF_SALT_BYTES
    {
        let _ = env.throw_new(
            "java/lang/IllegalArgumentException",
            "E_RECOVERY_KDF_INVALID_INPUT",
        );
        return std::ptr::null_mut();
    }

    let mut password = match env.convert_byte_array(&password) {
        Ok(value) => value,
        Err(_) => {
            let _ = env.throw_new(
                "java/lang/IllegalArgumentException",
                "E_RECOVERY_KDF_INVALID_INPUT",
            );
            return std::ptr::null_mut();
        }
    };
    let mut salt = match env.convert_byte_array(&salt) {
        Ok(value) => value,
        Err(_) => {
            password.zeroize();
            let _ = env.throw_new(
                "java/lang/IllegalArgumentException",
                "E_RECOVERY_KDF_INVALID_INPUT",
            );
            return std::ptr::null_mut();
        }
    };

    let derived = catch_unwind(AssertUnwindSafe(|| {
        derive_recovery_passphrase_key(&password, &salt)
    }));
    password.zeroize();
    salt.zeroize();

    match derived {
        Ok(Ok(mut key)) => {
            let output = env
                .byte_array_from_slice(&key)
                .map(|value| value.into_raw())
                .unwrap_or(std::ptr::null_mut());
            key.zeroize();
            if output.is_null() {
                let _ = env.throw_new("java/lang/IllegalStateException", "E_RECOVERY_KDF_OUTPUT");
            }
            output
        }
        Ok(Err(RecoveryKdfError::InvalidInput)) => {
            let _ = env.throw_new(
                "java/lang/IllegalArgumentException",
                "E_RECOVERY_KDF_INVALID_INPUT",
            );
            std::ptr::null_mut()
        }
        Ok(Err(RecoveryKdfError::Failed)) | Err(_) => {
            let _ = env.throw_new("java/lang/IllegalStateException", "E_RECOVERY_KDF_FAILED");
            std::ptr::null_mut()
        }
    }
}

// The Apple module compiles this exact source file as a static library. Keeping
// the C ABI here means Android and iOS share the same vodozemac state machine,
// wire framing, encrypted state format, fixed KDF vectors, and error codes.
#[cfg(not(target_os = "android"))]
fn ffi_copy_bytes(pointer: *const u8, length: usize, maximum: usize) -> Option<Vec<u8>> {
    if length > maximum || (length > 0 && pointer.is_null()) {
        return None;
    }
    if length == 0 {
        return Some(Vec::new());
    }
    // SAFETY: callers promise a readable buffer of `length` bytes. We copy it
    // immediately and never retain the foreign pointer.
    Some(unsafe { std::slice::from_raw_parts(pointer, length) }.to_vec())
}

#[cfg(not(target_os = "android"))]
fn ffi_return_bytes(mut bytes: Vec<u8>, output_length: *mut usize) -> *mut u8 {
    if output_length.is_null() || bytes.is_empty() {
        bytes.zeroize();
        return std::ptr::null_mut();
    }
    let mut boxed = bytes.into_boxed_slice();
    let length = boxed.len();
    let pointer = boxed.as_mut_ptr();
    // SAFETY: `output_length` was validated above and belongs to the caller.
    unsafe { *output_length = length };
    std::mem::forget(boxed);
    pointer
}

#[unsafe(no_mangle)]
#[cfg(not(target_os = "android"))]
/// Invokes the shared Olm state machine through the Apple C ABI.
///
/// # Safety
/// Every non-null input pointer must be readable for its declared length and
/// `output_length` must be writable. The returned buffer must be released once
/// with `orizo_olm_free` using the exact returned length.
pub unsafe extern "C" fn orizo_olm_invoke(
    operation_pointer: *const u8,
    operation_length: usize,
    payload_pointer: *const u8,
    payload_length: usize,
    state_pointer: *const u8,
    state_length: usize,
    state_key_pointer: *const u8,
    state_key_length: usize,
    output_length: *mut usize,
) -> *mut u8 {
    match catch_unwind(AssertUnwindSafe(|| {
        apple_invoke_inner(
            operation_pointer,
            operation_length,
            payload_pointer,
            payload_length,
            state_pointer,
            state_length,
            state_key_pointer,
            state_key_length,
            output_length,
        )
    })) {
        Ok(pointer) => pointer,
        Err(_) => {
            if !output_length.is_null() {
                // SAFETY: the caller supplied a writable `usize` pointer.
                unsafe { *output_length = 0 };
            }
            std::ptr::null_mut()
        }
    }
}

#[cfg(not(target_os = "android"))]
#[allow(clippy::too_many_arguments)]
fn apple_invoke_inner(
    operation_pointer: *const u8,
    operation_length: usize,
    payload_pointer: *const u8,
    payload_length: usize,
    state_pointer: *const u8,
    state_length: usize,
    state_key_pointer: *const u8,
    state_key_length: usize,
    output_length: *mut usize,
) -> *mut u8 {
    if !output_length.is_null() {
        // SAFETY: the caller supplied a writable `usize` pointer.
        unsafe { *output_length = 0 };
    }
    let Some(operation_bytes) = ffi_copy_bytes(operation_pointer, operation_length, 64) else {
        return std::ptr::null_mut();
    };
    let Some(mut payload_bytes) = ffi_copy_bytes(payload_pointer, payload_length, 4 * 1024 * 1024)
    else {
        return std::ptr::null_mut();
    };
    let Some(mut state) = ffi_copy_bytes(state_pointer, state_length, 32 * 1024 * 1024) else {
        payload_bytes.zeroize();
        return std::ptr::null_mut();
    };
    let Some(mut state_key_raw) = ffi_copy_bytes(state_key_pointer, state_key_length, 32) else {
        payload_bytes.zeroize();
        state.zeroize();
        return std::ptr::null_mut();
    };

    let operation = std::str::from_utf8(&operation_bytes).unwrap_or_default();
    let payload = std::str::from_utf8(&payload_bytes).unwrap_or_default();
    let mut state_key = [0u8; 32];
    let mut response =
        if state_key_raw.len() == state_key.len() && !operation.is_empty() && !payload.is_empty() {
            state_key.copy_from_slice(&state_key_raw);
            response_bytes(
                operation,
                payload,
                (!state.is_empty()).then_some(state.as_slice()),
                &state_key,
            )
        } else {
            let mut error = serde_json::to_vec(&NativeError {
                code: "E_OLM_INVALID_REQUEST",
                message: "The native Olm request is invalid.".to_owned(),
            })
            .unwrap_or_else(|_| b"{}".to_vec());
            let response = encode_wire(0, &error, None);
            error.zeroize();
            response
        };
    state_key.zeroize();
    state_key_raw.zeroize();
    state.zeroize();
    payload_bytes.zeroize();
    let pointer = ffi_return_bytes(std::mem::take(&mut response), output_length);
    response.zeroize();
    pointer
}

#[unsafe(no_mangle)]
#[cfg(not(target_os = "android"))]
/// Derives the fixed-profile recovery key through the Apple C ABI.
///
/// # Safety
/// Input pointers must be readable for their declared lengths; output and
/// error pointers must be writable. A successful returned buffer must be
/// released once with `orizo_olm_free` using the exact returned length.
pub unsafe extern "C" fn orizo_olm_derive_recovery_passphrase_key(
    password_pointer: *const u8,
    password_length: usize,
    salt_pointer: *const u8,
    salt_length: usize,
    output_length: *mut usize,
    error_code: *mut i32,
) -> *mut u8 {
    match catch_unwind(AssertUnwindSafe(|| {
        apple_derive_recovery_inner(
            password_pointer,
            password_length,
            salt_pointer,
            salt_length,
            output_length,
            error_code,
        )
    })) {
        Ok(pointer) => pointer,
        Err(_) => {
            if !output_length.is_null() {
                unsafe { *output_length = 0 };
            }
            if !error_code.is_null() {
                unsafe { *error_code = 2 };
            }
            std::ptr::null_mut()
        }
    }
}

#[cfg(not(target_os = "android"))]
fn apple_derive_recovery_inner(
    password_pointer: *const u8,
    password_length: usize,
    salt_pointer: *const u8,
    salt_length: usize,
    output_length: *mut usize,
    error_code: *mut i32,
) -> *mut u8 {
    if !output_length.is_null() {
        // SAFETY: the caller supplied a writable `usize` pointer.
        unsafe { *output_length = 0 };
    }
    if !error_code.is_null() {
        // SAFETY: the caller supplied a writable `i32` pointer.
        unsafe { *error_code = 2 };
    }
    let Some(mut password) = ffi_copy_bytes(
        password_pointer,
        password_length,
        MAX_RECOVERY_PASSWORD_BYTES,
    ) else {
        if !error_code.is_null() {
            unsafe { *error_code = 1 };
        }
        return std::ptr::null_mut();
    };
    let Some(mut salt) = ffi_copy_bytes(salt_pointer, salt_length, RECOVERY_KDF_SALT_BYTES) else {
        password.zeroize();
        if !error_code.is_null() {
            unsafe { *error_code = 1 };
        }
        return std::ptr::null_mut();
    };

    let derived = catch_unwind(AssertUnwindSafe(|| {
        derive_recovery_passphrase_key(&password, &salt)
    }));
    password.zeroize();
    salt.zeroize();
    match derived {
        Ok(Ok(mut key)) => {
            if !error_code.is_null() {
                unsafe { *error_code = 0 };
            }
            let pointer = ffi_return_bytes(key.to_vec(), output_length);
            key.zeroize();
            pointer
        }
        Ok(Err(RecoveryKdfError::InvalidInput)) => {
            if !error_code.is_null() {
                unsafe { *error_code = 1 };
            }
            std::ptr::null_mut()
        }
        Ok(Err(RecoveryKdfError::Failed)) | Err(_) => std::ptr::null_mut(),
    }
}

#[unsafe(no_mangle)]
#[cfg(not(target_os = "android"))]
/// Zeroizes and releases a buffer returned by this C ABI.
///
/// # Safety
/// `pointer` and `length` must identify one still-owned allocation returned by
/// `orizo_olm_invoke` or `orizo_olm_derive_recovery_passphrase_key`.
pub unsafe extern "C" fn orizo_olm_free(pointer: *mut u8, length: usize) {
    if pointer.is_null() || length == 0 {
        return;
    }
    // SAFETY: this function accepts only buffers returned by the two C ABI
    // functions above, both allocated as boxed slices with the exact length.
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let raw = std::ptr::slice_from_raw_parts_mut(pointer, length);
        let mut boxed = unsafe { Box::from_raw(raw) };
        boxed.zeroize();
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATE_KEY: [u8; 32] = [0x42; 32];

    fn decode_hex_32(value: &str) -> [u8; 32] {
        assert_eq!(value.len(), 64);
        let mut output = [0u8; 32];
        for (index, byte) in output.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
                .expect("valid fixed test vector");
        }
        output
    }

    #[test]
    fn recovery_argon2id_ascii_matches_noble_2_2_0() {
        let salt = [
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
            0x0e, 0x0f,
        ];
        let mut actual = derive_recovery_passphrase_key(b"correct horse battery staple", &salt)
            .expect("ASCII recovery KDF");
        let expected =
            decode_hex_32("bbe4ce725d8b1ae6f8c3f70b21dac67681bf71b53ffc4b805c35e6faa4477eab");
        assert_eq!(actual, expected);
        actual.zeroize();
    }

    #[test]
    fn recovery_argon2id_unicode_utf8_matches_noble_2_2_0() {
        let salt = [
            0xf0, 0xe0, 0xd0, 0xc0, 0xb0, 0xa0, 0x90, 0x80, 0x70, 0x60, 0x50, 0x40, 0x30, 0x20,
            0x10, 0x00,
        ];
        let mut actual = derive_recovery_passphrase_key("κλειδί-🔐-恢复-2026".as_bytes(), &salt)
            .expect("Unicode recovery KDF");
        let expected =
            decode_hex_32("e5266e279104a986809a772587524d641003b726cd2c38641533e2b0f5e4c6a8");
        assert_eq!(actual, expected);
        actual.zeroize();
    }

    #[test]
    fn recovery_argon2id_rejects_out_of_contract_inputs_before_work() {
        assert!(matches!(
            derive_recovery_passphrase_key(&[], &[0u8; RECOVERY_KDF_SALT_BYTES]),
            Err(RecoveryKdfError::InvalidInput),
        ));
        assert!(matches!(
            derive_recovery_passphrase_key(
                &vec![0u8; MAX_RECOVERY_PASSWORD_BYTES + 1],
                &[0u8; RECOVERY_KDF_SALT_BYTES],
            ),
            Err(RecoveryKdfError::InvalidInput),
        ));
        assert!(matches!(
            derive_recovery_passphrase_key(b"valid", &[0u8; RECOVERY_KDF_SALT_BYTES - 1]),
            Err(RecoveryKdfError::InvalidInput),
        ));
    }

    #[test]
    fn decrypt_journal_survives_crash_replay_and_acknowledgment() {
        let alice = handle_operation(
            "bootstrap",
            r#"{"accountId":"alice","oneTimeKeyCount":1}"#,
            None,
            &STATE_KEY,
        )
        .expect("alice bootstrap");
        let bob = handle_operation(
            "bootstrap",
            r#"{"accountId":"bob","oneTimeKeyCount":1}"#,
            None,
            &STATE_KEY,
        )
        .expect("bob bootstrap");
        let alice_state = alice.state.expect("alice state");
        let bob_state = bob.state.expect("bob state");
        let bob_public = bob.result;
        let bob_identity = bob_public["identityKey"].as_str().expect("identity");
        let bob_otk = bob_public["unpublishedOneTimeKeys"]
            .as_object()
            .and_then(|keys| keys.values().next())
            .and_then(Value::as_str)
            .expect("one-time key");
        let encrypted = handle_operation(
            "encryptForDevices",
            &json!({
                "accountId": "alice",
                "recipients": [{
                    "deviceId": "bob-device",
                    "identityKey": bob_identity,
                    "sessionGeneration": 0,
                    "oneTimeKey": bob_otk,
                    "plaintext": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                }]
            })
            .to_string(),
            Some(&alice_state),
            &STATE_KEY,
        )
        .expect("encrypt");
        let envelope = &encrypted.result["envelopes"][0];
        let alice_public = handle_operation(
            "identity",
            r#"{"accountId":"alice"}"#,
            Some(&alice_state),
            &STATE_KEY,
        )
        .expect("alice identity")
        .result;
        let decrypted = handle_operation(
            "decryptEnvelope",
            &json!({
                "accountId": "bob",
                "replayId": "message-1",
                "deviceId": "alice-device",
                "identityKey": alice_public["identityKey"],
                "sessionGeneration": 0,
                "messageType": envelope["messageType"],
                "ciphertext": envelope["ciphertext"],
            })
            .to_string(),
            Some(&bob_state),
            &STATE_KEY,
        )
        .expect("decrypt");
        assert_eq!(
            decrypted.result["plaintext"],
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        );
        let decrypted_state = decrypted.state.expect("decrypted state");
        assert_eq!(&bob_state[..4], STATE_MAGIC);
        assert_eq!(&decrypted_state[..4], JOURNALED_STATE_MAGIC);
        let replay_payload = json!({
            "accountId": "bob", "replayId": "message-1", "deviceId": "alice-device",
            "identityKey": alice_public["identityKey"], "sessionGeneration": 0,
            "messageType": envelope["messageType"], "ciphertext": envelope["ciphertext"],
        });
        // Simulate process death after ratchet commit and before JS receives it.
        let replay = handle_operation(
            "decryptEnvelope",
            &replay_payload.to_string(),
            Some(&decrypted_state),
            &STATE_KEY,
        )
        .expect("replay from durable journal");
        assert_eq!(replay.result, decrypted.result);
        let mut tampered = replay_payload.clone();
        tampered["ciphertext"] = json!("different-envelope");
        assert!(matches!(
            handle_operation(
                "decryptEnvelope",
                &tampered.to_string(),
                Some(&decrypted_state),
                &STATE_KEY
            ),
            Err(BridgeError::InvalidRequest)
        ));
        let pending = handle_operation(
            "pendingDecrypts",
            r#"{"accountId":"bob"}"#,
            Some(&decrypted_state),
            &STATE_KEY,
        )
        .expect("pending results");
        assert!(pending.state.is_none());
        assert_eq!(
            pending.result["results"],
            json!([{"messageId":"message-1","plaintext":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}])
        );
        assert!(
            handle_operation(
                "pendingDecrypts",
                r#"{"accountId":"alice"}"#,
                Some(&decrypted_state),
                &STATE_KEY
            )
            .is_err()
        );
        let ack = handle_operation(
            "acknowledgeDecrypts",
            r#"{"accountId":"bob","messageIds":["message-1"]}"#,
            Some(&decrypted_state),
            &STATE_KEY,
        )
        .expect("durable acknowledgment");
        assert_eq!(ack.result["acknowledged"], 1);
        let acknowledged_state = ack.state.expect("persisted removal");
        // Keep the new format even after draining; old binaries must not silently drop journals.
        assert_eq!(&acknowledged_state[..4], JOURNALED_STATE_MAGIC);
        let again = handle_operation(
            "acknowledgeDecrypts",
            r#"{"accountId":"bob","messageIds":["message-1"]}"#,
            Some(&acknowledged_state),
            &STATE_KEY,
        )
        .expect("idempotent ack");
        assert!(again.state.is_none());
        assert_eq!(again.result["acknowledged"], 0);
        let restored =
            RuntimeState::from_bytes(Some(&acknowledged_state), "bob", &STATE_KEY).unwrap();
        assert!(restored.pending_decrypts.is_empty());
        assert_eq!(restored.sessions.len(), 1);
        let mut downgraded_header = acknowledged_state.clone();
        downgraded_header[..4].copy_from_slice(STATE_MAGIC);
        assert!(RuntimeState::from_bytes(Some(&downgraded_header), "bob", &STATE_KEY).is_err());
    }

    #[test]
    fn account_and_session_state_round_trip() {
        let alice = handle_operation(
            "bootstrap",
            r#"{"accountId":"alice","oneTimeKeyCount":1}"#,
            None,
            &STATE_KEY,
        )
        .expect("alice bootstrap");
        let bob = handle_operation(
            "bootstrap",
            r#"{"accountId":"bob","oneTimeKeyCount":1}"#,
            None,
            &STATE_KEY,
        )
        .expect("bob bootstrap");
        let alice_state = alice.state.expect("alice state");
        let bob_state = bob.state.expect("bob state");
        let bob_public = bob.result;
        let bob_identity = bob_public["identityKey"].as_str().expect("identity");
        let bob_otk = bob_public["unpublishedOneTimeKeys"]
            .as_object()
            .and_then(|keys| keys.values().next())
            .and_then(Value::as_str)
            .expect("one-time key");
        let encrypted = handle_operation(
            "encryptForDevices",
            &json!({
                "accountId": "alice",
                "recipients": [{
                    "deviceId": "bob-device",
                    "identityKey": bob_identity,
                    "sessionGeneration": 0,
                    "oneTimeKey": bob_otk,
                    "plaintext": "content-key-base64",
                }]
            })
            .to_string(),
            Some(&alice_state),
            &STATE_KEY,
        )
        .expect("encrypt");
        let envelope = &encrypted.result["envelopes"][0];
        let alice_public = handle_operation(
            "identity",
            r#"{"accountId":"alice"}"#,
            Some(&alice_state),
            &STATE_KEY,
        )
        .expect("alice identity")
        .result;
        let decrypted = handle_operation(
            "decryptEnvelope",
            &json!({
                "accountId": "bob",
                "deviceId": "alice-device",
                "identityKey": alice_public["identityKey"],
                "sessionGeneration": 0,
                "messageType": envelope["messageType"],
                "ciphertext": envelope["ciphertext"],
            })
            .to_string(),
            Some(&bob_state),
            &STATE_KEY,
        )
        .expect("decrypt");
        assert_eq!(decrypted.result["plaintext"], "content-key-base64");
        let decrypted_state = decrypted.state.expect("decrypted state");
        let restored = RuntimeState::from_bytes(Some(&decrypted_state), "bob", &STATE_KEY)
            .expect("restored state");
        assert_eq!(restored.sessions.len(), 1);
        assert_eq!(restored.account.stored_one_time_key_count(), 0);
        // Historical pre-key replay after the matching session is no longer
        // retained must distinguish a consumed OTK from an integrity failure.
        // This is a disposable synthetic state, never a runtime repair path.
        let mut without_session = restored;
        without_session.sessions.clear();
        let without_session = without_session.into_bytes(&STATE_KEY).unwrap();
        let historical = json!({
            "accountId": "bob", "deviceId": "alice-device",
            "identityKey": alice_public["identityKey"], "sessionGeneration": 0,
            "messageType": envelope["messageType"], "ciphertext": envelope["ciphertext"],
        });
        assert!(matches!(
            handle_operation(
                "decryptEnvelope",
                &historical.to_string(),
                Some(&without_session),
                &STATE_KEY
            ),
            Err(BridgeError::OneTimeKeyUnavailable)
        ));
        // With the original unconsumed OTK, corrupt ciphertext must still fail
        // authentication rather than becoming a missing-history classification.
        let codec = base64::engine::general_purpose::STANDARD_NO_PAD;
        let mut bytes = codec
            .decode(
                envelope["ciphertext"]
                    .as_str()
                    .unwrap()
                    .trim_end_matches('='),
            )
            .unwrap();
        *bytes.last_mut().unwrap() ^= 1;
        let mut corrupt = historical.clone();
        corrupt["ciphertext"] = json!(codec.encode(bytes));
        assert!(matches!(
            handle_operation(
                "decryptEnvelope",
                &corrupt.to_string(),
                Some(&bob_state),
                &STATE_KEY
            ),
            Err(BridgeError::Decryption)
        ));
        let mut wrong_identity = historical.clone();
        wrong_identity["identityKey"] = json!(bob_identity);
        assert!(matches!(
            handle_operation(
                "decryptEnvelope",
                &wrong_identity.to_string(),
                Some(&bob_state),
                &STATE_KEY
            ),
            Err(BridgeError::Decryption)
        ));
        let replenished = handle_operation(
            "generateOneTimeKeys",
            r#"{"accountId":"bob","count":40}"#,
            Some(&decrypted_state),
            &STATE_KEY,
        )
        .expect("replenish consumed slot");
        assert_eq!(
            replenished.result["oneTimeKeys"]
                .as_object()
                .expect("keys")
                .len(),
            40
        );
    }

    #[test]
    fn created_account_identity_survives_persisted_restart() {
        let created = handle_operation(
            "bootstrap",
            r#"{"accountId":"restart","oneTimeKeyCount":4}"#,
            None,
            &STATE_KEY,
        )
        .expect("create account");
        let expected_identity = created.result["identityKey"].clone();
        let expected_signing = created.result["signingKey"].clone();
        let persisted = created.state.expect("persisted state");

        let identity_after_restart = handle_operation(
            "identity",
            r#"{"accountId":"restart"}"#,
            Some(&persisted),
            &STATE_KEY,
        )
        .expect("identity after restart");
        assert_eq!(
            identity_after_restart.result["identityKey"],
            expected_identity
        );
        assert_eq!(
            identity_after_restart.result["signingKey"],
            expected_signing
        );

        let bootstrapped_after_restart = handle_operation(
            "bootstrap",
            &json!({
                "accountId": "restart",
                "expectedIdentityKey": expected_identity,
                "expectedSigningKey": expected_signing,
            })
            .to_string(),
            Some(&persisted),
            &STATE_KEY,
        )
        .expect("bootstrap after restart");
        assert_eq!(bootstrapped_after_restart.result["created"], false);
        assert_eq!(
            bootstrapped_after_restart.result["activationRequired"],
            false
        );
        assert!(bootstrapped_after_restart.state.is_none());
    }

    #[test]
    fn batch_decrypt_handles_normal_before_prekey_and_isolates_corruption() {
        let alice = handle_operation(
            "bootstrap",
            r#"{"accountId":"batch-alice","oneTimeKeyCount":1}"#,
            None,
            &STATE_KEY,
        )
        .expect("alice bootstrap");
        let bob = handle_operation(
            "bootstrap",
            r#"{"accountId":"batch-bob","oneTimeKeyCount":1}"#,
            None,
            &STATE_KEY,
        )
        .expect("bob bootstrap");
        let alice_identity = alice.result["identityKey"].clone();
        let bob_identity = bob.result["identityKey"].clone();
        let bob_otk = bob.result["unpublishedOneTimeKeys"]
            .as_object()
            .and_then(|keys| keys.values().next())
            .cloned()
            .expect("bob one-time key");
        let first = handle_operation(
            "encryptForDevices",
            &json!({
                "accountId": "batch-alice",
                "recipients": [{
                    "deviceId": "batch-bob-device",
                    "identityKey": bob_identity,
                    "sessionGeneration": 3,
                    "oneTimeKey": bob_otk,
                    "plaintext": "prekey-first",
                }]
            })
            .to_string(),
            alice.state.as_deref(),
            &STATE_KEY,
        )
        .expect("prekey encrypt");
        let prekey = &first.result["envelopes"][0];
        assert_eq!(prekey["messageType"], 0);
        let bob_received = handle_operation(
            "decryptEnvelope",
            &json!({
                "accountId": "batch-bob",
                "deviceId": "batch-alice-device",
                "identityKey": alice_identity,
                "sessionGeneration": 8,
                "messageType": prekey["messageType"],
                "ciphertext": prekey["ciphertext"],
            })
            .to_string(),
            bob.state.as_deref(),
            &STATE_KEY,
        )
        .expect("bob receives prekey on producer state");
        let reply = handle_operation(
            "encryptForDevices",
            &json!({
                "accountId": "batch-bob",
                "recipients": [{
                    "deviceId": "batch-alice-device",
                    "identityKey": alice.result["identityKey"],
                    "sessionGeneration": 8,
                    "plaintext": "handshake-reply",
                }]
            })
            .to_string(),
            bob_received.state.as_deref(),
            &STATE_KEY,
        )
        .expect("bob reply");
        let reply_envelope = &reply.result["envelopes"][0];
        let alice_received = handle_operation(
            "decryptEnvelope",
            &json!({
                "accountId": "batch-alice",
                "deviceId": "batch-bob-device",
                "identityKey": bob.result["identityKey"],
                "sessionGeneration": 3,
                "messageType": reply_envelope["messageType"],
                "ciphertext": reply_envelope["ciphertext"],
            })
            .to_string(),
            first.state.as_deref(),
            &STATE_KEY,
        )
        .expect("alice receives handshake reply");
        let second = handle_operation(
            "encryptForDevices",
            &json!({
                "accountId": "batch-alice",
                "recipients": [{
                    "deviceId": "batch-bob-device",
                    "identityKey": bob.result["identityKey"],
                    "sessionGeneration": 3,
                    "plaintext": "normal-second",
                }]
            })
            .to_string(),
            alice_received.state.as_deref(),
            &STATE_KEY,
        )
        .expect("normal encrypt");
        let normal = &second.result["envelopes"][0];
        assert_eq!(normal["messageType"], 1);

        // Add an independent pre-key envelope after the established Alice
        // session. This is the realistic mixed-page shape: an existing type-1
        // session plus a newly established sender can arrive newest-first in
        // the same API page.
        let replenished_bob = handle_operation(
            "generateOneTimeKeys",
            r#"{"accountId":"batch-bob","count":1}"#,
            reply.state.as_deref(),
            &STATE_KEY,
        )
        .expect("bob replenishes one-time key");
        let bob_fresh_otk = replenished_bob.result["oneTimeKeys"]
            .as_object()
            .and_then(|keys| keys.values().next())
            .cloned()
            .expect("fresh bob one-time key");
        let charlie = handle_operation(
            "bootstrap",
            r#"{"accountId":"batch-charlie","oneTimeKeyCount":0}"#,
            None,
            &STATE_KEY,
        )
        .expect("charlie bootstrap");
        let charlie_prekey = handle_operation(
            "encryptForDevices",
            &json!({
                "accountId": "batch-charlie",
                "recipients": [{
                    "deviceId": "batch-bob-device",
                    "identityKey": bob.result["identityKey"],
                    "sessionGeneration": 3,
                    "oneTimeKey": bob_fresh_otk,
                    "plaintext": "charlie-prekey",
                }]
            })
            .to_string(),
            charlie.state.as_deref(),
            &STATE_KEY,
        )
        .expect("charlie prekey");
        let new_prekey = &charlie_prekey.result["envelopes"][0];
        assert_eq!(new_prekey["messageType"], 0);

        let batch = handle_operation(
            "decryptEnvelopes",
            &json!({
                "accountId": "batch-bob",
                "envelopes": [
                    {
                        "index": 9,
                        "deviceId": "batch-alice-device",
                        "identityKey": alice_identity,
                        "sessionGeneration": 8,
                        "messageType": normal["messageType"],
                        "ciphertext": normal["ciphertext"],
                    },
                    {
                        "index": 10,
                        "deviceId": "batch-alice-device",
                        "identityKey": alice.result["identityKey"],
                        "sessionGeneration": 8,
                        "messageType": 1,
                        "ciphertext": "corrupt",
                    },
                    {
                        "index": 11,
                        "deviceId": "batch-charlie-device",
                        "identityKey": charlie.result["identityKey"],
                        "sessionGeneration": 12,
                        "messageType": new_prekey["messageType"],
                        "ciphertext": new_prekey["ciphertext"],
                    }
                ]
            })
            .to_string(),
            replenished_bob.state.as_deref(),
            &STATE_KEY,
        )
        .expect("isolated batch decrypt");
        let results = batch.result["results"].as_array().expect("results");
        assert_eq!(results[0]["index"], 9);
        assert_eq!(results[0]["ok"], true);
        assert_eq!(results[0]["plaintext"], "normal-second");
        assert_eq!(results[1]["index"], 10);
        assert_eq!(results[1]["ok"], false);
        assert_eq!(results[2]["index"], 11);
        assert_eq!(results[2]["ok"], true);
        assert_eq!(results[2]["plaintext"], "charlie-prekey");
        assert!(batch.state.is_some(), "the batch ratchet must persist once");
    }

    #[test]
    fn newest_first_fifty_message_page_decrypts_chronologically() {
        let alice = handle_operation(
            "bootstrap",
            r#"{"accountId":"page-alice","oneTimeKeyCount":1}"#,
            None,
            &STATE_KEY,
        )
        .expect("alice bootstrap");
        let bob = handle_operation(
            "bootstrap",
            r#"{"accountId":"page-bob","oneTimeKeyCount":1}"#,
            None,
            &STATE_KEY,
        )
        .expect("bob bootstrap");
        let bob_otk = bob.result["unpublishedOneTimeKeys"]
            .as_object()
            .and_then(|keys| keys.values().next())
            .cloned()
            .expect("bob one-time key");
        let prekey = handle_operation(
            "encryptForDevices",
            &json!({
                "accountId": "page-alice",
                "recipients": [{
                    "deviceId": "page-bob-device",
                    "identityKey": bob.result["identityKey"],
                    "sessionGeneration": 4,
                    "oneTimeKey": bob_otk,
                    "plaintext": "establish",
                }]
            })
            .to_string(),
            alice.state.as_deref(),
            &STATE_KEY,
        )
        .expect("prekey");
        let prekey_envelope = &prekey.result["envelopes"][0];
        let bob_received = handle_operation(
            "decryptEnvelope",
            &json!({
                "accountId": "page-bob",
                "deviceId": "page-alice-device",
                "identityKey": alice.result["identityKey"],
                "sessionGeneration": 6,
                "messageType": prekey_envelope["messageType"],
                "ciphertext": prekey_envelope["ciphertext"],
            })
            .to_string(),
            bob.state.as_deref(),
            &STATE_KEY,
        )
        .expect("bob establish");
        let reply = handle_operation(
            "encryptForDevices",
            &json!({
                "accountId": "page-bob",
                "recipients": [{
                    "deviceId": "page-alice-device",
                    "identityKey": alice.result["identityKey"],
                    "sessionGeneration": 6,
                    "plaintext": "reply",
                }]
            })
            .to_string(),
            bob_received.state.as_deref(),
            &STATE_KEY,
        )
        .expect("reply");
        let reply_envelope = &reply.result["envelopes"][0];
        let alice_received = handle_operation(
            "decryptEnvelope",
            &json!({
                "accountId": "page-alice",
                "deviceId": "page-bob-device",
                "identityKey": bob.result["identityKey"],
                "sessionGeneration": 4,
                "messageType": reply_envelope["messageType"],
                "ciphertext": reply_envelope["ciphertext"],
            })
            .to_string(),
            prekey.state.as_deref(),
            &STATE_KEY,
        )
        .expect("alice receives reply");

        let mut alice_state = alice_received.state.expect("alice ready state");
        let mut chronological = Vec::new();
        for index in 0..50usize {
            let encrypted = handle_operation(
                "encryptForDevices",
                &json!({
                    "accountId": "page-alice",
                    "recipients": [{
                        "deviceId": "page-bob-device",
                        "identityKey": bob.result["identityKey"],
                        "sessionGeneration": 4,
                        "plaintext": format!("page-message-{index}"),
                    }]
                })
                .to_string(),
                Some(&alice_state),
                &STATE_KEY,
            )
            .expect("continuation");
            let envelope = &encrypted.result["envelopes"][0];
            assert_eq!(envelope["messageType"], 1);
            chronological.push(json!({
                "index": index,
                "deviceId": "page-alice-device",
                "identityKey": alice.result["identityKey"],
                "sessionGeneration": 6,
                "messageType": envelope["messageType"],
                "ciphertext": envelope["ciphertext"],
            }));
            alice_state = encrypted.state.expect("advanced alice state");
        }
        let individual_chronological = chronological.clone();
        chronological.reverse();
        let batch_started = std::time::Instant::now();
        let batch = handle_operation(
            "decryptEnvelopes",
            &json!({
                "accountId": "page-bob",
                "envelopes": chronological,
            })
            .to_string(),
            reply.state.as_deref(),
            &STATE_KEY,
        )
        .expect("50-message newest-first page");
        let batch_elapsed = batch_started.elapsed();
        let results = batch.result["results"].as_array().expect("results");
        assert_eq!(results.len(), 50);
        for (position, result) in results.iter().enumerate() {
            let expected_index = 49 - position;
            assert_eq!(result["index"], expected_index);
            assert_eq!(result["ok"], true);
            assert_eq!(
                result["plaintext"],
                format!("page-message-{expected_index}")
            );
        }

        let mut individual_state = reply.state.expect("bob ready state");
        let individual_started = std::time::Instant::now();
        for envelope in individual_chronological {
            let decrypted = handle_operation(
                "decryptEnvelope",
                &json!({
                    "accountId": "page-bob",
                    "deviceId": envelope["deviceId"],
                    "identityKey": envelope["identityKey"],
                    "sessionGeneration": envelope["sessionGeneration"],
                    "messageType": envelope["messageType"],
                    "ciphertext": envelope["ciphertext"],
                })
                .to_string(),
                Some(&individual_state),
                &STATE_KEY,
            )
            .expect("individual chronological decrypt");
            individual_state = decrypted.state.expect("individual durable state");
        }
        let individual_elapsed = individual_started.elapsed();
        eprintln!(
            "50-message host benchmark: batch={batch_elapsed:?}, individual={individual_elapsed:?}"
        );
    }

    #[test]
    fn libolm_account_pickle_uses_utf8_pickle_key_bytes() {
        let key = "bGliLW9sbS1waWNrbGUta2V5LWlzLXV0Zjg=";
        let mut original = Account::new();
        original.generate_one_time_keys(3);
        let expected_identity = original.curve25519_key().to_base64();
        let expected_signing = original.ed25519_key().to_base64();
        let pickle = original
            .to_libolm_pickle(key.as_bytes())
            .expect("libolm-compatible pickle");
        let imported = handle_operation(
            "bootstrap",
            &json!({
                "accountId": "legacy",
                "legacyAccountPickle": pickle,
                "legacyPickleKey": key,
                "legacySessions": [],
                "expectedIdentityKey": expected_identity,
                "expectedSigningKey": expected_signing,
            })
            .to_string(),
            None,
            &STATE_KEY,
        )
        .expect("legacy import");
        let result = imported.result;
        assert_eq!(result["identityKey"], expected_identity);
        assert_eq!(result["signingKey"], expected_signing);
        assert_eq!(result["migrated"], true);
    }

    #[test]
    fn imports_real_js_libolm_account_and_session_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/js-libolm-account-session.json"
        ))
        .expect("fixture JSON");
        let payload = json!({
            "accountId": "js-fixture",
            "legacyAccountPickle": fixture["accountPickle"],
            "legacyPickleKey": fixture["pickleKey"],
            "expectedIdentityKey": fixture["identityKey"],
            "expectedSigningKey": fixture["signingKey"],
            "legacySessions": [{
                "deviceId": fixture["session"]["deviceId"],
                "identityKey": fixture["session"]["identityKey"],
                "sessionGeneration": fixture["session"]["sessionGeneration"],
                "sessionId": fixture["session"]["sessionId"],
                "pickle": fixture["session"]["pickle"],
            }]
        });
        let imported = handle_operation("bootstrap", &payload.to_string(), None, &STATE_KEY)
            .expect("JS libolm import");
        assert_eq!(imported.result["identityKey"], fixture["identityKey"]);
        assert_eq!(imported.result["signingKey"], fixture["signingKey"]);
        assert_eq!(imported.result["importedSessionCount"], 1);
        let state = imported.state.expect("imported state");
        let sessions = handle_operation(
            "hasSessions",
            &json!({
                "accountId": "js-fixture",
                "recipients": [{
                    "deviceId": fixture["session"]["deviceId"],
                    "identityKey": fixture["session"]["identityKey"],
                    "sessionGeneration": fixture["session"]["sessionGeneration"],
                }]
            })
            .to_string(),
            Some(&state),
            &STATE_KEY,
        )
        .expect("session lookup");
        assert_eq!(sessions.result["sessions"][0]["available"], true);

        // Ed25519 signatures are deterministic. This signature was produced
        // by the actual @matrix-org/olm JS account stored in the fixture.
        let signed = handle_operation(
            "sign",
            &json!({
                "accountId": "js-fixture",
                "message": fixture["signedMessage"],
            })
            .to_string(),
            Some(&state),
            &STATE_KEY,
        )
        .expect("native signing with imported JS identity");
        assert_eq!(signed.result["signature"], fixture["signature"]);
        let verified = handle_operation(
            "verify",
            &json!({
                "signingKey": fixture["signingKey"],
                "message": fixture["signedMessage"],
                "signature": fixture["signature"],
            })
            .to_string(),
            None,
            &STATE_KEY,
        )
        .expect("native verification of JS signature");
        assert_eq!(verified.result["valid"], true);
        let mutation = handle_operation(
            "verify",
            &json!({
                "signingKey": fixture["signingKey"],
                "message": "orizo-native-ed25519-interoperability-v1-mutated",
                "signature": fixture["signature"],
            })
            .to_string(),
            None,
            &STATE_KEY,
        );
        assert!(matches!(mutation, Err(BridgeError::InvalidSignature)));

        // PR #383 fixes the imported libolm next-key counter. Generating a
        // fresh key must retain all five imported unpublished keys and add a
        // distinct sixth key rather than overwriting the last imported ID.
        let replenished = handle_operation(
            "generateOneTimeKeys",
            r#"{"accountId":"js-fixture","count":1}"#,
            Some(&state),
            &STATE_KEY,
        )
        .expect("one-time key replenishment");
        assert_eq!(
            replenished.result["oneTimeKeys"]
                .as_object()
                .expect("one-time keys")
                .len(),
            fixture["oneTimeKeyCount"].as_u64().expect("fixture count") as usize + 1
        );
    }

    #[test]
    fn skips_corrupt_legacy_session_but_keeps_verified_account_and_valid_session() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/js-libolm-account-session.json"
        ))
        .expect("fixture JSON");
        let response = handle_operation(
            "bootstrap",
            &json!({
                "accountId": "bad-session",
                "legacyAccountPickle": fixture["accountPickle"],
                "legacyPickleKey": fixture["pickleKey"],
                "expectedIdentityKey": fixture["identityKey"],
                "expectedSigningKey": fixture["signingKey"],
                "legacySessions": [
                    {
                        "deviceId": fixture["session"]["deviceId"],
                        "identityKey": fixture["session"]["identityKey"],
                        "sessionGeneration": fixture["session"]["sessionGeneration"],
                        "sessionId": fixture["session"]["sessionId"],
                        "pickle": fixture["session"]["pickle"],
                    },
                    {
                        "deviceId": "corrupt-device",
                        "identityKey": fixture["session"]["identityKey"],
                        "sessionGeneration": 77,
                        "sessionId": "wrong-session-id",
                        "pickle": "not-a-valid-libolm-pickle",
                    }
                ]
            })
            .to_string(),
            None,
            &STATE_KEY,
        )
        .expect("verified account migration must survive one corrupt session");
        assert_eq!(response.result["identityKey"], fixture["identityKey"]);
        assert_eq!(response.result["signingKey"], fixture["signingKey"]);
        assert_eq!(response.result["importedSessionCount"], 1);
        assert_eq!(response.result["skippedSessionCount"], 1);
        assert!(response.state.is_some());
    }

    fn import_paired_fixture(side: &str, account_id: &str) -> (Value, OperationResult) {
        let fixture: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/js-libolm-paired-sessions.json"
        ))
        .expect("paired fixture JSON");
        let account = &fixture[side];
        let imported = handle_operation(
            "bootstrap",
            &json!({
                "accountId": account_id,
                "legacyAccountPickle": account["accountPickle"],
                "legacyPickleKey": fixture["pickleKey"],
                "expectedIdentityKey": account["identityKey"],
                "expectedSigningKey": account["signingKey"],
                "legacySessions": [{
                    "deviceId": account["peerDeviceId"],
                    "identityKey": account["peerIdentityKey"],
                    "sessionGeneration": account["sessionGeneration"],
                    "sessionId": account["sessionId"],
                    "pickle": account["sessionPickle"],
                }]
            })
            .to_string(),
            None,
            &STATE_KEY,
        )
        .expect("paired fixture import");
        (fixture, imported)
    }

    #[test]
    fn native_ratchet_continuation_from_real_js_state_decrypts_on_real_js_peer_state() {
        for (side, peer, expected_name) in [
            ("alice", "bob", "aliceEncrypt"),
            ("bob", "alice", "bobEncrypt"),
        ] {
            let account_id = format!("paired-{side}");
            let (fixture, imported) = import_paired_fixture(side, &account_id);
            let account = &fixture[side];
            let expected = &fixture["expected"][expected_name];
            let encrypted = handle_operation(
                "encryptForDevices",
                &json!({
                    "accountId": account_id,
                    "recipients": [{
                        "deviceId": account["peerDeviceId"],
                        "identityKey": account["peerIdentityKey"],
                        "sessionGeneration": account["sessionGeneration"],
                        "plaintext": expected["plaintext"],
                    }]
                })
                .to_string(),
                imported.state.as_deref(),
                &STATE_KEY,
            )
            .expect("native continuation encrypt");
            assert_eq!(
                encrypted.result["envelopes"][0]["messageType"],
                expected["type"]
            );
            assert!(
                encrypted.state.is_some(),
                "ratchet state must persist before return"
            );

            // Olm uses fresh randomness when a sending ratchet is created, so
            // equivalent ciphertext is intentionally not byte-identical. The
            // compatibility property is that the peer session created and
            // pickled by actual JS libolm decrypts the native message.
            let peer_account_id = format!("paired-{peer}-receiving-native");
            let (_, peer_imported) = import_paired_fixture(peer, &peer_account_id);
            let peer_account = &fixture[peer];
            let envelope = &encrypted.result["envelopes"][0];
            let decrypted = handle_operation(
                "decryptEnvelope",
                &json!({
                    "accountId": peer_account_id,
                    "deviceId": peer_account["peerDeviceId"],
                    "identityKey": peer_account["peerIdentityKey"],
                    "sessionGeneration": peer_account["sessionGeneration"],
                    "messageType": envelope["messageType"],
                    "ciphertext": envelope["ciphertext"],
                })
                .to_string(),
                peer_imported.state.as_deref(),
                &STATE_KEY,
            )
            .expect("JS-created peer state decrypts native continuation");
            assert_eq!(decrypted.result["plaintext"], expected["plaintext"]);
        }
    }

    #[test]
    fn native_imported_session_decrypts_js_messages_across_restarts_and_out_of_order() {
        let (fixture, imported) = import_paired_fixture("bob", "paired-bob-decrypt");
        let bob = &fixture["bob"];
        let expected = &fixture["expected"]["aliceEncrypt"];
        let decrypt = |state: &[u8], message: &Value| {
            handle_operation(
                "decryptEnvelope",
                &json!({
                    "accountId": "paired-bob-decrypt",
                    "deviceId": bob["peerDeviceId"],
                    "identityKey": bob["peerIdentityKey"],
                    "sessionGeneration": bob["sessionGeneration"],
                    "messageType": message["type"],
                    "ciphertext": message["body"],
                })
                .to_string(),
                Some(state),
                &STATE_KEY,
            )
            .expect("native continuation decrypt")
        };
        let initial_state = imported.state.expect("imported state");
        let decrypted = decrypt(&initial_state, expected);
        assert_eq!(decrypted.result["plaintext"], expected["plaintext"]);

        let (_, imported_again) = import_paired_fixture("bob", "paired-bob-decrypt");
        let initial_state = imported_again.state.expect("reimported state");
        let second = &fixture["expected"]["outOfOrder"][1];
        let first = &fixture["expected"]["outOfOrder"][0];
        let decrypted_second = decrypt(&initial_state, second);
        assert_eq!(decrypted_second.result["plaintext"], second["plaintext"]);
        let restarted_state = decrypted_second.state.expect("persisted skipped-key state");
        let decrypted_first = decrypt(&restarted_state, first);
        assert_eq!(decrypted_first.result["plaintext"], first["plaintext"]);
    }

    #[test]
    fn authenticated_state_rejects_tampering_before_deserialization() {
        let state = handle_operation(
            "bootstrap",
            r#"{"accountId":"tamper","oneTimeKeyCount":1}"#,
            None,
            &STATE_KEY,
        )
        .expect("bootstrap")
        .state
        .expect("state");
        for index in [0, STATE_MAGIC.len() + STATE_NONCE_BYTES, state.len() - 1] {
            let mut tampered = state.clone();
            tampered[index] ^= 0x80;
            assert!(matches!(
                RuntimeState::from_bytes(Some(&tampered), "tamper", &STATE_KEY),
                Err(BridgeError::InvalidState)
            ));
        }
    }

    #[test]
    fn identity_mismatch_never_returns_state() {
        let response = handle_operation(
            "bootstrap",
            r#"{"accountId":"test","expectedIdentityKey":"wrong"}"#,
            None,
            &STATE_KEY,
        );
        assert!(matches!(response, Err(BridgeError::IdentityMismatch)));
    }

    #[test]
    fn persisted_state_is_bound_to_account_namespace() {
        let state = handle_operation(
            "bootstrap",
            r#"{"accountId":"alice","oneTimeKeyCount":1}"#,
            None,
            &STATE_KEY,
        )
        .expect("bootstrap")
        .state
        .expect("state");
        assert!(matches!(
            RuntimeState::from_bytes(Some(&state), "bob", &STATE_KEY),
            Err(BridgeError::InvalidState)
        ));
    }

    #[test]
    fn signed_fallback_key_opens_sessions_for_several_senders_once_otks_are_gone() {
        let bob = handle_operation(
            "bootstrap",
            r#"{"accountId":"fb-bob","oneTimeKeyCount":0}"#,
            None,
            &STATE_KEY,
        )
        .expect("bob bootstrap");
        let generated = handle_operation(
            "fallbackKey",
            r#"{"accountId":"fb-bob","deviceId":"fb-bob-device","rotate":true}"#,
            bob.state.as_deref(),
            &STATE_KEY,
        )
        .expect("fallback");
        let keys = generated.result["fallbackKeys"]
            .as_array()
            .expect("keys")
            .clone();
        assert_eq!(keys.len(), 1);
        let key = &keys[0];
        let statement = fallback_key_statement(
            "fb-bob-device",
            key["keyId"].as_str().unwrap(),
            key["publicKey"].as_str().unwrap(),
        );
        let verified = handle_operation(
            "verify",
            &json!({"signingKey": bob.result["signingKey"], "message": statement, "signature": key["signature"]}).to_string(),
            None,
            &STATE_KEY,
        )
        .expect("signature verifies");
        assert_eq!(verified.result["valid"], true);
        // A different device id must not verify: the statement is bound to it.
        let other = fallback_key_statement(
            "another-device",
            key["keyId"].as_str().unwrap(),
            key["publicKey"].as_str().unwrap(),
        );
        assert!(handle_operation(
            "verify",
            &json!({"signingKey": bob.result["signingKey"], "message": other, "signature": key["signature"]}).to_string(),
            None,
            &STATE_KEY,
        )
        .is_err());
        let published = handle_operation(
            "markOneTimeKeysPublished",
            r#"{"accountId":"fb-bob"}"#,
            generated.state.as_deref(),
            &STATE_KEY,
        )
        .expect("publish");
        let mut bob_state = published.state.expect("bob state");
        let again = handle_operation(
            "fallbackKey",
            r#"{"accountId":"fb-bob","deviceId":"fb-bob-device"}"#,
            Some(&bob_state),
            &STATE_KEY,
        )
        .expect("no rotation");
        assert!(
            again.result["fallbackKeys"].as_array().unwrap().is_empty(),
            "published key is not re-offered"
        );
        assert!(again.state.is_none());

        for sender in ["fb-alice", "fb-carol"] {
            let account = handle_operation(
                "bootstrap",
                &json!({"accountId": sender, "oneTimeKeyCount": 0}).to_string(),
                None,
                &STATE_KEY,
            )
            .expect("sender bootstrap");
            let encrypted = handle_operation(
                "encryptForDevices",
                &json!({
                    "accountId": sender,
                    "recipients": [{
                        "deviceId": "fb-bob-device",
                        "identityKey": bob.result["identityKey"],
                        "sessionGeneration": 0,
                        "oneTimeKey": key["publicKey"],
                        "plaintext": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                    }]
                })
                .to_string(),
                account.state.as_deref(),
                &STATE_KEY,
            )
            .expect("encrypt to fallback key");
            let envelope = &encrypted.result["envelopes"][0];
            assert_eq!(envelope["messageType"], 0);
            let decrypted = handle_operation(
                "decryptEnvelope",
                &json!({
                    "accountId": "fb-bob",
                    "replayId": format!("{sender}-message"),
                    "deviceId": format!("{sender}-device"),
                    "identityKey": account.result["identityKey"],
                    "sessionGeneration": 0,
                    "messageType": envelope["messageType"],
                    "ciphertext": envelope["ciphertext"],
                })
                .to_string(),
                Some(&bob_state),
                &STATE_KEY,
            )
            .expect("fallback session decrypts");
            assert_eq!(
                decrypted.result["plaintext"],
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
            );
            bob_state = decrypted.state.expect("bob state after decrypt");
        }
    }

    #[test]
    fn full_local_one_time_key_store_never_discards_private_keys() {
        let bootstrapped = handle_operation(
            "bootstrap",
            r#"{"accountId":"full","oneTimeKeyCount":50}"#,
            None,
            &STATE_KEY,
        )
        .expect("bootstrap");
        let published = handle_operation(
            "markOneTimeKeysPublished",
            r#"{"accountId":"full"}"#,
            bootstrapped.state.as_deref(),
            &STATE_KEY,
        )
        .expect("publish");
        let published_state = published.state.expect("published state");
        let before = RuntimeState::from_bytes(Some(&published_state), "full", &STATE_KEY)
            .expect("before state");
        let before_pickle = serde_json::to_value(before.account.pickle()).expect("before pickle");
        assert_eq!(before.account.stored_one_time_key_count(), 50);

        let generated = handle_operation(
            "generateOneTimeKeys",
            r#"{"accountId":"full","count":40}"#,
            Some(&published_state),
            &STATE_KEY,
        )
        .expect("safe generation");
        assert!(
            generated.result["oneTimeKeys"]
                .as_object()
                .expect("keys")
                .is_empty()
        );
        let generated_state = generated.state.expect("generated state");
        let after = RuntimeState::from_bytes(Some(&generated_state), "full", &STATE_KEY)
            .expect("after state");
        assert_eq!(after.account.stored_one_time_key_count(), 50);
        assert_eq!(
            serde_json::to_value(after.account.pickle()).expect("after pickle"),
            before_pickle
        );
    }

    #[test]
    fn clear_sessions_forces_next_outbound_to_use_a_prekey() {
        let alice = handle_operation(
            "bootstrap",
            r#"{"accountId":"clear-alice","oneTimeKeyCount":1}"#,
            None,
            &STATE_KEY,
        )
        .expect("alice bootstrap");
        let bob = handle_operation(
            "bootstrap",
            r#"{"accountId":"clear-bob","oneTimeKeyCount":2}"#,
            None,
            &STATE_KEY,
        )
        .expect("bob bootstrap");
        let bob_keys: Vec<_> = bob.result["unpublishedOneTimeKeys"]
            .as_object()
            .expect("bob keys")
            .values()
            .cloned()
            .collect();
        assert_eq!(bob_keys.len(), 2);
        let first = handle_operation(
            "encryptForDevices",
            &json!({
                "accountId": "clear-alice",
                "recipients": [{
                    "deviceId": "clear-bob-device",
                    "identityKey": bob.result["identityKey"],
                    "sessionGeneration": 1,
                    "oneTimeKey": bob_keys[0],
                    "plaintext": "before-reset",
                }]
            })
            .to_string(),
            alice.state.as_deref(),
            &STATE_KEY,
        )
        .expect("first outbound");
        assert_eq!(first.result["envelopes"][0]["messageType"], 0);
        let cleared = handle_operation(
            "clearSessions",
            r#"{"accountId":"clear-alice"}"#,
            first.state.as_deref(),
            &STATE_KEY,
        )
        .expect("clear sessions");
        assert_eq!(cleared.result["clearedSessionCount"], 1);
        let has_sessions = handle_operation(
            "hasSessions",
            &json!({
                "accountId": "clear-alice",
                "recipients": [{
                    "deviceId": "clear-bob-device",
                    "identityKey": bob.result["identityKey"],
                    "sessionGeneration": 1,
                }]
            })
            .to_string(),
            cleared.state.as_deref(),
            &STATE_KEY,
        )
        .expect("session lookup");
        assert_eq!(has_sessions.result["sessions"][0]["available"], false);

        let after_reset = handle_operation(
            "encryptForDevices",
            &json!({
                "accountId": "clear-alice",
                "recipients": [{
                    "deviceId": "clear-bob-device",
                    "identityKey": bob.result["identityKey"],
                    "sessionGeneration": 2,
                    "oneTimeKey": bob_keys[1],
                    "plaintext": "after-reset",
                }]
            })
            .to_string(),
            cleared.state.as_deref(),
            &STATE_KEY,
        )
        .expect("new outbound after clear");
        assert_eq!(after_reset.result["envelopes"][0]["messageType"], 0);
    }

    #[test]
    fn reset_replaces_otks_without_changing_account_identity() {
        let bootstrapped = handle_operation(
            "bootstrap",
            r#"{"accountId":"repair","oneTimeKeyCount":50}"#,
            None,
            &STATE_KEY,
        )
        .expect("bootstrap");
        let identity = bootstrapped.result["identityKey"].clone();
        let signing = bootstrapped.result["signingKey"].clone();
        let old_keys: std::collections::BTreeSet<_> = bootstrapped.result["unpublishedOneTimeKeys"]
            .as_object()
            .expect("old keys")
            .values()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        assert_eq!(old_keys.len(), 50);

        let reset = handle_operation(
            "resetSessionsAndOneTimeKeys",
            r#"{"accountId":"repair","count":50}"#,
            bootstrapped.state.as_deref(),
            &STATE_KEY,
        )
        .expect("reset");
        let new_keys: std::collections::BTreeSet<_> = reset.result["oneTimeKeys"]
            .as_object()
            .expect("new keys")
            .values()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        assert_eq!(new_keys.len(), 50);
        assert!(old_keys.is_disjoint(&new_keys));
        let reset_state = reset.state.expect("durable reset state");
        let restored = RuntimeState::from_bytes(Some(&reset_state), "repair", &STATE_KEY)
            .expect("restored reset state");
        assert_eq!(restored.account.curve25519_key().to_base64(), identity);
        assert_eq!(restored.account.ed25519_key().to_base64(), signing);
        assert_eq!(restored.account.stored_one_time_key_count(), 50);
        assert_eq!(restored.sessions.len(), 0);
    }

    #[cfg(not(target_os = "android"))]
    #[test]
    fn apple_c_abi_returns_owned_wire_state_and_zeroizable_kdf_bytes() {
        let operation = b"bootstrap";
        let payload = br#"{"accountId":"ffi-apple","oneTimeKeyCount":1}"#;
        let mut output_length = 0usize;
        let output = unsafe {
            orizo_olm_invoke(
                operation.as_ptr(),
                operation.len(),
                payload.as_ptr(),
                payload.len(),
                std::ptr::null(),
                0,
                STATE_KEY.as_ptr(),
                STATE_KEY.len(),
                &mut output_length,
            )
        };
        assert!(!output.is_null());
        assert!(output_length > 14);
        // SAFETY: the ABI returned an allocation of exactly output_length.
        let wire = unsafe { std::slice::from_raw_parts(output, output_length) };
        assert_eq!(&wire[..4], &BRIDGE_MAGIC.to_be_bytes());
        assert_eq!(wire[4], BRIDGE_VERSION);
        assert_eq!(wire[5], 1);
        unsafe { orizo_olm_free(output, output_length) };

        let password = b"correct horse battery staple";
        let salt = [
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
            0x0e, 0x0f,
        ];
        let mut key_length = 0usize;
        let mut error_code = -1i32;
        let key = unsafe {
            orizo_olm_derive_recovery_passphrase_key(
                password.as_ptr(),
                password.len(),
                salt.as_ptr(),
                salt.len(),
                &mut key_length,
                &mut error_code,
            )
        };
        assert_eq!(error_code, 0);
        assert_eq!(key_length, 32);
        assert!(!key.is_null());
        let expected =
            decode_hex_32("bbe4ce725d8b1ae6f8c3f70b21dac67681bf71b53ffc4b805c35e6faa4477eab");
        let actual = unsafe { std::slice::from_raw_parts(key, key_length) };
        assert_eq!(actual, expected);
        unsafe { orizo_olm_free(key, key_length) };
    }
}
