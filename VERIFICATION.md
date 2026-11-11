# Verification

## Automated coverage

The standalone application, persistent-file storage, encrypted integration and
transport suites run on Linux with Node 24.22.2. They use synthetic identities
and local fake API responses, not production accounts or credentials.

```sh
npm run verify:standalone
npm test
npm run test:integration
npm run test:transport
```

Coverage includes FAQ routing, consented group mentions, optional sender and
conversation restrictions, rejection of inline credentials, protected-file
permissions, single-writer locking, authenticated encrypted replies, key reuse
after restart, stable retry IDs and duplicate suppression. Transport regressions
cover signed fallback prekeys for exhausted recipients and rejection of forged
or wrong-device signatures, attachment authentication and quoted context.

## Publication preparation

Private deployment history and operator-specific instructions are not part of
this source distribution. The included messaging library's WebAssembly was rebuilt from the
included locked Rust sources with build-machine paths remapped to neutral
prefixes. Its JavaScript glue, integrity constant, base64 copy and recorded
artifact hashes were updated together. Runtime licenses and test fixtures are retained.

## Candidate check results

- 60 QA application/integration/transport tests passed on Linux, Node 24.22.2,
  with networking disabled and the source mounted read-only.
- 45 messaging tests passed against the path-remapped runtime.
- Crypto artifact verification passed; no original home-directory paths
  remain in either the WASM or its matching base64 copy.

## Limits

Offline regression results are not a new live-production acceptance test. This
publication candidate has not been deployed or verified in a fresh real-user
conversation. No claim is made here about physical-device UI behavior, arbitrary
power-loss recovery, sustained load or a complete independent cryptographic audit.
Keep deployment-specific records and credentials outside this repository.
