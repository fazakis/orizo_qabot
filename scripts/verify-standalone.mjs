import assert from 'node:assert/strict';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const ignored=new Set(['node_modules','.git','artifacts','target']);
async function walk(dir){let out=[];for(const e of await readdir(dir,{withFileTypes:true})){
 if(ignored.has(e.name))continue;const f=path.join(dir,e.name);
 if(e.isDirectory())out.push(...await walk(f));else if(e.isFile()&&e.name.endsWith('.mjs'))out.push(f);
}return out;}
const runtimeDirs=['src','lib/src','lib/vendor'];
const files=(await readdir(root)).filter(f=>f.endsWith('.mjs')).map(f=>path.join(root,f));
for(const dir of runtimeDirs)files.push(...await walk(path.join(root,dir)));
try{files.push(...await walk(path.join(root,'bin')));}catch(e){if(e.code!=='ENOENT')throw e;}
for(const f of files){
 const text=await readFile(f,'utf8');
 for(const m of text.matchAll(/(?:from\s*|import\s*\(\s*|export[^;]*?from\s*)['"](\.[^'"]+)['"]/g)){
  const target=path.resolve(path.dirname(f),m[1]);
  assert.ok(target.startsWith(root+path.sep),'Import leaves repository: '+f);
  await lstat(target);
 }
}
const wasm=await readFile(path.join(root,'lib/vendor/runtime_bg.wasm'));
const {default:encoded}=await import('../lib/vendor/wasm.mjs');
assert.deepEqual(Buffer.from(encoded,'base64'),wasm);
const {WEB_OLM_SHA256}=await import('../lib/vendor/crypto.mjs');
assert.equal(createHash('sha256').update(wasm).digest('hex'),WEB_OLM_SHA256);
assert.doesNotMatch(wasm.toString('latin1'),/\/(Users|home)\/[A-Za-z0-9_.-]+\//);
const pkg=JSON.parse(await readFile(path.join(root,'package.json')));
for(const deps of [pkg.dependencies,pkg.devDependencies])for(const [name,version] of Object.entries(deps??{})){
 assert.ok(!String(version).startsWith('file:..'),'Sibling dependency: '+name);
 assert.ok(!['@orizo/bots-sdk','@gymapp/bots','@orizo/openclaw'].includes(name),'Repository dependency: '+name);
}
console.log('Standalone imports and path-sanitized crypto integrity verified.');
