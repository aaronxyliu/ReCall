# 1. POG features, function anchors, and library identification

## Purpose and high-level method

This component parses JavaScript and extracts a Property-Order Graph (POG) fingerprint for each function using the vendored DEBUN backend. Nested function bodies are excluded from their parent's own-body features. It keeps the full function inventory, including functions below the anchor threshold and functions whose POG cannot be extracted. Failed parsing/extraction remains visible in `diagnostics`.

The same inventory supports two decisions:

1. **Function anchors:** match a fingerprint only when it is unique in the eligible reference pool and unique in a target chunk. A source function can anchor separate copies in different chunks.
2. **Library/version candidates:** for each versioned reference library, count distinct eligible reference functions with matching fingerprints in the captured code. Report `detected: true` when this count reaches `minAnchors`. Multiple copies of one matched function do not count as multiple anchors. All passing versions remain candidates.

This is the requested configurable anchor-count rule. It is **not** a reproduction of DEBUN's complete weighted library/version scoring, and passing a threshold is heuristic evidence rather than a proof of presence. Supplying multiple indistinguishable reference versions can prevent globally unique function anchors. Keep that ambiguity or supply a separately justified version selection.

## Deployment

From the ReCall repository root, use Node.js 24+ and `npm ci`. No models, browser, network access, or source maps are required for these commands once reference files are local.

```sh
node bin/recall.mjs pog extract --manifest examples/minimal/source.json --out outputs/source.json
node bin/recall.mjs pog extract --manifest examples/minimal/bundle.json --out outputs/bundle.json
node bin/recall.mjs pog anchors --source outputs/source.json --bundle outputs/bundle.json --min-features 10 --out outputs/anchors.json
node bin/recall.mjs pog libraries --source outputs/source.json --bundle outputs/bundle.json --min-features 10 --min-anchors 1 --out outputs/libraries.json
```

The example intentionally requires one library anchor; the general default is three. Choose this setting on your configuration-selection data, not from final evaluation labels.

## Manifest and contracts

```json
{
  "roots": ["source"],
  "library": {"name": "example-library", "version": "1.0.0"},
  "files": [{"id": "source-main", "path": "source/main.js"}]
}
```

Paths and allowed roots are relative to the manifest. Per-file `library` can override the manifest library to index several packages/versions; optional `environment` separates execution realms. The JS API also accepts manifest objects with inline `code` for tests. The caller supplies captured JS and downloaded/pinned references; this component does not crawl sites or download npm packages.

- `extractFeatures` -> `recall.inventory/v1`: exact unit code/path/hash, positional function IDs, spans, parent identities, own-body counts, POG hashes, library metadata, and diagnostics.
- `identifyAnchors` -> `recall.anchors/v1`: source/bundle inventory digests, options, accepted pairs, and ambiguous fingerprint counts.
- `identifyLibraries` -> `recall.libraries/v1`: per-library version candidates, distinct matched-anchor count, threshold decision, and evidence.

## Parameters

| JSON/API setting | CLI | Default | Meaning |
|---|---|---:|---|
| `minFeatures` | `--min-features` | 10 | Minimum feature count on both sides |
| `featureMetric` | `--feature-metric` | `propertyOperations` | `propertyOperations` or `graphNodes` |
| `minAnchors` | `--min-anchors` | 3 | Required distinct matching source functions per library/version |
| `uniqueBundle` | JSON config | `true` | Require at least one chunk with a unique fingerprint occurrence for library evidence |

`propertyOperations` counts syntactic own-body property-operation occurrences, **not distinct properties or POG graph nodes**. Repeated reads/writes count repeatedly. Use `graphNodes` explicitly for a node-count threshold. Fingerprint generation itself does not discard smaller functions; thresholds affect identification only.

## JavaScript API and downstream use

```js
import {extractFeatures, identifyAnchors, identifyLibraries} from './components/pog/index.mjs';
const source = extractFeatures('examples/minimal/source.json');
const bundle = extractFeatures('examples/minimal/bundle.json');
const anchors = identifyAnchors(source, bundle, {minFeatures: 10});
const libraries = identifyLibraries(source, bundle, {minAnchors: 1});
```

The bundler identifier, resolver, graph builder, and pipeline consume these same inventories. Artifacts are bound to their exact code and feature inventory through input digests; stale or modified inputs are rejected. See [shared contracts](../../docs/component-contracts.md).

## Shared project and catalog workflow

`createProject()` / `recall project` enumerates syntax and function identities without POG extraction. `addFeatures(project)` adds POGs to that inventory. Identification rejects no inputs silently: only functions with extracted eligible fingerprints can anchor. `catalog build` stores versioned library fingerprints for directory-based recovery; see [quickstart](../../docs/quickstart.md). Every CLI command now accepts the canonical nested configuration from [configuration](../../docs/configuration.md), with POG options under `recovery`.
