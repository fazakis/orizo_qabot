//! Stateless projection of already-authenticated local controls on a bounded page.
//! No transport, identity creation, ratchet writes or database ownership here.
use super::BridgeError;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    version: u8,
    viewer_id: String,
    now: String,
    rows: Vec<Value>,
    comparisons: Vec<Value>,
    controls: Vec<PreparedControl>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreparedControl {
    control: Value,
    revision: Value,
    server_created_at_ms: Option<i64>,
    target_created_at_ms: Option<i64>,
}
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(v) => *v,
        Value::String(v) => !v.is_empty(),
        Value::Number(v) => v.as_f64() != Some(0.0),
        _ => true,
    }
}
fn first(values: &[&Value]) -> Value {
    values
        .iter()
        .find(|v| truthy(v))
        .map(|v| (*v).clone())
        .unwrap_or(Value::Null)
}
fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}
fn newer(next: &Value, previous_raw: &Value, previous_comparison: &Value) -> bool {
    if !truthy(previous_raw) {
        return true;
    }
    if next.is_null() {
        return false;
    }
    if previous_comparison.is_null() {
        return true;
    }
    let next_time = text(&next["createdAt"]);
    let old_time = text(&previous_comparison["createdAt"]);
    next_time > old_time
        || (next_time == old_time
            && text(&next["eventId"])
                .encode_utf16()
                .cmp(text(&previous_comparison["eventId"]).encode_utf16())
                .is_gt())
}
fn tombstone(row: &mut Value, at: Value) {
    for (key, value) in
        json!({"kind":"text","body":"","sharedType":"","sharedId":"","sharedExercise":null,
        "sharedPost":null,"attachments":[],"reactions":[],"myReaction":null,"replyTo":null})
        .as_object()
        .unwrap()
    {
        row[key] = value.clone();
    }
    row["deletedAt"] = at;
}
fn js_keys(map: &Map<String, Value>) -> Vec<String> {
    // ECMAScript enumerates array-index keys first, then insertion-order keys.
    let mut numeric = Vec::new();
    let mut others = Vec::new();
    for key in map.keys() {
        match key.parse::<u32>() {
            Ok(n) if n < u32::MAX && n.to_string() == *key => numeric.push((n, key.clone())),
            _ => others.push(key.clone()),
        }
    }
    numeric.sort_unstable_by_key(|(n, _)| *n);
    numeric.into_iter().map(|(_, k)| k).chain(others).collect()
}
fn summary(actors: &Map<String, Value>) -> Value {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for key in js_keys(actors) {
        let emoji = text(&actors[&key]);
        if emoji.is_empty() {
            continue;
        }
        if let Some((_, count)) = counts.iter_mut().find(|(value, _)| value == emoji) {
            *count += 1;
        } else {
            counts.push((emoji.to_owned(), 1));
        }
    }
    Value::Array(
        counts
            .into_iter()
            .map(|(emoji, count)| json!({"emoji":emoji,"count":count}))
            .collect(),
    )
}

fn reply_source(row: &Value) -> Value {
    let preview = if truthy(&row["disappearingExpired"]) {
        "Message disappeared"
    } else if truthy(&row["deletedAt"]) {
        "Deleted message"
    } else if truthy(&row["viewOnce"]) {
        "View-once message"
    } else if !text(&row["body"]).is_empty() {
        text(&row["body"])
    } else if row["attachments"]
        .as_array()
        .is_some_and(|items| items.iter().any(|item| truthy(&item["gifPlayback"])))
    {
        "GIF"
    } else {
        match text(&row["kind"]) {
            "image" => "📷 Photo",
            "video" => "Video",
            "pdf" => "📄 File",
            "voice" => "🎤 Voice message",
            "shared_exercise" => "💪 Exercise",
            "shared_post" => "Shared post",
            "shared_workout" => "Shared a workout",
            _ => "Message",
        }
    };
    json!({"id":row["id"],"conversationId":row["conversationId"],
        "senderUsername":if truthy(&row["sender"]["username"]) {row["sender"]["username"].clone()} else {Value::Null},
        "preview":preview.chars().take(500).collect::<String>()})
}

pub(super) fn transform(payload: &str) -> Result<Value, BridgeError> {
    if payload.len() > 8 * 1024 * 1024 {
        return Err(BridgeError::InvalidRequest);
    }
    let mut request: Request =
        serde_json::from_str(payload).map_err(|_| BridgeError::InvalidRequest)?;
    if request.version != 1
        || request.rows.len() > 1000
        || request.controls.len() > 10000
        || request.comparisons.len() != request.rows.len()
        || request.now.is_empty()
    {
        return Err(BridgeError::InvalidRequest);
    }
    let mut index = HashMap::new();
    let mut deleted = HashSet::new();
    for (position, row) in request.rows.iter().enumerate() {
        let id = row["id"]
            .as_str()
            .filter(|v| !v.is_empty())
            .ok_or(BridgeError::InvalidRequest)?;
        if index.insert(id.to_owned(), position).is_some() {
            return Err(BridgeError::InvalidRequest);
        }
        if truthy(&row["deletedAt"]) {
            deleted.insert(id.to_owned());
        }
    }
    for prepared in &request.controls {
        let control = &prepared.control;
        let revision = &prepared.revision;
        if truthy(&control["rejected"]) {
            continue;
        }
        let kind = text(&control["eventType"]);
        let target = text(&control["targetMessageId"]);
        if !["edit", "reaction", "delete"].contains(&kind) || target.is_empty() {
            return Err(BridgeError::InvalidRequest);
        }
        let actor = control["actorUserId"]
            .as_i64()
            .filter(|id| *id > 0 && *id <= 9_007_199_254_740_991);
        if actor.is_none() {
            continue;
        }
        if kind != "reaction" {
            let (message, created) = if let Some(&position) = index.get(target) {
                (
                    &request.rows[position],
                    request.comparisons[position]["createdAtMs"].as_i64(),
                )
            } else {
                (&control["verifiedTarget"], prepared.target_created_at_ms)
            };
            if text(&message["id"]) != target || actor != message["sender"]["id"].as_i64() {
                continue;
            }
            let age = prepared
                .server_created_at_ms
                .zip(created)
                .and_then(|(received, created)| received.checked_sub(created));
            let limit = if kind == "edit" {
                15 * 60 * 1000
            } else {
                2 * 24 * 60 * 60 * 1000
            };
            if !age.is_some_and(|age| age >= 0 && age <= limit) {
                continue;
            }
        }
        if let Some(&position) = index.get(target) {
            let row = &mut request.rows[position];
            let comparisons = &mut request.comparisons[position];
            if truthy(&row["deletedAt"]) && kind != "delete" {
                tombstone(row, row["deletedAt"].clone());
                continue;
            }
            if kind == "reaction" {
                let actor = control["actorUserId"]
                    .as_i64()
                    .ok_or(BridgeError::InvalidRequest)?
                    .to_string();
                if !newer(
                    revision,
                    &row["encryptedReactionRevisions"][&actor],
                    &comparisons["reactions"][&actor],
                ) {
                    continue;
                }
                let mut actors = row["encryptedReactionActors"]
                    .as_object()
                    .cloned()
                    .unwrap_or_default();
                let emoji = &control["reactionEmoji"];
                if truthy(emoji) {
                    actors.insert(actor.clone(), emoji.clone());
                } else {
                    actors.shift_remove(&actor);
                }
                row["reactions"] = summary(&actors);
                row["myReaction"] = actors
                    .get(&request.viewer_id)
                    .filter(|v| truthy(v))
                    .cloned()
                    .unwrap_or(Value::Null);
                row["encryptedReactionActors"] = Value::Object(actors);
                if !revision.is_null() {
                    if !row["encryptedReactionRevisions"].is_object() {
                        row["encryptedReactionRevisions"] = json!({});
                    }
                    row["encryptedReactionRevisions"][&actor] = revision.clone();
                    if !comparisons["reactions"].is_object() {
                        comparisons["reactions"] = json!({});
                    }
                    comparisons["reactions"][&actor] = revision.clone();
                }
            } else if kind == "delete" {
                let at = first(&[
                    &control["serverCreatedAt"],
                    &control["payload"]["createdAt"],
                    &row["deletedAt"],
                    &Value::String(request.now.clone()),
                ]);
                tombstone(row, at);
            } else if newer(
                revision,
                &row["encryptedEditRevision"],
                &comparisons["edit"],
            ) {
                if !revision.is_null() {
                    row["encryptedEditRevision"] = revision.clone();
                    comparisons["edit"] = revision.clone();
                }
                row["editedAt"] = first(&[
                    &control["payload"]["createdAt"],
                    &control["serverCreatedAt"],
                    &row["editedAt"],
                    &row["createdAt"],
                ]);
                row["updatedAt"] = first(&[
                    &control["serverCreatedAt"],
                    &control["payload"]["createdAt"],
                    &row["updatedAt"],
                    &row["createdAt"],
                ]);
                row["body"] = control["payload"]["body"].clone();
                row["kind"] = control["payload"]["kind"].clone();
            }
        }
        if kind == "delete" {
            deleted.insert(target.to_owned());
        }
    }
    let sources: HashMap<String, Value> = request
        .rows
        .iter()
        .map(|row| (text(&row["id"]).to_owned(), reply_source(row)))
        .collect();
    for row in &mut request.rows {
        if row["replyTo"].is_object() && text(&row["encryptionVersion"]) != "legacy_v1" {
            let id = text(&row["replyTo"]["id"]).to_owned();
            let target = sources.get(&id).filter(|source| {
                id != text(&row["id"]) && source["conversationId"] == row["conversationId"]
            });
            let proof = target.unwrap_or(&row["replyTo"]);
            let valid =
                target.is_some() || (text(&row["verifiedReplyTargetId"]) == id && !id.is_empty());
            let previous = text(&row["replyTo"]["preview"]);
            let redacted = if [
                "Deleted message",
                "Message disappeared",
                "View-once message",
            ]
            .contains(&previous)
            {
                previous
            } else {
                "Quoted message"
            };
            row["replyTo"] = json!({"id":id,
                "senderUsername":if valid && truthy(&proof["senderUsername"]) {proof["senderUsername"].clone()} else {Value::Null},
                "preview":if valid && truthy(&proof["preview"]) {proof["preview"].clone()} else {json!(redacted)}});
        }
        if deleted.contains(text(&row["replyTo"]["id"])) && row["replyTo"].is_object() {
            row["replyTo"]["preview"] = json!("Deleted message");
        }
    }
    Ok(Value::Array(request.rows))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn enforces_sender_and_time_before_edits_deletes_and_reply_redaction() {
        for kind in ["edit", "delete"] {
            for (actor, at, allowed) in [
                (9, 1000, true),
                (12, 1000, false),
                (9, -1, false),
                (9, 172_800_001, false),
            ] {
                let input = json!({"version":1,"viewerId":"9","now":"1970-01-01T00:00:01Z",
                "rows":[{"id":"target","sender":{"id":9},"body":"original","createdAt":"1970-01-01T00:00:00Z"},
                        {"id":"reply","replyTo":{"id":"target","preview":"original"}}],
                "comparisons":[{"createdAtMs":0},{}],"controls":[{
                  "serverCreatedAtMs":at,"revision":null,"control":{"eventType":kind,"targetMessageId":"target",
                    "actorUserId":actor,"serverCreatedAt":"1970-01-01T00:00:01Z","payload":{"kind":"text","body":"replacement"}}
                }]});
                let result = transform(&input.to_string()).unwrap();
                if !allowed {
                    assert_eq!(result[0]["body"], "original");
                    assert_eq!(result[1]["replyTo"]["preview"], "original");
                    assert!(result[0]["deletedAt"].is_null());
                } else if kind == "edit" {
                    assert_eq!(result[0]["body"], "replacement");
                } else {
                    assert_eq!(result[0]["body"], "");
                    assert_eq!(result[1]["replyTo"]["preview"], "Deleted message");
                }
            }
        }
    }
    #[test]
    fn quotes_use_local_sources_and_never_sender_claims_or_view_once_bodies() {
        for (present, view_once, expected) in [
            (true, false, "actual body"),
            (true, true, "View-once message"),
            (false, false, "Quoted message"),
        ] {
            let source = json!({"id":"original","conversationId":"chat","body":"actual body","viewOnce":view_once,"sender":{"username":"actual"}});
            let reply = json!({"id":"reply","conversationId":"chat","replyTo":{"id":"original","senderUsername":"forged","preview":"forged body"},
                "verifiedReplySource":{"id":"original","conversationId":"chat","senderUsername":"forged","preview":"forged proof"}});
            let rows = if present {
                vec![source, reply]
            } else {
                vec![reply]
            };
            let input = json!({"version":1,"viewerId":"1","now":"2026-10-17T00:00:00Z",
                "comparisons":vec![json!({});rows.len()],"rows":rows,"controls":[]});
            let output = transform(&input.to_string()).unwrap();
            let result = output.as_array().unwrap().last().unwrap();
            assert_eq!(result["replyTo"]["preview"], expected);
            assert_eq!(
                result["replyTo"]["senderUsername"],
                if present {
                    json!("actual")
                } else {
                    Value::Null
                }
            );
        }
    }
    #[test]
    fn matches_javascript_projection_oracle() {
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("../tests/message_projection_oracle.json")).unwrap();
        assert!(cases.len() >= 500);
        for (index, case) in cases.iter().enumerate() {
            assert_eq!(
                transform(&case["request"].to_string()).unwrap(),
                case["expected"],
                "oracle case {index}"
            );
        }
    }
    #[test]
    fn rejects_malformed_oversized_and_duplicate_identity_pages() {
        assert!(transform("{}").is_err());
        let mut input = json!({"version":1,"viewerId":"1","now":"2026-10-17T00:00:00.000Z","rows":[],"comparisons":[],"controls":[]});
        input["rows"] = json!([{"id":"a"},{"id":"a"}]);
        input["comparisons"] = json!([{}, {}]);
        assert!(transform(&input.to_string()).is_err());
        input["rows"] = json!([]);
        input["comparisons"] = json!([]);
        input["controls"] = Value::Array(vec![json!({"control":{},"revision":null}); 10001]);
        assert!(transform(&input.to_string()).is_err());
    }
}
