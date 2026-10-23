# 5. Neighborhood ranking and model-validation pipeline

## High-level method

The pipeline consumes source/bundle inventories, graphs with the same function identities, and POG anchors. Each round freezes the accepted mapping, finds unmatched bundled functions near accepted anchors, and collects source neighbors of the corresponding reference anchors. It excludes source identities already allocated in that target chunk, ranks remaining candidates by embedding cosine similarity, and validates up to `topK` in order. The first `T` becomes a proposal. Conflicting proposals for one source identity in the same chunk are rejected together; accepted proposals become anchors for the next round.

The graph inputs can be local or module-aware. The pipeline does not contain bundler-specific search logic. Cross-chunk propagation is optional, while source allocation remains per target chunk. It never reads source maps, oracle matches, or experiment result directories. A model acceptance is a heuristic identity judgment, not a proof of semantic equivalence. Initial-anchor errors can still propagate; accepted matches are not automatically rolled back.

## Deployment

Install Node.js 24+ and run `npm ci` from the ReCall root. For real recovery, deploy an Ollama-compatible HTTP service exposing `/api/tags`, `/api/embed`, and `/api/chat`, with the configured embedding and validation models available under the requested names. The defaults preserve the existing experiment aliases; they are not a promise that a fresh server has those models installed. Hardware, quantization, and model installation belong to the selected serving runtime.

Check your endpoint before a long run:

```sh
curl http://127.0.0.1:11434/api/tags
```

The client requires model digests from this response. They are included in cache keys and output provenance. No training or fine-tuning is performed.

## One-command composition

```sh
# Prepare all static component artifacts, without contacting a model service.
node bin/recall.mjs run --source-manifest examples/minimal/source.json --bundle-manifest examples/minimal/bundle.json --config examples/minimal/config.json --prepare-only --out outputs/prepared-example

# Full run; choose a different new output directory.
node bin/recall.mjs run --source-manifest examples/minimal/source.json --bundle-manifest examples/minimal/bundle.json --config examples/minimal/config.json --out outputs/recovered-example
```

`run` extracts both inventories, identifies library/version candidates and bundler evidence, resolves modules, builds both graphs, generates anchors, and runs ranking/validation. It saves each intermediate artifact for inspection or reuse. `--prepare-only` stops before all model calls and labels the run `prepared`, not recovered.

The source manifest provides local, versioned reference files. Capturing JS and supplying/building a fingerprint catalog remain caller responsibilities. The directory workflow can obtain exact npm references selected by that catalog. The library identifier uses the configurable anchor-count rule documented in [POG](../pog/README.md), not a claim to reproduce the complete DEBUN detector.

## Running only recovery with existing artifacts

```sh
node bin/recall.mjs recover --source outputs/prepared-example/source.json --bundle outputs/prepared-example/bundle.json --source-graph outputs/prepared-example/sourceGraph.json --bundle-graph outputs/prepared-example/bundleGraph.json --anchors outputs/prepared-example/anchors.json --libraries outputs/prepared-example/libraries.json --config examples/minimal/config.json --out outputs/recovery-only.json --library-gate true
```

For `run`, library gating defaults to **true**: only reference libraries meeting the required anchor count enter the matching pool. Versioned library metadata is required. For `recover`/`recoverFunctions`, it also defaults to **true**. Set `libraryGate:false` explicitly when the supplied references are already a justified candidate set. When gating is enabled, all passing version candidates remain available; indistinguishable versions may prevent unique anchors rather than being silently guessed.

## Configuration

The pipeline JSON has `recovery`, `models`, `graph`, `modules`, and optional `bundler` sections. Example:

```json
{
  "recovery": {
    "minFeatures": 10,
    "featureMetric": "propertyOperations",
    "minAnchors": 3,
    "libraryGate": true,
    "topK": 5,
    "radius": 1,
    "minSimilarity": -1,
    "sourceRepresentation": "minified",
    "maxCodeCharacters": 18000,
    "maxRounds": 1000,
    "maxValidationCalls": null,
    "crossChunk": false
  },
  "models": {
    "endpoint": "http://127.0.0.1:11434",
    "embeddingModel": "qwen3-embedding:0.6b",
    "validationModel": "qwen3.5:27b",
    "thinking": false,
    "temperature": 0,
    "seed": 42,
    "numCtx": 16384,
    "numPredict": 384,
    "embeddingBatch": 12,
    "timeoutMs": 300000,
    "keepAlive": "60m"
  },
  "graph": {"useModules": true, "siblingWindow": 2, "includeContainment": true},
  "modules": {"followDependencies": true, "valueLimit": 64, "eventLimit": 50000000}
}
```

Important settings:

| Setting | Effect |
|---|---|
| `minFeatures`, `featureMetric`, `minAnchors` | Anchor eligibility and optional library gate; see POG documentation |
| `topK` | Maximum ranked candidates considered per query; first positive stops the query |
| `radius` | Undirected graph hops for both source and bundle neighborhoods |
| `minSimilarity` | Cosine cutoff before top-k; `-1` keeps all candidates |
| `sourceRepresentation` | `minified` uses isolated Terser minification and the existing semantic instruction; `original` embeds source code directly |
| `maxCodeCharacters` | JS string-code-unit limit for model promotions; POG anchors can still exceed it; bodies are not silently truncated |
| `maxRounds` | Returns `round-limit` if expansion has not converged |
| `maxValidationCalls` | Logical candidate-check budget, including cached checks; returns `budget-exhausted` when reached |
| `crossChunk` | Permit a matched neighbor in another supplied target chunk |
| `graph.useModules` | Enable/disable the module-aware graphs on both sides |

CLI overrides exist for model names, endpoint, thinking, top-k, radius, feature/anchor thresholds, cross-chunk mode, library gating, validation budget, and cache directory; see `node bin/recall.mjs --help`. JSON supplies the remaining settings. Options are validated before matching. To use a different validator instruction, supply `models.systemPrompt` explicitly and evaluate it as a separate configuration.

## Validation, caching, and outputs

The default prompt is the existing three-input prompt: original source, minified source, and bundled function, supplied as JSON. Only uppercase `T`/`F` (after trimming whitespace) counts as a valid verdict. Other text or a failed request never accepts a match. Thinking is off by default. Unsupported isolated source forms that cannot be minified remain diagnosed and are excluded from model promotion, rather than being truncated or crashing all remaining targets.

`models.cacheDir` / CLI `--cache` selects response storage; otherwise CLI recovery uses a `model-cache` directory beside its output. Exact requests are keyed by endpoint, API operation, model digest, prompt, and request options. Changed models, prompts, or settings do not reuse incompatible decisions. Model weights themselves remain in the serving runtime. Use separate cache directories for concurrent writers.

The output `recall.recovery/v1` contains configuration and model provenance, graph/input digests, POG and model promotions, candidate rankings, validation responses, conflict outcomes, unrecovered function IDs, diagnostics, and timing/request statistics. It does **not** invent accuracy or recall without independent evaluation labels. `fixed-point` means no new proposals survive a round, not complete recovery. `run` also writes intermediate artifacts, `status.json`, and an overwritten per-round `checkpoint.json`. A new run directory is required; the high-level directory workflow supports `--resume` with compatibility checks and preserves unfinished budget-limited rounds. Completed artifacts can also be reused with individual commands.

## API and custom model providers

```js
import {runPipeline, recoverFunctions} from './components/pipeline/index.mjs';
const result = await runPipeline({source, bundle, config});
// Or supply existing sourceGraph/bundleGraph/anchors to recoverFunctions.
```

An injected `models` object can support a different inference backend: `embed(string[])` returns one finite, nonzero vector per input, with consistent dimensions; `validate({source,bundle,minified})` returns `{verdict: 'accept'|'reject'|'invalid'|'error', ...evidence}`. Optional `config`, `stats`, `metadata()`, and `modelDigests` provide provenance. This injection also enables deterministic integration tests without calling real models. The production default uses the HTTP adapter; tests are not model accuracy measurements.

## Recommended public workflow

Use `recall recover CAPTURED_DIRECTORY` for automatic input preparation, preflight, progress, resume, summary, and direct downstream mapping export. See [quickstart](../../docs/quickstart.md), [configuration](../../docs/configuration.md), and [troubleshooting](../../docs/troubleshooting.md). `runDirectory()` exposes this managed workflow as an API. `runPipeline()` and `recoverFunctions()` remain lower-level APIs for explicit inventories, injected model backends, and controlled experiments.

## Connectivity simulation for experiment adapters

The low-level `recoverFunctions` and `runPipeline` APIs accept an optional `candidateSelector({bundle,candidates,round,parentBundleIds})` callback. It returns a candidate source ID or `null`. Selection outside the computed neighborhood is rejected. This mode bypasses source minification, embeddings, ranking/top-k, validation, and model-client creation, while retaining graph neighborhoods, character limits, per-chunk allocation, synchronous rounds, and conflict handling. Outputs are labeled `selectionMode:external-neighborhood-selector` and promotions `externally-selected`; they are not model-recovery measurements.

Ground truth belongs only in the experiment-side callback. Production components do not load it. The callback can choose the ground-truth source if it is in the supplied candidate pool, implementing the connectivity simulation protocol. Keep initial seeds, eligibility, graph options, and denominators fixed when comparing recorded experiments. This is an API-level evaluation hook, not a webpage recovery CLI default.
