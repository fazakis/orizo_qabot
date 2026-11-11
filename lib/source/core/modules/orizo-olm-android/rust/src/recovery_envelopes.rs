//! Existing recovery wire format; stateless, bounded send-side key wrapping.
use super::BridgeError;
use base64::{Engine, engine::general_purpose::STANDARD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use hkdf::Hkdf;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Sha256;
use zeroize::{Zeroize, Zeroizing};
const SCHEME: &str = "sealed_x25519_xchacha_v1";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Recipient {
    user_id: u64,
    epoch: u64,
    recovery_public_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    content_key: String,
    recipients: Vec<Recipient>,
    conversation_id: String,
    client_message_id: String,
}
impl Drop for Request {
    fn drop(&mut self) {
        self.content_key.zeroize();
    }
}
pub(super) fn transform(payload: &str) -> Result<Value, BridgeError> {
    if payload.len() > 512 * 1024 {
        return Err(BridgeError::InvalidRequest);
    }
    let req: Request = serde_json::from_str(payload).map_err(|_| BridgeError::InvalidRequest)?;
    if req.recipients.is_empty()
        || req.recipients.len() > 32
        || req.conversation_id.len() > 4096
        || req.client_message_id.len() > 4096
    {
        return Err(BridgeError::InvalidRequest);
    }
    let content_key = Zeroizing::new(
        STANDARD
            .decode(&req.content_key)
            .map_err(|_| BridgeError::InvalidRequest)?,
    );
    if content_key.len() != 32 {
        return Err(BridgeError::InvalidRequest);
    }
    let mut output = Vec::with_capacity(req.recipients.len());
    for recipient in &req.recipients {
        if recipient.user_id == 0
            || recipient.user_id > 9_007_199_254_740_991
            || recipient.epoch == 0
            || recipient.epoch > 9_007_199_254_740_991
        {
            return Err(BridgeError::InvalidRequest);
        }
        let public: [u8; 32] = STANDARD
            .decode(&recipient.recovery_public_key)
            .map_err(|_| BridgeError::InvalidRequest)?
            .try_into()
            .map_err(|_| BridgeError::InvalidRequest)?;
        let aad = format!(
            "orizo-message-recovery-envelope-v1:{}:{}:{}:{}",
            req.conversation_id, req.client_message_id, recipient.user_id, recipient.epoch
        );
        let mut secret = Zeroizing::new([0u8; 32]);
        let mut nonce = [0u8; 24];
        getrandom::fill(&mut *secret).map_err(|_| BridgeError::InvalidRequest)?;
        getrandom::fill(&mut nonce).map_err(|_| BridgeError::InvalidRequest)?;
        let ciphertext = seal(&public, &secret, &nonce, aad.as_bytes(), &content_key)?;
        output.push(json!({"userId":recipient.user_id,"vaultEpoch":recipient.epoch,"scheme":SCHEME,
            "ephemeralPublicKey":STANDARD.encode(x25519_dalek::x25519(*secret,x25519_dalek::X25519_BASEPOINT_BYTES)),
            "nonce":STANDARD.encode(nonce),"ciphertext":STANDARD.encode(ciphertext)}));
    }
    Ok(json!({"envelopes":output}))
}
fn seal(
    public: &[u8; 32],
    secret: &[u8; 32],
    nonce: &[u8; 24],
    aad: &[u8],
    content_key: &[u8],
) -> Result<Vec<u8>, BridgeError> {
    let shared = Zeroizing::new(x25519_dalek::x25519(*secret, *public));
    if shared.iter().all(|b| *b == 0) {
        return Err(BridgeError::InvalidRequest);
    }
    let mut key = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(Some(aad), &*shared)
        .expand(SCHEME.as_bytes(), &mut *key)
        .map_err(|_| BridgeError::InvalidRequest)?;
    XChaCha20Poly1305::new_from_slice(&*key)
        .map_err(|_| BridgeError::InvalidRequest)?
        .encrypt(
            &XNonce::from(*nonce),
            Payload {
                msg: content_key,
                aad,
            },
        )
        .map_err(|_| BridgeError::MessageEncoding)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> Value {
        json!({"contentKey":STANDARD.encode([11u8;32]),"conversationId":"fixture-chat","clientMessageId":"fixture-client",
    "recipients":[{"userId":9,"epoch":4,"recoveryPublicKey":STANDARD.encode(x25519_dalek::x25519([7u8;32],x25519_dalek::X25519_BASEPOINT_BYTES))}]})
    }
    #[test]
    fn exact_legacy_recovery_wire_format() {
        let public = x25519_dalek::x25519([7u8; 32], x25519_dalek::X25519_BASEPOINT_BYTES);
        let aad = b"orizo-message-recovery-envelope-v1:fixture-chat:fixture-client:9:4";
        assert_eq!(
            STANDARD.encode(seal(&public, &[3u8; 32], &[5u8; 24], aad, &[11u8; 32]).unwrap()),
            "KVIxjbwYigqffdjh1JHcVZDVJt3hOaJ2NdszAVZPHwgbkChSLC6qhjkttS4Ic1yk"
        );
        let result = transform(&request().to_string()).unwrap();
        let row = &result["envelopes"][0];
        assert_eq!(row["userId"], 9);
        assert_eq!(row["vaultEpoch"], 4);
        assert_eq!(row["scheme"], SCHEME);
        let ephemeral: [u8; 32] = STANDARD
            .decode(row["ephemeralPublicKey"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let shared = x25519_dalek::x25519([7u8; 32], ephemeral);
        let mut key = [0u8; 32];
        Hkdf::<Sha256>::new(Some(aad), &shared)
            .expand(SCHEME.as_bytes(), &mut key)
            .unwrap();
        let nonce: [u8; 24] = STANDARD
            .decode(row["nonce"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let ciphertext = STANDARD
            .decode(row["ciphertext"].as_str().unwrap())
            .unwrap();
        let cipher = XChaCha20Poly1305::new_from_slice(&key).unwrap();
        assert_eq!(
            cipher
                .decrypt(
                    &XNonce::from(nonce),
                    Payload {
                        msg: &ciphertext,
                        aad
                    }
                )
                .unwrap(),
            vec![11u8; 32]
        );
        assert!(
            cipher
                .decrypt(
                    &XNonce::from(nonce),
                    Payload {
                        msg: &ciphertext,
                        aad: b"wrong"
                    }
                )
                .is_err()
        );
    }
    #[test]
    fn recovery_input_bounds_and_low_order_rejection() {
        for key in ["contentKey", "conversationId", "clientMessageId"] {
            let mut req = request();
            req[key] = json!("x".repeat(4097));
            assert!(transform(&req.to_string()).is_err());
        }
        let mut req = request();
        req["recipients"][0]["recoveryPublicKey"] = json!(STANDARD.encode([0u8; 32]));
        assert!(transform(&req.to_string()).is_err());
        for key in ["userId", "epoch"] {
            let mut req = request();
            req["recipients"][0][key] = json!(0);
            assert!(transform(&req.to_string()).is_err());
        }
        let mut req = request();
        let recipient = req["recipients"][0].clone();
        req["recipients"] = json!(vec![recipient; 33]);
        assert!(transform(&req.to_string()).is_err());
        req["recipients"] = json!([]);
        assert!(transform(&req.to_string()).is_err());
    }
}
