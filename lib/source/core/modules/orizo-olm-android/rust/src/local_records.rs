//! Stateless local-record AEAD, wire-compatible with the existing JS cache.
//! This never reads or mutates an Olm session or creates a device identity.
use super::BridgeError;
use base64::{Engine, engine::general_purpose::STANDARD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{AeadInOut, KeyInit},
};
use serde::Deserialize;
use serde_json::{Value, json};
use zeroize::{Zeroize, Zeroizing};

const MAX_BATCH_BYTES: usize = 8 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    key: Vec<u8>,
    decrypt: bool,
    records: Vec<Record>,
}
impl Drop for Request {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}
#[derive(Deserialize)]
struct Record {
    context: String,
    plaintext: Option<String>,
    nonce: Option<String>,
    ciphertext: Option<String>,
}
impl Drop for Record {
    fn drop(&mut self) {
        if let Some(value) = &mut self.plaintext {
            value.zeroize();
        }
    }
}

pub(super) fn transform(payload: &str) -> Result<Value, BridgeError> {
    if payload.len() > MAX_BATCH_BYTES {
        return Err(BridgeError::InvalidRequest);
    }
    let request: Request =
        serde_json::from_str(payload).map_err(|_| BridgeError::InvalidRequest)?;
    if request.key.len() != 32 || request.records.len() > 100 {
        return Err(BridgeError::InvalidRequest);
    }
    let cipher =
        XChaCha20Poly1305::new_from_slice(&request.key).map_err(|_| BridgeError::InvalidRequest)?;
    let mut results = Vec::with_capacity(request.records.len());
    for record in &request.records {
        if record.context.len() > 4096 {
            return Err(BridgeError::InvalidRequest);
        }
        let aad = format!("message-local-record-v1:{}", record.context);
        if request.decrypt {
            // A damaged row must not hide every other valid message in its page.
            let opened = (|| {
                let nonce = STANDARD.decode(record.nonce.as_ref()?).ok()?;
                let nonce = XNonce::try_from(nonce.as_slice()).ok()?;
                let mut bytes = Zeroizing::new(STANDARD.decode(record.ciphertext.as_ref()?).ok()?);
                cipher
                    .decrypt_in_place(&nonce, aad.as_bytes(), &mut *bytes)
                    .ok()?;
                String::from_utf8(bytes.to_vec()).ok()
            })();
            results.push(opened.map(Value::String).unwrap_or(Value::Null));
        } else {
            let plaintext = record
                .plaintext
                .as_ref()
                .ok_or(BridgeError::InvalidRequest)?;
            let mut bytes = Zeroizing::new(plaintext.as_bytes().to_vec());
            let mut nonce = [0u8; 24];
            getrandom::fill(&mut nonce).map_err(|_| BridgeError::InvalidRequest)?;
            cipher
                .encrypt_in_place(&XNonce::from(nonce), aad.as_bytes(), &mut *bytes)
                .map_err(|_| BridgeError::MessageEncoding)?;
            results.push(
                json!({"nonce": STANDARD.encode(nonce), "ciphertext": STANDARD.encode(&*bytes)}),
            );
        }
    }
    Ok(Value::Array(results))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_existing_noble_ciphertext_without_rekey_or_cache_wipe() {
        // Generated using the production @noble/ciphers XChaCha20-Poly1305 path.
        let result = transform(
            &json!({"key":vec![7u8;32],"decrypt":true,"records":[{
                "context":"thread:a:message:b",
                "nonce":"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD",
                "ciphertext":"7GMndxoBCGW5q41AiWYA9OQjvt3NubLqr0vG5xS8E3S6Anmj7K0="
            }]})
            .to_string(),
        )
        .unwrap();
        assert_eq!(result, json!(["hello Ελληνικά"]));
    }
    #[test]
    fn round_trip_and_wrong_context_are_isolated() {
        let sealed = transform(
            &json!({"key": vec![7u8;32], "decrypt": false,
            "records": [{"context":"thread:a:message:b","plaintext":"hello Ελληνικά"}]})
            .to_string(),
        )
        .unwrap();
        let mut row = sealed[0].clone();
        row["context"] = json!("thread:a:message:b");
        let mut wrong = row.clone();
        wrong["context"] = json!("thread:other:message:b");
        let opened = transform(
            &json!({"key":vec![7u8;32],"decrypt":true,"records":[wrong,row]}).to_string(),
        )
        .unwrap();
        assert_eq!(opened, json!([null, "hello Ελληνικά"]));
    }
    #[test]
    fn rejects_invalid_keys_and_oversized_batches() {
        assert!(
            transform(&json!({"key":vec![0;31],"decrypt":true,"records":[]}).to_string()).is_err()
        );
        assert!(transform(&json!({"key":vec![0;32],"decrypt":true,"records":vec![json!({"context":"x"});101]}).to_string()).is_err());
    }
}
