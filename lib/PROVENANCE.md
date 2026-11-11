# Extraction provenance

- Common client: gymapp_bots commit 82f5343b85f61e01bef9a296f59c434898ab4a7c.
- Source-complete crypto distribution and KeyFiles provider: orizo_qabot commit
  5f3263ecf48b777e86e389cff92fd37a1431e015 (AGPL-3.0-only with upstream notices).
- Core crypto source: 70616a230f9c9bbaa08df5acae17b00711190dde.
- Directory source: 11f0d9746bdf8eafa5e4b4d08b425bb59180cd7a.
- WASM SHA256: b3e12b9e441f38d80599c9c05a3cd0a0dc737847027cf0755cb6c661641f94cd.

JavaScript bundles are the QA distribution's source-rebuildable versions; they
are not byte-identical to the older managed bundle. This extraction retains
the same protocol, persisted state formats and fallback-key implementation.
The publication rebuild is recorded below.
Consumer integration regressions are required before adoption or deployment.

## Publication metadata cleanup (0.1.1)

Rebuilt the same Rust implementation with build paths remapped to neutral
prefixes. Refreshed the matching JavaScript glue, integrity hash and bundled
base64 asset. No cryptographic algorithm, account state or protocol change is
intended. Runtime regression results accompany the release candidate.
