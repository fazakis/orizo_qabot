# Crypto build and provenance

This local library includes the JavaScript and Rust sources, locked dependencies, compiled
WebAssembly, and third-party notices needed to rebuild its encrypted transport.
No private repository or credential provider is needed for a build.

## Rebuild

Use Rust with the `wasm32-unknown-unknown` target and wasm-bindgen-cli **0.2.126**
(the exact version pinned in the Rust manifest). Install the locked JavaScript
dependencies with `npm ci` at the repository root, `lib/source/core` and `lib/source/directory`.
Then run:

```sh
cd lib
python3 scripts/build-wasm.py
node scripts/build-vendor.mjs
cd ..
npm run test:runtime
```

The Rust build remaps workspace, Cargo-cache and home-directory prefixes to
neutral paths. This prevents compiler-generated panic messages from embedding
build-machine usernames and directory layouts. After rebuilding, scan both the
WASM and its base64 JavaScript copy; refresh artifact hashes in
`vendor/provenance.json` before committing the generated artifacts.

A rebuild changes the executable hash, so the matching integrity constant,
JavaScript wrapper and base64 copy must travel together. Never edit the deployed
binary or bypass its integrity check. Run this application's integration tests before deployment.

## Source relationship

This distribution preserves the transport protocol and corresponding licenses.
Fixed interoperability fixtures are test data, not deployed account state.
Source revisions and artifact hashes are recorded in `PROVENANCE.md` and
`vendor/provenance.json`.
