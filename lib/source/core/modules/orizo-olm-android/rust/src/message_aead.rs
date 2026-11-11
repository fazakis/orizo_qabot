//! Existing message-body AEAD on a native worker. No ratchet/state mutations.
use super::BridgeError;
use base64::{Engine, engine::general_purpose::STANDARD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{AeadInOut, KeyInit},
};
use serde::Deserialize;
use serde_json::{Value, json};
use zeroize::{Zeroize, Zeroizing};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    key: Vec<u8>,
    nonce: String,
    conversation_id: String,
    client_message_id: String,
    decrypt: bool,
    plaintext: Option<String>,
    ciphertext: Option<String>,
}
impl Drop for Request {
    fn drop(&mut self) {
        self.key.zeroize();
        if let Some(value) = &mut self.plaintext {
            value.zeroize();
        }
    }
}

pub(super) fn transform(payload: &str) -> Result<Value, BridgeError> {
    if payload.len() > 8 * 1024 * 1024 {
        return Err(BridgeError::InvalidRequest);
    }
    let request: Request =
        serde_json::from_str(payload).map_err(|_| BridgeError::InvalidRequest)?;
    transform_request(request)
}

/// Stateless, ordered batch. A corrupt message must not discard successful
/// siblings, and no result carries ratchet state or untrusted error text.
pub(super) fn transform_batch(payload: &str) -> Result<Value, BridgeError> {
    if payload.len() > 8 * 1024 * 1024 {
        return Err(BridgeError::InvalidRequest);
    }
    #[derive(Deserialize)]
    struct Batch {
        requests: Vec<Request>,
    }
    let batch: Batch = serde_json::from_str(payload).map_err(|_| BridgeError::InvalidRequest)?;
    if batch.requests.is_empty() || batch.requests.len() > 16 {
        return Err(BridgeError::InvalidRequest);
    }
    let results: Vec<Value> = batch
        .requests
        .into_iter()
        .map(|request| match transform_request(request) {
            Ok(result) => json!({"ok": true, "result": result}),
            Err(_) => json!({"ok": false, "code": "message_body_crypto_failed"}),
        })
        .collect();
    Ok(json!({"results": results}))
}

fn transform_request(request: Request) -> Result<Value, BridgeError> {
    if request.key.len() != 32
        || request.conversation_id.len() > 4096
        || request.client_message_id.len() > 4096
    {
        return Err(BridgeError::InvalidRequest);
    }
    let nonce = STANDARD
        .decode(&request.nonce)
        .map_err(|_| BridgeError::InvalidRequest)?;
    let nonce = XNonce::try_from(nonce.as_slice()).map_err(|_| BridgeError::InvalidRequest)?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(&request.key).map_err(|_| BridgeError::InvalidRequest)?;
    // Keep this byte-for-byte identical to aadFor() in existing clients.
    let aad = format!(
        "orizo-e2ee-content-v1:{}:{}",
        request.conversation_id, request.client_message_id
    );
    if request.decrypt {
        let mut bytes = Zeroizing::new(
            STANDARD
                .decode(
                    request
                        .ciphertext
                        .as_ref()
                        .ok_or(BridgeError::InvalidRequest)?,
                )
                .map_err(|_| BridgeError::InvalidRequest)?,
        );
        cipher
            .decrypt_in_place(&nonce, aad.as_bytes(), &mut *bytes)
            .map_err(|_| BridgeError::Decryption)?;
        let plaintext = std::str::from_utf8(&bytes).map_err(|_| BridgeError::Decryption)?;
        Ok(json!({"plaintext": plaintext}))
    } else {
        let mut bytes = Zeroizing::new(
            request
                .plaintext
                .as_ref()
                .ok_or(BridgeError::InvalidRequest)?
                .as_bytes()
                .to_vec(),
        );
        cipher
            .encrypt_in_place(&nonce, aad.as_bytes(), &mut *bytes)
            .map_err(|_| BridgeError::MessageEncoding)?;
        Ok(json!({"ciphertext": STANDARD.encode(&*bytes)}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const BODY: &str = "{\"version\":1,\"body\":\"hello Ελληνικά 💪\",\"eventType\":\"message\"}";
    const CIPHER: &str = "/yQ9fgdSr58ZMnnKa/OsJk7jUl0hfVN5xjAcw7XqmnR3wjYLpZLcQwYTEVH5+6SIHUb//UCOgtXwGqgIDrQjLSu4RgL+MCeKmdbgOR4ohVvmtRlKhqA+BQ==";
    fn request(decrypt: bool) -> Value {
        json!({"key":vec![7u8;32],"nonce":STANDARD.encode([3u8;24]),"conversationId":"thread-a",
            "clientMessageId":"client-b","decrypt":decrypt,"plaintext":BODY,"ciphertext":CIPHER})
    }
    #[test]
    fn exact_noble_wire_compatibility_both_directions() {
        assert_eq!(
            transform(&request(false).to_string()).unwrap(),
            json!({"ciphertext": CIPHER})
        );
        assert_eq!(
            transform(&request(true).to_string()).unwrap(),
            json!({"plaintext": BODY})
        );
    }
    #[test]
    fn rejects_tampering_wrong_context_key_and_nonce() {
        for field in ["conversationId", "clientMessageId", "ciphertext", "nonce"] {
            let mut req = request(true);
            req[field] = json!("wrong");
            assert!(transform(&req.to_string()).is_err());
        }
        let mut req = request(true);
        req["key"] = json!(vec![8u8; 32]);
        assert!(transform(&req.to_string()).is_err());
        req["key"] = json!(vec![7u8; 31]);
        assert!(transform(&req.to_string()).is_err());
    }
    #[test]
    fn long_unicode_roundtrip_without_truncation() {
        let text = "**Ελληνικά** 💪\n".repeat(20_000);
        let mut req = request(false);
        req["plaintext"] = json!(text);
        let sealed = transform(&req.to_string()).unwrap();
        req["decrypt"] = json!(true);
        req["ciphertext"] = sealed["ciphertext"].clone();
        assert_eq!(transform(&req.to_string()).unwrap()["plaintext"], text);
    }
    #[test]
    fn batch_preserves_order_and_isolates_authentication_failure() {
        let mut invalid = request(true);
        invalid["conversationId"] = json!("wrong");
        let batch = json!({"requests": [request(false), invalid, request(true)]});
        let result = transform_batch(&batch.to_string()).unwrap();
        assert_eq!(
            result["results"][0],
            json!({"ok":true,"result":{"ciphertext":CIPHER}})
        );
        assert_eq!(
            result["results"][1],
            json!({"ok":false,"code":"message_body_crypto_failed"})
        );
        assert_eq!(
            result["results"][2],
            json!({"ok":true,"result":{"plaintext":BODY}})
        );
    }
    #[test]
    fn batch_rejects_empty_overflow_and_malformed_requests() {
        for count in [0, 17] {
            assert!(
                transform_batch(&json!({"requests":vec![request(true);count]}).to_string())
                    .is_err()
            );
        }
        assert!(transform_batch("{\"requests\":[{}]}").is_err());
        assert_eq!(transform_batch(&json!({"requests":vec![request(true);16]}).to_string()).unwrap()["results"].as_array().unwrap().len(),16);
    }
}
