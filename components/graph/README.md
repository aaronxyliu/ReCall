# 4. Function relationship graph builder

## Purpose and high-level method

The graph builder creates the neighborhoods used by recovery, independently of ranking and validation. It offers two explicit modes:

- **Local:** no module map is supplied. Resolve lexical calls/function arguments within each file, then optionally add containment and nearby sibling edges.
- **Module-aware:** consume a compatible saved module plan and resolve function values through imports, module exports, getters, helper summaries, and inter-chunk links. Add the same containment/proximity relationships afterward.

Both return the same graph schema, so the pipeline does not need bundler-specific search logic. Relationships are deliberately broad candidate edges, not identity certificates or a precise/sound JavaScript call graph. Graph construction invokes no models and reads no source maps.

## Deployment and invocation

Use Node.js 24+ and `npm ci` from the ReCall root.

```sh
# Local graph: module resolution is absent.
node bin/recall.mjs graph --inventory outputs/bundle.json --out outputs/bundle-local.json

# More complete graph: consume the module resolver's artifact.
node bin/recall.mjs graph --inventory outputs/bundle.json --module-map outputs/bundle-modules.json --out outputs/bundle-graph.json
```

Build the source graph in the same way from `source.json` and its optional module map. Both sides need corresponding relationships for a match to propagate across an import/module boundary.

`--config graph-config.json` accepts:

```json
{"graph":{"siblingWindow": 2, "includeContainment": true}}
```

`siblingWindow: 0` disables source-order proximity. Containment links enclosing/nested definitions. Proximity groups are scoped to an immediate parent **and input unit**, so unrelated top-level files do not become siblings. Use the same settings across local/module-aware ablations. In the full pipeline configuration, `graph.useModules: false` skips module resolution on both sides.

## Contract and API

Input: `recall.inventory/v1` and optionally `recall.modules/v1`. Module plans must match the exact inventory, context code, and engine version; modified/stale maps fail validation.

Output: `recall.graph/v1` with function IDs/spans, typed directed edges, `inputDigest`, `graphDigest`, selected mode/settings, and diagnostics. The recovery pipeline traverses their undirected projection and applies the configurable neighborhood radius. Graph radius is therefore a pipeline search parameter, distinct from `siblingWindow`.

```js
import {buildGraph} from './components/graph/index.mjs';
const local = buildGraph(inventory, {siblingWindow: 2});
const extended = buildGraph(inventory, {moduleMap, siblingWindow: 2});
```

Serialized graphs can be passed directly to the [pipeline](../pipeline/README.md). Changed edges, incompatible inventory digests, and unknown function identities are rejected before model use.

Integrated execution reuses the resolver's solved relationships; serialized standalone execution replays the same plan. These paths are tested for matching edges. Graph inputs may be shared syntax-only projects; POG features are needed for identification, not graph construction. All CLI settings use the canonical `graph` section.
