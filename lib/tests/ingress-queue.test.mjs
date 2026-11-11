import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BotIngressQueue} from '../src/ingress-queue.mjs';
function setup(t,opts={}){const dir=mkdtempSync(join(tmpdir(),'bots-queue-'));const q=new BotIngressQueue(dir,'fixture',opts);t.after(()=>q.close());return {q,dir};}
test('ciphertext admission survives reopening; completion dedupes replay',async t=>{
 const {q,dir}=setup(t), payload={version:1,rawEvent:'synthetic-ciphertext'};
 assert.equal((await q.enqueue('a',payload,{laneKey:'lane'})).duplicate,false);
 const second=new BotIngressQueue(dir,'fixture');t.after(()=>second.close());
 assert.deepEqual((await second.listPending())[0].payload,payload);
 assert.equal((await second.enqueue('a',payload)).duplicate,true);
 const claim=await second.claim('a',{ownerId:'worker'});
 assert.equal(await q.complete({...claim,claim:{token:'wrong'}}),false);
 assert.equal(await q.complete(claim),true);
 assert.equal((await q.enqueue('a',payload)).kind,'completed');
 assert.equal(await q.claim('a'),null);
});
test('competing consumers and expired leases cannot complete another claim',async t=>{
 let now=1000;const {q,dir}=setup(t,{now:()=>now});
 const other=new BotIngressQueue(dir,'fixture',{now:()=>now});t.after(()=>other.close());
 await q.enqueue('a',{}, {laneKey:'one'});await q.enqueue('b',{}, {laneKey:'two'});
 const first=await q.claimNext({ownerId:'first'});
 assert.equal((await other.claimNext({ownerId:'second',blockedLaneKeys:['two']})),null);
 now+=10000;
 assert.equal(await other.recoverStaleClaims({staleMs:1000,shouldRecover:async()=>false}),0);
 assert.equal(await other.recoverStaleClaims({staleMs:1000,shouldRecover:async()=>true}),1);
 const next=await other.claim(first.id,{ownerId:'second'});
 assert.equal(await q.complete(first),false);assert.equal(await other.complete(next),true);
});
test('backpressure fails before admission and prune never drops pending messages',async t=>{
 let now=1;const {q}=setup(t,{maxPending:1,now:()=>now});
 await q.enqueue('a',{});
 await assert.rejects(q.enqueue('b',{}),/capacity/);
 now=9999999999;assert.equal(await q.prune({pendingMaxEntries:0,pendingTtlMs:0}),0);
 const claim=await q.claim('a');await q.complete(claim);
 assert.equal((await q.enqueue('b',{})).kind,'accepted');
});
test('release accounts attempts; claim heartbeats prevent premature recovery',async t=>{
 let now=1;const {q}=setup(t,{now:()=>now});await q.enqueue('a',{});
 const claim=await q.claim('a');now=1000;await q.refreshClaim(claim);
 now=1500;assert.equal(await q.recoverStaleClaims({staleMs:1000}),0);
 await q.release(claim,{lastError:'secret must not be persisted'});
 const record=(await q.listPending())[0];assert.equal(record.attempts,1);assert.equal(record.lastError,'Bot delivery failed');
});
