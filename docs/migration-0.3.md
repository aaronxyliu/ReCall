# Upgrade from the initial component release

The improvements were implemented in this order:

1. Directory-based recovery, local package discovery, fingerprint catalogs, and exact npm reference retrieval.
2. One strict nested configuration format, consistent library gating, and saved resolved settings.
3. A shared syntax project with optional POG features, reusable analysis under `src/`, and in-memory solved-state reuse.
4. Runtime recognition adapters, shared helper summaries, a module IR with exports/bindings, and adapter contract tests.
5. Read-only preflight, progress, output locks, atomic checkpoints, cancellation, validated resume, and summary/mapping exports.
6. A task-first quickstart, configuration reference, adapter guide, troubleshooting, and command-specific help.

## Behavior changes

- Standalone CLI configuration now uses the same nested sections as `run`; move old top-level graph/module/bundler settings into their sections.
- Library gating defaults to true in both standalone and integrated recovery. Set `recovery.libraryGate:false` explicitly to use a preselected reference pool without gating.
- Standalone commands write an `OUTPUT.config.json` sidecar with resolved settings.
- Existing 0.2 generated inventories can be inspected, but old module maps/checkpoints are not promised compatible with the new engine. Generate a new run for the new public runtime.
- Public runtime components import reusable code from `src/`. Original `scripts/` and the original validator prompt remain unchanged for experiment provenance and legacy entry points.
- Directory discovery includes every non-hidden `.js`/`.mjs`/`.cjs` file outside `node_modules`, without following symlinks. Use explicit manifests to curate reference/source populations and separate execution environments.

No comprehensive npm catalog is shipped. You must supply/build a fingerprint catalog or provide local reference packages. Browser capture and running arbitrary package build scripts remain external preparation steps. Full run directories retain exact filesystem paths; relocation requires a new run. Catalogs can fall back to npm reference retrieval when local paths are unavailable.

These changes do not rerun or replace any frozen scientific experiment. Synthetic integration tests and mock service results are software validation, not model-accuracy measurements.
