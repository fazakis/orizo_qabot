#!/usr/bin/env python3
"""Build the supplied Rust sources with public locked dependencies."""
from pathlib import Path
import subprocess, hashlib, os, shlex
root=Path(__file__).resolve().parents[1]
core=root/'source/core'
# Keep developer home/workspace paths out of panic strings and debug metadata.
env=dict(os.environ)
cargo_home=Path(env.get('CARGO_HOME',str(Path.home()/'.cargo'))).resolve()
remaps=[f'--remap-path-prefix={root}=/orizo-sdk',f'--remap-path-prefix={cargo_home}=/cargo',f'--remap-path-prefix={Path.home()}=/builder']
env['CARGO_ENCODED_RUSTFLAGS']='\x1f'.join(shlex.split(env.pop('RUSTFLAGS',''))+remaps)

subprocess.run(['cargo','build','--locked','--manifest-path',str(core/'modules/orizo-olm-web/Cargo.toml'),'--target','wasm32-unknown-unknown','--release'],env=env,check=True)
out=core/'src/e2ee/vodozemacWeb'
subprocess.run(['wasm-bindgen',str(core/'modules/orizo-olm-web/target/wasm32-unknown-unknown/release/orizo_olm_web.wasm'),'--target','web','--out-dir',str(out),'--out-name','runtime'],check=True)
p=out/'runtime.js'
s=p.read_text().replace("module_or_path = new URL('runtime_bg.wasm', import.meta.url);", "throw new Error('The pinned WebAssembly asset must be supplied explicitly.');")
assert 'import.meta' not in s
p.write_text(s)
wasm=(out/'runtime_bg.wasm').read_bytes()
(root/'vendor/runtime_bg.wasm').write_bytes(wasm)
(out/'integrity.ts').write_text("export const WEB_OLM_SHA256 = '"+hashlib.sha256(wasm).hexdigest()+"';\n")
print('WASM rebuilt; run npm run build:vendor, then npm test.')
