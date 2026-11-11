#!/usr/bin/env node
import {parseArgs} from './src/cli.mjs';
import {run} from './src/main.mjs';
process.umask(0o077);
try {
 const config=parseArgs(process.argv.slice(2));
 if(config.help)console.log('node bot.mjs --token-file PATH [--environment production|localdev] [--state-dir PATH] [--allow-user ID] [--conversation UUID]\nDefault: answer people who explicitly start this bot; group questions must mention it.');
 else await run(config);
} catch {
 // Never emit tokens, decrypted messages, SDK response bodies or key records.
 console.error('Bot stopped. Check token-file/state permissions, network access and whether another copy is running. Your existing keys have not been reset.');
 process.exitCode=1;
}
