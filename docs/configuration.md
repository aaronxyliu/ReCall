# One configuration for every command

Every CLI command accepts the same **nested** configuration object. It reads the relevant section and validates all sections. Unknown settings and invalid types fail before analysis; old flat component configuration files must be migrated. Copy `examples/recall.config.json` as a starting point.

Precedence is built-in defaults → configuration file → explicit CLI overrides. Configuration paths are relative to the configuration file. CLI paths are relative to the current working directory. Runs save every resolved default and override in `resolved-config.json`; standalone component commands save `OUTPUT.config.json` beside their artifact. Library gating defaults to **true** for both integrated and standalone recovery; explicitly set `recovery.libraryGate:false` when references are already selected and gating is intentionally omitted.

| Section | Main settings and defaults |
|---|---|
| `inputs` | `references:null`, `catalog:null`, `cacheDir:null`, `registry:"https://registry.npmjs.org"`, `offline:false`, `timeoutMs:300000`, `maxFiles:20000`, `maxBytes:1073741824` |
| `recovery` | `minFeatures:10`, `featureMetric:"propertyOperations"`, `minAnchors:3`, `uniqueBundle:false`, `libraryGate:true`, `topK:3`, `astBeforeRanking:true`, `radius:1`, `crossChunk:false`, `minSimilarity:-1`, `sourceRepresentation:"minified"`, `maxCodeCharacters:18000`, `maxRounds:1000`, `maxValidationCalls:null` |
| `models` | `endpoint:"http://127.0.0.1:11434"`, `embeddingModel:"qwen3-embedding:0.6b"`, `validationModel:"qwen3.5:27b"`, `thinking:false`, `temperature:0`, `seed:42`, `numCtx:16384`, `numPredict:384`, `embeddingBatch:12`, `timeoutMs:300000`, `keepAlive:"60m"`, `cacheDir:null`, `systemPrompt:null` |
| `graph` | `useModules:true`, `siblingWindow:2`, `includeContainment:true` |
| `modules` | `followDependencies:true`, `valueLimit:64`, `eventLimit:50000000`, `maxFiles:20000`, `maxBytes:1073741824` |
| `bundler` | `hint:null` |
| `execution` | `progress:true` |

`inputs` limits bound directory discovery and npm unpacking. `modules` limits independently bound graph context and solving. Byte/file limits do not substitute for a process memory limit. `valueLimit` can widen difficult value sets to unknown, reducing resolved relationships. `maxValidationCalls` counts logical candidate checks, including cached HTTP responses; a checkpoint can reuse already recorded candidate verdicts without counting them again. `radius` controls graph hops; `siblingWindow` controls source-order proximity. They are different parameters.

CLI recovery overrides: `--top-k`, `--radius`, `--min-features`, `--feature-metric`, `--min-anchors`, `--embedding-model`, `--validation-model`, `--endpoint`, `--thinking true|false`, `--cross-chunk true|false`, `--library-gate true|false`, `--max-validation-calls`, and `--cache`. `--references`, `--catalog`, `--offline`, and `--quiet` control the workflow. Other settings belong in JSON.

`systemPrompt:null` loads the default instructions from [src/analysis/validator-system-prompt.txt](../src/analysis/validator-system-prompt.txt). Edit that file to change the default, or set `models.systemPrompt` to replacement prompt text (a string, not a file path). The validator expects exactly uppercase `T` or `F`. Start a new run directory after changing the prompt. An explicit string defines a different configuration and cannot reuse incompatible cache entries. Caches are keyed by exact requests, endpoint, model digest, and options. Defaults do not establish an optimal scientific configuration; configuration tradeoffs remain an empirical question.

Standalone example:

```json
{"graph":{"siblingWindow":0,"includeContainment":false}}
```

```sh
node bin/recall.mjs graph --inventory bundle.json --module-map modules.json --config recall.json --out graph.json
```

The JavaScript high-level APIs `runDirectory`, `preparePipeline`, and `runPipeline` use this canonical configuration. Low-level APIs such as `identifyAnchors(inventory,bundle,options)` and `recoverFunctions({config:{...recoveryOptions,models}})` retain explicit component options for library integration; see component guides. `normalizeConfig()` exposes the canonical validator/default resolver.

### Optional AST-first validator

Set `models.astFirst: true` to accept matching normalized function ASTs before the model (default false). External identifiers may be consistently renamed without verifying binding correspondence; properties, literals, and lexical scope remain distinct. Inconclusive comparisons fall through. Decisions record `validator: "ast"` or `"model"` for separate evaluation. Set `recovery.libraryGate: false` to admit all supplied reference libraries regardless of the anchor-count identification threshold.

### Multiple bundled copies

Initial POG anchors accept every bundled function with the fingerprint of one unique source function, including repeated copies within one chunk. POG equality is sufficient; no AST or model confirmation is added to initial anchors. Library identification counts distinct source functions, so bundled copies do not inflate its anchor count. `uniqueBundle` defaults to `false`; explicitly setting it to `true` restores the stricter library-evidence filter, without changing initial-anchor matching.

Source identities remain reusable across distinct bundled targets throughout recovery, candidate selection, AST promotion, model promotion, and checkpoint resume. Each target is settled at its first acceptance. `recovery.conflictPolicy` (`"discard"` by default) controls conflicting assignments to the same bundled target; source reuse is not a conflict. `"retain"` also permits conflicting target seeds supplied by a caller. Recovery output includes `multipleMatches` with target ambiguity and source-reuse counts and identities.

### Source import resolution

Source module analysis resolves relative imports/re-exports and supplied package entry points, including CommonJS exports used by ESM imports. Reference manifest files may specify `packageRoot`; installed reference discovery records this automatically. Supplied `package.json` entry fields and supported `exports` conditions guide resolution. Query/fragment-suffixed paths and explicit `aliasPaths` resolve to the existing supplied unit when unambiguous.

Collection stays within supplied roots. Missing barrels, unsupported conditions, and ambiguous package versions or aliases remain unresolved; the resolver does not fetch packages or invent re-export declarations. Analysis-only context files do not become new matchable function identities.

Whole-file graph syntax handling preserves the matching inventory. JSON and known
non-code assets are retained without JavaScript parsing. TypeScript context uses
strip-only type erasure with original offsets; constructor parameter properties
also supply their implicit instance assignments. Unsupported runtime transforms
remain explicit errors. Svelte script sections use the Svelte compiler parser,
with module/instance scopes separated. Template-generated component behavior is
not modeled and remains diagnosed. These adapters affect graph analysis only,
not the function text passed to embedding or validation models.

`recovery.astBeforeRanking` (default `true`) checks every eligible neighborhood
candidate with the existing AST policy before the embedding top-k cutoff. The first
AST match in source-inventory order is promoted immediately and can support later
targets in the same pass; no embedding or semantic validation is performed for
that target, including when other AST-compatible alternatives might exist. When no AST candidate matches, the
embedding ranking selects up to `recovery.topK` candidates (default `3`) for validation in rank order, stopping at the first acceptance. Queries record the AST selection
stage separately; pre-ranking AST decisions are not embedding top-k observations.
Accepted targets remain settled under the configured allocation policy.

Candidate-policy upgrades require an explicit continuation receipt. They retain
frozen inventories, graph digests, prior accepted mappings, and exact model-response
caches, while reopening unmatched targets. They are incremental experiments,
not fresh runs of a single configuration. Large JSON artifacts use bounded
serialization, compatible streaming checksums, and streamed reads; AST-before-ranking
runs also persist pending in-round proposals approximately every two minutes.
