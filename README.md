# ReCall

Recover original library-function identities from supplied JavaScript bundles using POG anchors, relationship graphs, AST matching, embeddings, and model validation.

This repository contains the recovery implementation. **ReCall Dataset** owns ground truth and dataset membership; **ReCall Exp** owns experiment runners, simulation validators, reports, and historical implementations. Recovery does not consume source-map correspondences or ground-truth decisions.

## Quick start

Requires **Node.js 24+**, npm, and an Ollama-compatible service for model recovery.

```sh
npm ci
node bin/recall.mjs recover examples/minimal/bundle --references examples/minimal/source --config examples/minimal/config.json --prepare-only --out outputs/demo
```

Preparation parses inputs, extracts features, and builds graphs without model calls. The example produces one POG anchor. Continue with the configured models:

```sh
node bin/recall.mjs recover examples/minimal/bundle --references examples/minimal/source --config examples/minimal/config.json --resume --out outputs/demo
```

Use a new output directory after changing implementation, inputs, or model settings. Preserve existing results for reproducibility.

## Experiment configuration

```sh
node bin/recall.mjs run --source-manifest /path/to/source.json --bundle-manifest /path/to/bundle.json --config examples/known-reference.config.json --out outputs/experiment
```

Use the same source bytes, original function spans, package identities and supplied chunks as the intended experiment. Different source representations can produce different identities even when the code behaves similarly.

| Setting | Default |
|---|---|
| Embedding | `qwen3-embedding:0.6b` |
| Validation | `qwen3.5:27b`, thinking off |
| Endpoint | `http://127.0.0.1:11434` |
| Library identification gate | Disabled |
| Initial anchors | POG equality, at least 10 property operations |
| AST precheck | Before ranking; first matching candidate accepted |
| Ranked validation | Top 3; stop at first acceptance |
| Neighborhood radius | 1 |
| Bundle cross-chunk relationships | Enabled across supplied files |
| Source relationships | Isolated per library instance |

Simulation in **ReCall Exp** retains real embeddings and substitutes GT decisions only for model validation. Ordinary ReCall uses real validation; matching settings do not guarantee simulation scores. AST equality is a heuristic, not proof of unique origin.

Relationship-aware pruning is enabled by default; the old unfiltered path is removed. See [fast-validation.config.json](examples/fast-validation.config.json) and the [configuration tradeoffs](docs/configuration.md#relationship-pruning-before-model-validation).

Enable `recovery.libraryGate:true` explicitly to require the library anchor threshold. Catalog discovery independently applies its identification threshold. Neither option relaxes source isolation.

## Code organization

| Location | Responsibility |
|---|---|
| `bin/` | CLI |
| `components/` | Public capture, POG, bundler, module, graph and recovery APIs |
| `src/config.mjs` | Canonical defaults and configuration validation |
| `src/workflow/` | Input preparation, preflight, orchestration and outputs |
| `src/analysis/` | Parsing, TypeScript, scopes, AST comparison and neighborhoods |
| `src/engine/` | Bundler adapters and module/value-flow solver |
| `src/shared/` | Artifact contracts, hashes and common utilities |
| `test/` | Current implementation regression and integration tests |
| `benchmarks/` | Offline performance checks on saved artifacts |
| `examples/` | Runnable inputs and supported configurations |
| `vendor/`, `third_party/` | Required fingerprint dependencies and notices |

Historical scripts and obsolete validation records live outside the runtime repository. Generated outputs, caches and node_modules are Git-ignored; existing local experiment outputs are preserved.

## Recovery flow

1. Parse supplied source and bundle code, retaining original identities and spans.
2. Extract POG fingerprints and initial anchors.
3. Resolve source imports/exports inside each library and build the full supplied bundle graph.
4. Expand around accepted pairs; try AST matching before embedding and ranked validation.
5. Save predictions, candidate decisions, diagnostics and checkpoints until a fixed point or budget limit.

Source resolution does not follow inter-library calls. Bundle resolution can follow cross-module and cross-chunk relationships among supplied files. ReCall does not automatically discover every runtime-loaded chunk.

## Outputs

Runs save resolved configuration, inventories, anchors, module maps, graphs, recovery decisions and status under the requested output directory. Inspect `status.json`, `resolved-config.json` and `recovery.json`. Promotions are predictions; recovery rate requires separate ground-truth evaluation.

The validator prompt is [validator-system-prompt.txt](src/analysis/validator-system-prompt.txt). Requests and digest-keyed caches are implemented in [models.mjs](components/pipeline/models.mjs).

## Tests and documentation

Run `npm test`. Tests use synthetic fixtures and mock HTTP services, not real model inference; integration tests require localhost socket access.

- [Input preparation and CLI workflow](docs/quickstart.md)
- [Configuration](docs/configuration.md)
- [Component APIs and artifact contracts](docs/component-contracts.md)
- [Adapter development](docs/adapters.md)
- [Performance notes](docs/performance.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Migration](docs/migration-0.3.md)
- [Optional capture](docs/capture-workflow.md)
- [Minimal example](examples/minimal/README.md)

Public JavaScript exports are in [index.mjs](index.mjs); each component has its own README and package export.
