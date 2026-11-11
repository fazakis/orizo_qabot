import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrizoCrypto } from "../src/crypto.mjs";
import {signDirectoryDevice,canonicalDirectorySigningKey} from "../vendor/directory.mjs";
import {x25519} from "../vendor/crypto.mjs";
import {resolveFallbackPrekeys} from '../src/fallback-prekeys.mjs';
async function approve(c) {
 const accountSigningKey=canonicalDirectorySigningKey(c.engine.signingKey);
 const certificate=await signDirectoryDevice({state:{userId:c.userId,deviceId:c.state.deviceId,
   identityKey:c.engine.identityKey,signingKey:c.engine.signingKey,
   notificationPublicKey:Buffer.from(x25519.getPublicKey(Buffer.from(c.state.notificationKey,'base64'))).toString('base64')},
   accountSigningKey,issuerCertificateId:null,sign:text=>c.engine.sign(text)});
 c.directoryIdentity={accountSigningKey,certificate,certificates:{[certificate.id]:certificate}};
}
class Vault {
  constructor(id) {
    this.data = { "account": { userId: id } };
  }
  async get(k) {
    return structuredClone(this.data[k] || null);
  }
  async put(k, v) {
    this.data[k] = structuredClone(v);
  }
}
test("real Olm: two devices exchange authenticated messages and survive a restart", async () => {
  const directory = new Map();
  function apiFor(userId) {
    return {
      async request(path, { body } = {}) {
        if (path === "/api/messages/e2ee/devices/") {
          directory.set(body.deviceId, {
            ...body,
            userId,
            sessionGeneration: 1,
          });
          return {};
        }
        if (path.endsWith("/recipients/"))
          return {
            ready:true,
            devices: [...directory.values()].map((d) => ({
              deviceId: d.deviceId,
              identityKey: d.identityKey,
              userId: d.userId,
              isCurrentDevice: d.deviceId === body.currentDeviceId,
              sessionGeneration: 1,
              ...(body.missingDeviceIds.includes(d.deviceId)
                ? { oneTimeKey: { publicKey: Object.values(d.oneTimeKeys)[0] } }
                : {}),
            })),
            recoveryVaults: [],
            membershipVersion: 1,
          };
        throw new Error("Unexpected API path");
      },
    };
  }
  const av = new Vault(71),
    bv = new Vault(72);
  const a = new OrizoCrypto(av, apiFor(71));
  let b = new OrizoCrypto(bv, apiFor(72));
  await a.initialize();
  await b.initialize();
  await a.register();
  await b.register();
  await approve(a);await approve(b);
  const conversation = randomUUID();
  async function transfer(from, to, body) {
    const id = randomUUID(),
      payload = { version: 1, eventType: "message", body };
    const encrypted = await from.encrypt(conversation, id, payload);
    const row = {
      id: randomUUID(),
      conversation,
      clientMessageId: id,
      ...encrypted,
      sender:{id:from.userId},
      senderIdentityKey: from.engine.identityKey,
      senderSessionGeneration: 1,
    };
    assert.equal(JSON.stringify(encrypted).includes(body), false);
    assert.deepEqual(await to.decrypt(row), payload);
    return row;
  }
  const first = await transfer(a, b, "secret-one");
  await transfer(b, a, "secret-two");
  await b.close();
  b = new OrizoCrypto(bv, apiFor(72));
  await b.initialize();
  await transfer(a, b, "after-restart");
  first.ciphertext = Buffer.from("tampered").toString("base64");
  await assert.rejects(() => b.decrypt(first));
  await a.close();
  await b.close();
});

test('real Olm: multiple bots deliver to a device with exhausted one-time keys', async () => {
  const directory = new Map();
  const targetId = 104;
  let fallbackClaims = 0;
  function apiFor(userId) {
    return { async request(path, {body} = {}) {
      if (path === '/api/messages/e2ee/devices/') {
        directory.set(body.deviceId, {...body, userId});
        return {oneTimeKeyCount: 50, fallbackKeyState: body.fallbackKey ? 'available' : 'missing'};
      }
      if (path.endsWith('/recipients/')) return {
        ready: true, membershipVersion: 1, directoryRevision: 'fixture-directory', recoveryVaults: [],
        devices: [...directory.values()]
          .filter(d => d.deviceId === body.currentDeviceId || d.userId === targetId)
          .map(d => {
            const missing = body.missingDeviceIds.includes(d.deviceId);
            if (missing) fallbackClaims++;
            return {deviceId:d.deviceId, userId:d.userId, identityKey:d.identityKey,
              signingKey:d.signingKey, sessionGeneration:0,
              isCurrentDevice:d.deviceId===body.currentDeviceId, oneTimeKey:null,
              fallbackKey:missing ? d.fallbackKey : null};
          }),
      };
      throw new Error('Unexpected API path');
    }};
  }
  const all=[];
  try {
    const receiver = new OrizoCrypto(new Vault(targetId), apiFor(targetId)); all.push(receiver);
    await receiver.initialize(); await receiver.register(); await approve(receiver);
    const cid=randomUUID();
    for (const uid of [101,102,103]) {
      const vault=new Vault(uid);
      let sender=new OrizoCrypto(vault,apiFor(uid)); all.push(sender);
      await sender.initialize();await sender.register();await approve(sender);
      for (let round=0;round<2;round++) {
        if(round) {
          await sender.close();all.splice(all.indexOf(sender),1);
          sender=new OrizoCrypto(vault,apiFor(uid));all.push(sender);
          await sender.initialize();await approve(sender);
        }
        const clientMessageId=randomUUID();
        const payload={version:1,eventType:'message',body:`fixture-bot-${uid}-round-${round}`};
        const encrypted=await sender.encrypt(cid,clientMessageId,payload);
        assert.deepEqual(encrypted.skippedDeviceIds,[]);
        assert.equal(encrypted.deviceEnvelopes.length,2);
        assert.equal(JSON.stringify(encrypted).includes(payload.body),false);
        assert.deepEqual(await receiver.decrypt({id:randomUUID(),conversation:cid,clientMessageId,
          ...encrypted,sender:{id:uid},senderIdentityKey:sender.engine.identityKey,
          senderSessionGeneration:0}),payload);
      }
    }
    assert.ok(fallbackClaims>=3);
  } finally {for(const c of all) await c.close();}
});

test('fallback prekeys reject tampering and wrong-device signatures; normal prekeys take priority', async () => {
  const c=new OrizoCrypto(new Vault(201),{});
  await c.initialize();
  try {
    const [fallback]=await c.engine.fallbackKeys(c.state.deviceId,true);
    const device={deviceId:c.state.deviceId,signingKey:c.engine.signingKey,oneTimeKey:null,fallbackKey:fallback};
    const verify=(...args)=>c.engine.verify(...args);
    const [good,bad,wrong,ordinary,missing]=await resolveFallbackPrekeys([
      device,
      {...device,fallbackKey:{...fallback,signature:'A'.repeat(86)}},
      {...device,deviceId:randomUUID()},
      {...device,oneTimeKey:{keyId:'normal',publicKey:'normal-key'}},
      {...device,signingKey:undefined},
    ],verify);
    assert.equal(good.oneTimeKey.publicKey,fallback.publicKey);
    assert.equal(bad.oneTimeKey,null);assert.equal(wrong.oneTimeKey,null);
    assert.equal(missing.oneTimeKey,null);
    assert.equal(ordinary.oneTimeKey.publicKey,'normal-key');
    assert.ok([good,bad,wrong,ordinary,missing].every(d=>d.fallbackKey===null));
  }finally{await c.close();}
});
