//! Stateless legacy-compatible notification previews on the message worker.
use super::BridgeError;
use base64::{Engine, engine::general_purpose::STANDARD};
use chacha20poly1305::{
    ChaCha20Poly1305, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use hkdf::Hkdf;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Sha256;
use zeroize::{Zeroize, Zeroizing};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Recipient {
    device_id: String,
    notification_public_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    recipients: Vec<Recipient>,
    conversation_id: String,
    preview: String,
}
impl Drop for Request {
    fn drop(&mut self) {
        self.preview.zeroize();
    }
}
pub(super) fn transform(payload: &str) -> Result<Value, BridgeError> {
    if payload.len() > 256 * 1024 {
        return Err(BridgeError::InvalidRequest);
    }
    let req: Request = serde_json::from_str(payload).map_err(|_| BridgeError::InvalidRequest)?;
    if req.recipients.is_empty()
        || req.recipients.len() > 32
        || req.conversation_id.len() > 4096
        || req.preview.len() > 4096
    {
        return Err(BridgeError::InvalidRequest);
    }
    let mut output = Vec::with_capacity(req.recipients.len());
    for recipient in &req.recipients {
        if recipient.device_id.len() > 4096 {
            return Err(BridgeError::InvalidRequest);
        }
        let public: [u8; 32] = STANDARD
            .decode(&recipient.notification_public_key)
            .map_err(|_| BridgeError::InvalidRequest)?
            .try_into()
            .map_err(|_| BridgeError::InvalidRequest)?;
        let mut secret = Zeroizing::new([0u8; 32]);
        let mut nonce = [0u8; 12];
        getrandom::fill(&mut *secret).map_err(|_| BridgeError::InvalidRequest)?;
        getrandom::fill(&mut nonce).map_err(|_| BridgeError::InvalidRequest)?;
        let encrypted = seal(
            &public,
            &secret,
            &nonce,
            req.conversation_id.as_bytes(),
            req.preview.as_bytes(),
        )?;
        output.push(json!({"deviceId":recipient.device_id,"ephemeralPublicKey":STANDARD.encode(x25519_dalek::x25519(*secret,x25519_dalek::X25519_BASEPOINT_BYTES)),"nonce":STANDARD.encode(nonce),"ciphertext":STANDARD.encode(encrypted)}));
    }
    Ok(json!({"envelopes":output}))
}
fn seal(
    public: &[u8; 32],
    secret: &[u8; 32],
    nonce: &[u8; 12],
    aad: &[u8],
    text: &[u8],
) -> Result<Vec<u8>, BridgeError> {
    let shared = Zeroizing::new(x25519_dalek::x25519(*secret, *public));
    if shared.iter().all(|b| *b == 0) {
        return Err(BridgeError::InvalidRequest);
    }
    let mut key = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(Some(aad), &*shared)
        .expand(b"orizo-message-notification-v1", &mut *key)
        .map_err(|_| BridgeError::InvalidRequest)?;
    ChaCha20Poly1305::new_from_slice(&*key)
        .map_err(|_| BridgeError::InvalidRequest)?
        .encrypt(&Nonce::from(*nonce), Payload { msg: text, aad })
        .map_err(|_| BridgeError::MessageEncoding)
}
#[cfg(test)]
mod tests {
    use super::*;
    const PUBLIC: &str = "E75P6uryBMf9M1j8nAByGIHRdCeBKCJ+xnTzf3/pe20=";
    #[test]
    fn exact_noble_preview_wire_format() {
        let public = STANDARD.decode(PUBLIC).unwrap().try_into().unwrap();
        assert_eq!(
            STANDARD.encode(
                seal(
                    &public,
                    &[3u8; 32],
                    &[5u8; 12],
                    b"fixture-chat",
                    "Preview Ελληνικά 💪".as_bytes()
                )
                .unwrap()
            ),
            "gBqDPXz0bmhQm6evL8OZJ9xkjQxmzs7L6zcoZMpRSbDJryaiDmdeU621s+an"
        );
    }
    #[test]
    fn bounds_low_order_keys_and_batch_order() {
        assert!(seal(&[0; 32], &[3; 32], &[5; 12], b"c", b"p").is_err());
        let mut req = json!({"conversationId":"fixture-chat","preview":"Preview Ελληνικά 💪","recipients":[{"deviceId":"a","notificationPublicKey":PUBLIC},{"deviceId":"b","notificationPublicKey":PUBLIC}]});
        let result = transform(&req.to_string()).unwrap();
        let rows = result["envelopes"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["deviceId"], "a");
        assert_eq!(rows[1]["deviceId"], "b");
        assert_ne!(rows[0]["ephemeralPublicKey"], rows[1]["ephemeralPublicKey"]);
        for row in rows {
            let public: [u8; 32] = STANDARD
                .decode(row["ephemeralPublicKey"].as_str().unwrap())
                .unwrap()
                .try_into()
                .unwrap();
            let shared = x25519_dalek::x25519([7u8; 32], public);
            let mut key = [0u8; 32];
            Hkdf::<Sha256>::new(Some(b"fixture-chat"), &shared)
                .expand(b"orizo-message-notification-v1", &mut key)
                .unwrap();
            let nonce: [u8; 12] = STANDARD
                .decode(row["nonce"].as_str().unwrap())
                .unwrap()
                .try_into()
                .unwrap();
            let cipher = STANDARD
                .decode(row["ciphertext"].as_str().unwrap())
                .unwrap();
            assert_eq!(
                ChaCha20Poly1305::new_from_slice(&key)
                    .unwrap()
                    .decrypt(
                        &Nonce::from(nonce),
                        Payload {
                            msg: &cipher,
                            aad: b"fixture-chat"
                        }
                    )
                    .unwrap(),
                "Preview Ελληνικά 💪".as_bytes()
            );
        }
        req["recipients"] = json!(Vec::<Value>::new());
        assert!(transform(&req.to_string()).is_err());
        req["recipients"] = json!(vec![
            json!({"deviceId":"a","notificationPublicKey":PUBLIC});
            33
        ]);
        assert!(transform(&req.to_string()).is_err());
        req["recipients"] = json!([{"deviceId":"a","notificationPublicKey":"bad"}]);
        assert!(transform(&req.to_string()).is_err());
        req["preview"] = json!("x".repeat(4097));
        assert!(transform(&req.to_string()).is_err());
    }
}
