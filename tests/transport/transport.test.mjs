import test from "node:test";
import assert from "node:assert/strict";
import { Transport } from "../../lib/src/transport.mjs";
const id = "11111111-1111-4111-8111-111111111111";
class Store {
  data = new Map();
  async get(k) {
    return this.data.get(k);
  }
  async set(k, v) {
    this.data.set(k, structuredClone(v));
  }
}
test("ambiguous server acknowledgement retries exact ciphertext/id and persisted receipt prevents another send", async () => {
  const requests = [],
    store = new Store();
  const api = {
    async request(path, o) {
      requests.push(o.body);
      if (requests.length === 1) throw new Error("lost response");
      return { id: "accepted" };
    },
  };
  let encryptions = 0;
  const transport = new Transport(
    api,
    {
      async encrypt() {
        encryptions++;
        return { ciphertext: "opaque" };
      },
    },
    store,
  );
  assert.equal(
    await transport.send(id, "private body", { operationId: "stable" }),
    "accepted",
  );
  assert.equal(
    await transport.send(id, "private body", { operationId: "stable" }),
    "accepted",
  );
  assert.equal(encryptions, 1);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(JSON.stringify([...store.data]).includes("private body"), false);
});
test("edits and deletions are encrypted events aimed at original message", async () => {
  const events = [];
  const t = new Transport(
    {
      async request() {
        return { id: "ok" };
      },
    },
    {
      async encrypt(c, i, p) {
        events.push(p);
        return { ciphertext: "opaque" };
      },
    },
    new Store(),
  );
  await t.edit(id, "target", "updated");
  await t.remove(id, "target");
  assert.deepEqual(
    events.map((p) => [p.eventType, p.targetMessageId]),
    [
      ["edit", "target"],
      ["delete", "target"],
    ],
  );
});
test("API failure cannot produce a false sent receipt", async () => {
  const error = new Error("denied");
  error.status = 403;
  const t = new Transport(
    {
      async request() {
        throw error;
      },
    },
    {
      async encrypt() {
        return { ciphertext: "opaque" };
      },
    },
    new Store(),
  );
  await assert.rejects(() => t.send(id, "nope"));
});

test("eyes is an encrypted idempotent set reaction, never a toggle", async () => {
 const events=[],requests=[];const store=new Store();
 const t=new Transport({async request(p,o){requests.push(o.body);return {id:"reaction"};}},
  {async encrypt(c,id,p){events.push(p);return {ciphertext:"opaque"};}},store);
 await Promise.all([t.react(id,"incoming","👀",{operationId:"ack-incoming"}),t.react(id,"incoming","👀",{operationId:"ack-incoming"})]);
 await t.react(id,"incoming","👀",{operationId:"ack-incoming"});
 assert.equal(requests.length,1);assert.equal(events.length,1);
 assert.equal(events[0].eventType,"reaction");assert.equal(events[0].reactionEmoji,"👀");
 assert.equal(events[0].targetMessageId,"incoming");assert.equal(events[0].body,"");
 assert.doesNotMatch(JSON.stringify([...store.data]),/👀/u);
});
test("a blocked progress POST does not hold inbound crypto or independent command replies", async () => {
 let release,started;const waiting=new Promise(r=>started=r),hold=new Promise(r=>release=r);
 let encrypting=0;const seen=[];
 const t=new Transport({async request(p,o){if(o.body.ciphertext==='progress'){started();await hold;}return {id:o.body.ciphertext};}},
  {async encrypt(c,id,p){assert.equal(encrypting++,0);await new Promise(r=>setTimeout(r,5));encrypting--;return {ciphertext:p.body};}},new Store());
 const progress=t.send(id,'progress',{operationId:'preview'});await waiting;
 await t.serialize(async()=>{seen.push('decrypted');});
 assert.equal(await t.send(id,'command reply',{operationId:'command'}),'command reply');
 assert.deepEqual(seen,['decrypted']);release();assert.equal(await progress,'progress');await t.waitForIdle();
});
test("directory refresh re-encrypts under the crypto lock without losing operation identity",async()=>{
 let calls=0;const payloads=[],requests=[];
 const t=new Transport({async request(p,o){requests.push(o.body);if(calls++===0){throw Object.assign(new Error('changed'),{status:409,code:'message_delivery_directory_changed'});}return {id:'ok'};}},
  {async encrypt(c,id,p){payloads.push(p);return {ciphertext:'opaque-'+payloads.length};},async decrypt(){return {body:'original'};}},new Store());
 assert.equal(await t.send(id,'original',{operationId:'refresh'}),'ok');
 assert.equal(payloads.length,2);assert.equal(requests[0].clientMessageId,requests[1].clientMessageId);
 assert.notEqual(requests[0].ciphertext,requests[1].ciphertext);
});
