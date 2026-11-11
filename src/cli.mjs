import {resolve} from 'node:path';
import {homedir} from 'node:os';
export function parseArgs(args) {
 const opts={tokenFile:null,stateDir:resolve(homedir(),'.local/share/orizo-qabot'),allowedUserIds:[],conversationIds:[],pollIntervalMs:5000,apiOrigin:'https://api.orizo.app',cdnOrigin:'https://cdn.orizo.app'};
 const map={'--token-file':'tokenFile','--state-dir':'stateDir','--allow-user':'allowedUserIds','--conversation':'conversationIds','--environment':'environment'};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--help'){opts.help=true;continue;}
  const key=map[args[i]],value=args[++i];
  if(!key || !value || value.startsWith('--'))throw Error('Use --token-file PATH --state-dir PATH');
  if(key==='environment'){if(!['production','localdev'].includes(value))throw Error('Unknown environment');opts.environment=value;}
  else if(key==='allowedUserIds'){const id=Number(value);if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid user ID');opts[key].push(id);}
  else if(key==='conversationIds'){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw Error('Invalid conversation ID');opts[key].push(value);}
  else opts[key]=resolve(value);
 }
 if(opts.environment==='localdev'){
  opts.apiOrigin=opts.cdnOrigin='https://dev.orizo.app';
  if(!args.includes('--state-dir'))opts.stateDir=resolve(homedir(),'.local/share/orizo-qabot-localdev');
 }
 if(!opts.help && !opts.tokenFile)throw Error('--token-file is required');
 return opts;
}
