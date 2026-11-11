import {constants} from 'node:fs';
import {mkdir,lstat,open,rename,unlink} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
const refs=new Set(['account','device','recovery','cache-key']);
async function noSymlinkAncestors(path) {
  for(let p=resolve(path);;p=dirname(p)) {
    try {if((await lstat(p)).isSymbolicLink())throw Error('Symlink state paths are not supported');}
    catch(e){if(e.code!=='ENOENT')throw e;}
    if(dirname(p)===p)break;
  }
}
export async function privateDir(path) {
  await noSymlinkAncestors(path);
  await mkdir(path,{recursive:true,mode:0o700});
  const s=await lstat(path);
  if(!s.isDirectory() || s.uid!==process.getuid() || (s.mode&0o077))throw Error('State directory must belong to you with mode 0700');
}
export async function readPrivate(path) {
  await noSymlinkAncestors(path);
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const s=await f.stat();
    if(!s.isFile() || s.uid!==process.getuid() || (s.mode&0o077) || s.nlink!==1 || s.size>8*1024*1024)throw Error('Private file must belong to you with mode 0600 and no links');
    return await f.readFile('utf8');
  }finally{await f.close();}
}
export async function atomicPrivate(path,value) {
  await privateDir(dirname(path));
  try {await readPrivate(path);}catch(e){if(e.code!=='ENOENT')throw e;}
  const temp=path+'.'+randomUUID();
  try {
    const f=await open(temp,'wx',0o600);
    try{await f.writeFile(value);await f.sync();}finally{await f.close();}
    await rename(temp,path);
    const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}
  }finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
// Keys live with the bot owner. No master key, Keychain or external vault.
export class KeyFiles {
  constructor(dir,{tokenFile,origin='https://api.orizo.app'}={}){Object.assign(this,{dir,tokenFile,origin});this.chain=Promise.resolve();}
  async init(){await privateDir(this.dir);}
  async get(ref){
    if(ref==='credential') {
      const token=(await readPrivate(this.tokenFile)).trim();
      if(!/^obt1\.[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(token))throw Error('Invalid token file');
      return {token,origin:this.origin};
    }
    if(!refs.has(ref))throw Error('Unknown key record');
    try{return JSON.parse(await readPrivate(join(this.dir,ref+'.json')));}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  put(ref,value){
    if(!refs.has(ref))throw Error('Unknown key record');
    const run=this.chain.then(()=>atomicPrivate(join(this.dir,ref+'.json'),JSON.stringify(value)));
    this.chain=run.catch(()=>{});return run;
  }
}
