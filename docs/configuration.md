# One configuration for every command

Every CLI command accepts the same **nested** configuration object. It reads the relevant section and validates all sections. Unknown settings and invalid types fail before analysis; old flat component configuration files must be migrated. Copy `examples/recall.config.json` as a starting point.

Precedence is built-in defaults → configuration file → explicit CLI overrides. Configuration paths are relative to the configuration file. CLI paths are relative to the current working directory. Runs save every resolved default and override in `resolved-config.json`; standalone component commands save `OUTPUT.config.json` beside their artifact. Library gating defaults to **true** for both integrated and standalone recovery; explicitly set `recovery.libraryGate:false` when references are already selected and gating is intentionally omitted.

| Section | Main settings and defaults |
|---|---|
| `inputs` | `references:null`, `catalog:null`, `cacheDir:null`, `registry:"https://registry.npmjs.org"`, `offline:false`, `timeoutMs:300000`, `maxFiles:20000`, `maxBytes:1073741824` |
| `recovery` | `minFeatures:10`, `featureMetric:"propertyOperations"`, `minAnchors:3`, `uniqueBundle:true`, `libraryGate:true`, `topK:5`, `radius:1`, `crossChunk:false`, `minSimilarity:-1`, `sourceRepresentation:"minified"`, `maxCodeCharacters:18000`, `maxRounds:1000`, `maxValidationCalls:null` |
| `models` | `endpoint:"http://127.0.0.1:11434"`, `embeddingModel:"qwen3-embedding:0.6b"`, `validationModel:"qwen3.5:27b"`, `thinking:false`, `temperature:0`, `seed:42`, `numCtx:16384`, `numPredict:384`, `embeddingBatch:12`, `timeoutMs:300000`, `keepAlive:"60m"`, `cacheDir:null`, `systemPrompt:null` |
| `graph` | `useModules:true`, `siblingWindow:2`, `includeContainment:true` |
| `modules` | `followDependencies:true`, `valueLimit:64`, `eventLimit:50000000`, `maxFiles:20000`, `maxBytes:1073741824` |
| `bundler` | `hint:null` |
| `execution` | `progress:true` |

`inputs` limits bound directory discovery and npm unpacking. `modules` limits independently bound graph context and solving. Byte/file limits do not substitute for a process memory limit. `valueLimit` can widen difficult value sets to unknown, reducing resolved relationships. `maxValidationCalls` counts logical candidate checks, including cached HTTP responses; a checkpoint can reuse already recorded candidate verdicts without counting them again. `radius` controls graph hops; `siblingWindow` controls source-order proximity. They are different parameters.

CLI recovery overrides: `--top-k`, `--radius`, `--min-features`, `--feature-metric`, `--min-anchors`, `--embedding-model`, `--validation-model`, `--endpoint`, `--thinking true|false`, `--cross-chunk true|false`, `--library-gate true|false`, `--max-validation-calls`, and `--cache`. `--references`, `--catalog`, `--offline`, and `--quiet` control the workflow. Other settings belong in JSON.

`systemPrompt:null` selects the preserved validator prompt. An explicit string defines a different configuration and cannot reuse incompatible cache entries. Caches are keyed by exact requests, endpoint, model digest, and options. Defaults do not establish an optimal scientific configuration; configuration tradeoffs remain an empirical question.

Standalone example:

```json
{"graph":{"siblingWindow":0,"includeContainment":false}}
```

```sh
node bin/recall.mjs graph --inventory bundle.json --module-map modules.json --config recall.json --out graph.json
```

The JavaScript high-level APIs `runDirectory`, `preparePipeline`, and `runPipeline` use this canonical configuration. Low-level APIs such as `identifyAnchors(inventory,bundle,options)` and `recoverFunctions({config:{...recoveryOptions,models}})` retain explicit component options for library integration; see component guides. `normalizeConfig()` exposes the canonical validator/default resolver.
