# Included Orizo messaging implementation

This is ordinary source maintained inside this application, not a separately
installed or versioned SDK. No sibling repository, Git submodule, private npm
package, snapshot update tool, or cross-repository workflow is required.

`src/` implements encrypted messaging, attachments, signed fallback keys and
persistent delivery. `vendor/` contains generated cryptographic bundles and
integrity-pinned WASM. `source/` contains their corresponding source; `licenses/`,
`LICENSE`, `NOTICE`, and `PROVENANCE.md` retain upstream licensing and provenance.
See `CRYPTO-BUILD.md` for rebuilding crypto; `npm run test:runtime` at the repository
root tests this implementation. Test fixtures are synthetic, not live identities.

If a messaging fix also applies to another bot application, port it explicitly
and run that application's own regression suite. There is no automatic propagation.
