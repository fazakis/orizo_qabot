import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {realpath} from 'node:fs/promises';
// Linux abstract Unix socket: local only, kernel-released on crash, no stale lock file.
export async function acquireLock(dir){
 if(process.platform!=='linux')throw Error('Run this example on Linux');
 const path='\0orizo-qabot-'+createHash('sha256').update(`${process.getuid()}:${await realpath(dir)}`).digest('hex');
 const server=createServer(socket=>socket.destroy());
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
 return ()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}
