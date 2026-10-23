# Pinned dependency used by POG hashing

`rapidhash-js/` contains the unchanged runtime files of version 1.0.4 already present in the original vendored DEBUN dependency installation. Its MIT license and original package metadata (`UPSTREAM.package.json`) are retained. The installable local package manifest omits upstream development-only dependencies and scripts; runtime code and exports are unchanged. The root package declares it as a local file dependency so a clean `npm ci` installs the hashing runtime even when ignored `vendor/debun/node_modules` is absent.

The DEBUN backend remains under `vendor/debun`, with its existing provenance record. No new license is asserted for that upstream backend.
