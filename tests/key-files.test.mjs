import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,symlink,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {KeyFiles,privateDir} from '../src/key-files.mjs';
import {acquireLock} from '../src/lock.mjs';
import {parseArgs} from '../src/cli.mjs';
const token='obt1.'+'a'.repeat(32)+'.'+'b'.repeat(43);
async function fixture(t){const d=await mkdtemp(join(tmpdir(),'qabot-files-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
test('two-argument CLI; no credential values or hidden setup',()=>{
 const c=parseArgs(['--token-file','/private/token','--state-dir','/private/state']);assert.equal(c.tokenFile,'/private/token');assert.equal(c.stateDir,'/private/state');assert.deepEqual(c.allowedUserIds,[]);
 assert.throws(()=>parseArgs(['--token',token]));assert.throws(()=>parseArgs([]));assert.throws(()=>parseArgs(['--token-file','--state-dir']));
});
test('files persist identity and enforce private token mode',async t=>{
 const d=await fixture(t),tokenFile=join(d,'token'),dir=join(d,'keys');await writeFile(tokenFile,token,{mode:0o600});
 const v=new KeyFiles(dir,{tokenFile});await v.init();assert.equal((await v.get('credential')).token,token);
 await v.put('device',{deviceId:'synthetic',pickle:'test'});assert.deepEqual(await new KeyFiles(dir).get('device'),{deviceId:'synthetic',pickle:'test'});
 assert.equal((await stat(join(dir,'device.json'))).mode&0o777,0o600);
 await chmod(tokenFile,0o644);await assert.rejects(()=>v.get('credential'));await chmod(tokenFile,0o600);
 assert.throws(()=>v.put('credential',{token}));
});
test('corrupt keys are errors, not a request to create a new identity',async t=>{
 const d=await fixture(t),v=new KeyFiles(d);await writeFile(join(d,'device.json'),'broken',{mode:0o600});
 await assert.rejects(()=>v.get('device'));assert.equal(await readFile(join(d,'device.json'),'utf8'),'broken');
});
test('symlinks and broad permissions are rejected',async t=>{
 const d=await fixture(t),real=join(d,'real');await writeFile(real,token,{mode:0o600});await symlink(real,join(d,'token'));
 const v=new KeyFiles(join(d,'keys'),{tokenFile:join(d,'token')});await v.init();await assert.rejects(()=>v.get('credential'));
 await symlink(d,join(d,'alias'));await assert.rejects(()=>privateDir(join(d,'alias','keys2')));
 await chmod(v.dir,0o755);await assert.rejects(()=>v.init());
});
test('single writer lock releases cleanly for restart',async t=>{
 const d=await fixture(t);const release=await acquireLock(d);await assert.rejects(()=>acquireLock(d));await release();await (await acquireLock(d))();
});
