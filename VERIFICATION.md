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

## Incremental receive verification

The incremental receive change passed all configured gates on Linux with
Node 24.22.2, networking disabled and the source mounted read-only:

- 31 application tests, including 14 incremental-sync regressions.
- 1 real-encryption integration test covering baseline, incremental arrivals,
  restart, decryptable replies and no repeated history download.
- 42 transport tests and 48 bundled-runtime tests.
- Standalone imports and crypto artifact integrity verification.

The new regressions cover idle request counts, batched resolution, pagination,
partial-page retry, baseline overlap, empty/new conversations, explicit cursor
reset, writer/authentication failures, revoked/unresolvable data, upgrade receipts
and bounded catch-up. These are synthetic protocol tests, not live latency or
bandwidth measurements. Live wake-ups are not implemented by the bundled token
transport; the lightweight five-second check remains intentionally enabled.

## Event-window and delivery migration

The updated candidate passed all configured gates on Linux with Node 24.22.2,
networking disabled and source mounted read-only:

- 39 application tests, including per-chat history recovery across restart,
  receipt retry, bounded queues, persistence failures and writer fencing.
- 1 real-encryption integration test: event-window baseline, incremental sync,
  explicit delivery acknowledgments and decryptable replies after restart.
  The synthetic API rejects legacy GET message-list requests.
- 42 transport tests and 52 bundled-runtime tests, including opaque window
  cursors, chronological catch-up, lifecycle/quote checks and receipt batching.
- Standalone imports and pinned crypto artifact integrity verification.

No existing bot process, key, account, plugin or server configuration was
changed for these checks. A fresh live-service exchange and physical-device
rendering remain unverified. Polling is unchanged; this is not a push transport.

## Limits

Offline regression results are not a new live-production acceptance test. This
publication candidate has not been deployed or verified in a fresh real-user
conversation. No claim is made here about physical-device UI behavior, arbitrary
power-loss recovery, sustained load or a complete independent cryptographic audit.
Keep deployment-specific records and credentials outside this repository.
