# Recover functions from captured JavaScript

## 1. Install and prepare

Run `npm ci` in the ReCall checkout with Node.js 24+. Commands below use `node bin/recall.mjs`; an installation exposing the package executable can use `recall` directly. No global installation is required.

Place intercepted `.js`, `.mjs`, and `.cjs` files in a directory. ReCall discovers them recursively and skips symlinks, hidden directories, and `node_modules`. Capturing the page and exercising lazy-loaded interactions remain capture-side tasks: ReCall can only analyze files you supply. There is no source-map requirement. Use a manifest when files belong to different execution environments or require explicit identities/context roots.

For local references, provide one package directory or a directory containing several package directories. Each package needs a `package.json` with an exact `name` and `version` and at least one JavaScript file. References may include package distribution files; curate a source manifest if you need a particular source population rather than every published JavaScript file.

```sh
node bin/recall.mjs recover ./captured-js --references ./reference-packages --prepare-only --out outputs/my-page
```

The default library threshold is three distinct matching reference fingerprints, with at least ten own-body property-operation occurrences per eligible function. Smaller examples may need an explicitly chosen threshold. Do not tune thresholds using final evaluation labels.

## 2. Configure models and inspect preflight

Copy `examples/recall.config.json` to `recall.json` and adjust paths and model aliases. Paths in a configuration file are relative to that file; CLI paths are relative to the current working directory. `preflight` performs read-only checks and does not generate features, download references, or invoke inference:

```sh
node bin/recall.mjs preflight ./captured-js --references ./reference-packages --config recall.json
```

Without `--prepare-only`, preflight contacts the model service's metadata endpoint to verify names and digests. Model weights, quantization, and hardware are managed by the serving runtime.

## 3. Run and resume

```sh
node bin/recall.mjs recover ./captured-js --references ./reference-packages --config recall.json --out outputs/full-run
```

Use a new output directory, or `--resume` for the same run. Existing static artifacts are reused when compatible. Inputs, context files, tool implementation, model settings, and model digests must agree. You may increase `recovery.maxValidationCalls` or `recovery.maxRounds`; other changes require a new run. An unfinished budget-limited round preserves pending proposals and checks before conflict resolution. If a process is interrupted mid-round, it restarts that round and reuses cached exact model responses.

A `.recall.lock` prevents concurrent writers. SIGINT/SIGTERM release it after cancellation. A forcibly killed process may leave the lock; confirm the recorded PID is no longer running before removing it.

## 4. Consume the mapping

`recovered-functions.json` directly lists bundled locations and recovered reference identities:

```js
import fs from 'node:fs';
const mapping = JSON.parse(fs.readFileSync('outputs/full-run/recovered-functions.json'));
for (const match of mapping.functions) {
  console.log(match.bundle.file, match.bundle.span, match.source.library,
              match.source.name, match.method);
}
```

Spans are JavaScript string offsets `[start,end)` in the exact saved input text. Matches include POG anchors and model promotions. ReCall's identities are heuristic; downstream analysis can retain the method and evidence instead of treating every match as proven equivalence.

`summary.json` reports counts over parsed input functions and explicitly lists parse failures. `unqueried` means no model query was recorded; it alone does not establish that a function is disconnected. The detailed recovery file explains candidate checks and conflicts. No oracle-derived accuracy is fabricated.

## Build and reuse a library catalog

```sh
node bin/recall.mjs catalog build --references ./reference-packages --out outputs/library-catalog.json
node bin/recall.mjs recover ./captured-js --catalog outputs/library-catalog.json --config recall.json --out outputs/catalog-run
```

You can instead build the catalog using `--source-manifest FILE`. The catalog records versioned reference fingerprints and optional verified local file locations. Recovery selects all candidates meeting the anchor threshold, uses matching local files when available, and otherwise fetches the exact npm versions into the run's reference cache. It verifies archive integrity and records registry provenance. Package scripts and dependencies are not installed or executed.

A catalog covers only the packages/versions you indexed. This is not a bundled comprehensive npm catalog or DEBUN's full weighted identification method. Identical functions shared by several reference versions may block unique anchors even when multiple versions pass library detection. Zero passing candidates produces an explicit error. Relocated catalogs can fetch references when local paths are unavailable; `--offline` requires a valid local/cached copy. Browser capture and automatic execution of reference build scripts are not part of this command.
