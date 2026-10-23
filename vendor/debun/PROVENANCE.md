# Pinned graph backend

The three JavaScript backend files were copied byte-for-byte from the locally available DEBUN ASE 2025 artifact distribution at `/Users/aaronxyliu/GitHub/bundle-study/third_party/debun-ase25/dist/`:

- `fingerprint-collector/pog-generator.js`
- `fingerprint-collector/hash-function.js`
- `utils/builtins.js`

Upstream artifact: https://github.com/ku-plrg/debun-ase25

`node_modules/rapidhash-js/` is a local, complete copy of dependency version 1.0.4, including its MIT license. The graph algorithms are unchanged. Study-specific AST counting, own-body pruning, function selection and correspondence voting live in `scripts/`, outside the vendored backend. Exact file hashes are in `manifests/toolchain.json`. The local DEBUN copy did not include a top-level LICENSE; this record is provenance, not a new licensing assertion.
