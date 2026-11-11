import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArgs} from '../src/cli.mjs';
test('token file is sufficient; optional restrictions use immutable IDs',()=>{
 const c=parseArgs(['--token-file','/private/token']);
 assert.equal(c.tokenFile,'/private/token');assert.deepEqual(c.allowedUserIds,[]);
 assert.equal(c.apiOrigin,'https://api.orizo.app');
 const restricted=parseArgs(['--token-file','/private/token','--allow-user','1','--allow-user','2','--conversation','11111111-1111-4111-8111-111111111111']);
 assert.deepEqual(restricted.allowedUserIds,[1,2]);assert.equal(restricted.conversationIds.length,1);
});
test('rejects inline credentials, alternate origins and malformed restrictions',()=>{
 for(const args of [[],['--token','secret'],['--api-origin','https://example.com'],['--token-file'],['--token-file','/private/token','--allow-user','fazakis'],['--token-file','/private/token','--conversation','-'.repeat(36)]])assert.throws(()=>parseArgs(args));
 assert.equal(parseArgs(['--help']).help,true);
});
test('LOCALDEV targets only the fixed development origin and isolates default state',()=>{
 const production=parseArgs(['--token-file','/private/token']);
 const local=parseArgs(['--environment','localdev','--token-file','/private/token']);
 assert.equal(local.apiOrigin,'https://dev.orizo.app');
 assert.equal(local.cdnOrigin,local.apiOrigin);
 assert.notEqual(local.stateDir,production.stateDir);
 assert.equal(parseArgs(['--token-file','/private/token','--environment','localdev','--state-dir','/private/state']).stateDir,'/private/state');
 assert.equal(parseArgs(['--token-file','/private/token','--environment','production']).apiOrigin,production.apiOrigin);
 for(const environment of ['staging','https://evil.example','localdev/'])assert.throws(()=>parseArgs(['--token-file','/private/token','--environment',environment]));
});
