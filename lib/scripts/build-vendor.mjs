// Rebuild the JS bundles entirely from public sources; does not access credentials.
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=resolve('source/core');
await build({stdin:{contents:`export {createWebOlmEngine} from './src/e2ee/vodozemacWeb/engine.ts';
export {initSync,invoke} from './src/e2ee/vodozemacWeb/runtime.js';
export {WEB_OLM_SHA256} from './src/e2ee/vodozemacWeb/integrity.ts';
export * from './src/e2ee/messageRecoveryCrypto.ts';
export {xchacha20poly1305,chacha20poly1305} from '@noble/ciphers/chacha.js';
export {x25519} from '@noble/curves/ed25519.js';
export {hkdf} from '@noble/hashes/hkdf.js';
export {sha256} from '@noble/hashes/sha2.js';`,resolveDir:base,loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:'vendor/crypto.mjs'});
const exports=['directoryIdentity','directoryCertificates','recoveryDirectoryCertificates','directoryHeads','messageAuthorBinding','messageAuthorBindingWire','recipientDirectoryCertificates'];
await build({stdin:{contents:exports.map(n=>`export * from './src/e2ee/${n}.ts';`).join('\n'),resolveDir:resolve('source/directory'),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:'vendor/directory.mjs'});
const wasm=await readFile('vendor/runtime_bg.wasm');
await writeFile('vendor/wasm.mjs','// Integrity-pinned Orizo runtime.\nexport default '+JSON.stringify(wasm.toString('base64'))+';\n');
console.log('Public-source JavaScript bundles rebuilt. Runtime SHA256:',createHash('sha256').update(wasm).digest('hex'));
