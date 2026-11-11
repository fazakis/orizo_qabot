// Plugin-owned durable ciphertext queue implementing the exported OpenClaw
// ChannelIngressQueue interface. It NEVER opens an OpenClaw host database.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export class BotIngressQueue {
  constructor(dir, accountId, {now = Date.now, maxPending = 10000} = {}) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(accountId)) throw new Error('Invalid bot account');
    this.accountId=accountId; this.now=now; this.maxPending=maxPending;
    mkdirSync(dir,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(join(dir,'bot-ingress.sqlite'));
    chmodSync(join(dir,'bot-ingress.sqlite'),0o600);
    const version=this.db.prepare('select sqlite_version() v').get().v.split('.').map(Number);
    if (!(version[0]>3 || version[0]===3 && (version[1]>51 || version[1]===51&&version[2]>=3 || version[1]===50&&version[2]>=7 || version[1]===44&&version[2]>=6))) {
      this.db.close(); throw new Error('Upgrade Node to a runtime with WAL-safe SQLite');
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY,status TEXT NOT NULL,record TEXT NOT NULL,stamp INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS queue_status ON queue(status,stamp,id);`);
  }
  transaction(fn) {this.db.exec('BEGIN IMMEDIATE');try {const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  read(id) {const row=this.db.prepare('SELECT status,record FROM queue WHERE id=?').get(id);return row?{status:row.status,record:JSON.parse(row.record)}:null;}
  save(status,record) {this.db.prepare('INSERT INTO queue VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,record=excluded.record,stamp=excluded.stamp').run(record.id,status,JSON.stringify(record),record.updatedAt??this.now());}
  async enqueue(id,payload,{metadata,receivedAt=this.now(),laneKey}={}) {
    if(typeof id!=='string'||!id||id.length>256||JSON.stringify(payload).length>1024*1024)throw new Error('Invalid or oversized ingress event');
    return this.transaction(()=>{
      const old=this.read(id);if(old)return {kind:old.status,duplicate:true,record:old.record};
      if(this.db.prepare("SELECT count(*) n FROM queue WHERE status IN ('pending','claimed')").get().n>=this.maxPending)throw new Error('Bot ingress capacity reached; cursor must not advance');
      const record={id,channelId:'orizo-bot',accountId:this.accountId,queueName:'messages',payload,metadata,receivedAt,updatedAt:this.now(),laneKey,attempts:0};
      this.save('pending',record);return {kind:'accepted',duplicate:false,record};
    });
  }
  async listPending({limit=100,orderBy='received'}={}) {
    const rows=this.db.prepare("SELECT record FROM queue WHERE status='pending' ORDER BY "+(orderBy==='id'?'id':'stamp,id')+' LIMIT ?').all(limit==='all'?this.maxPending:Math.min(limit,this.maxPending));
    return rows.map(r=>JSON.parse(r.record));
  }
  async listClaims() {return this.db.prepare("SELECT record FROM queue WHERE status='claimed'").all().map(r=>JSON.parse(r.record));}
  claimNow(id,ownerId) {
    const row=this.read(id);if(!row||row.status!=='pending')return null;
    const now=this.now(),record={...row.record,updatedAt:now,claim:{token:randomUUID(),ownerId:ownerId||`bot:${process.pid}`,claimedAt:now}};
    this.save('claimed',record);return record;
  }
  async claim(id,{ownerId}={}) {return this.transaction(()=>this.claimNow(id,ownerId));}
  async claimNext({ownerId,blockedLaneKeys=[],candidateIds,scanLimit=1000,orderBy='received',deriveLaneKey,reconcileStoredLaneKey}={}) {
    return this.transaction(()=>{
      const blocked=new Set(blockedLaneKeys), candidates=candidateIds?new Set(candidateIds):null;
      const rows=this.db.prepare("SELECT record FROM queue WHERE status='pending' ORDER BY "+(orderBy==='id'?'id':'stamp,id')+' LIMIT ?').all(Math.min(scanLimit,this.maxPending));
      for(const row of rows){
        const record=JSON.parse(row.record);if(candidates&&!candidates.has(record.id))continue;
        const derived=deriveLaneKey?.(record),lane=record.laneKey??derived;
        if(record.laneKey&&derived&&record.laneKey!==derived){
          if(!reconcileStoredLaneKey?.(record,record.laneKey,derived))continue;
          record.laneKey=derived;this.save('pending',record);
        }
        if(blocked.has(record.laneKey??lane))continue;
        return this.claimNow(record.id,ownerId);
      }
      return null;
    });
  }
  guarded(ref,fn) {
    const id=typeof ref==='string'?ref:ref.id,row=this.read(id);if(!row)return false;
    if(typeof ref==='string' ? row.status==='claimed' : row.status!=='claimed'||row.record.claim.token!==ref.claim?.token)return false;
    return fn(row.record,row.status);
  }
  async refreshClaim(ref,{refreshedAt=this.now()}={}) {return this.transaction(()=>this.guarded(ref,r=>{r.updatedAt=refreshedAt;this.save('claimed',r);return true;}));}
  async complete(ref,{metadata,completedAt=this.now()}={}) {return this.transaction(()=>this.guarded(ref,r=>{this.save('completed',{id:r.id,channelId:r.channelId,accountId:r.accountId,queueName:r.queueName,completedAt,updatedAt:completedAt,metadata});return true;}));}
  async release(ref,{lastError,releasedAt=this.now(),recordAttempt=true}={}) {return this.transaction(()=>this.guarded(ref,r=>{delete r.claim;r.updatedAt=releasedAt;if(recordAttempt){r.attempts++;r.lastAttemptAt=releasedAt;}if(lastError)r.lastError='Bot delivery failed';this.save('pending',r);return true;}));}
  async fail(ref,{reason,failedAt=this.now()}={}) {return this.transaction(()=>this.guarded(ref,r=>{delete r.claim;this.save('failed',{...r,failedAt,updatedAt:failedAt,reason});return true;}));}
  async delete(ref) {return this.transaction(()=>this.guarded(ref,r=>{this.db.prepare('DELETE FROM queue WHERE id=?').run(r.id);return true;}));}
  async recoverStaleClaims({staleMs=120000,now=this.now(),shouldRecover}={}) {
    let count=0;
    for(const claim of await this.listClaims()){
      if(now-claim.updatedAt<staleMs||shouldRecover&&!await shouldRecover(claim))continue;
      count+=this.transaction(()=>this.guarded(claim,r=>{
        if(now-r.updatedAt<staleMs)return false;
        delete r.claim;r.updatedAt=now;this.save('pending',r);return true;
      }))?1:0;
    }
    return count;
  }
  async prune({completedTtlMs=30*86400000,failedTtlMs=30*86400000,protectIds=[],now=this.now()}={}) {
    const protect=new Set(protectIds);let count=0;
    return this.transaction(()=>{
      for(const row of this.db.prepare("SELECT id,status,stamp FROM queue WHERE status IN ('completed','failed')").all()){
        if(!protect.has(row.id)&&now-row.stamp>(row.status==='completed'?completedTtlMs:failedTtlMs))count+=Number(this.db.prepare('DELETE FROM queue WHERE id=?').run(row.id).changes);
      }
      return count;
    });
  }
  close(){this.db.close();}
}
