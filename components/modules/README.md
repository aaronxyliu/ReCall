# 3. Module-map resolver

## Purpose and high-level method

This component translates bundled module mechanisms into a common module/chunk map. It collects supplied runtime/shared context, binds factory parameter roles, resolves constant-ID loads and imports, and models exports, getters, namespaces, and lazy CommonJS helpers through bounded value propagation.

It handles webpack/Rspack-compatible factory tables and chunk registrations; native ESM and flattened esbuild/Rollup code; Rolldown-style lazy factories and interop helpers; Turbopack context operations; and Parcel scoped loaders. Dispatch follows structural mechanisms, not application names or an assumed exact bundler version. Removed original module boundaries are not invented for flattened output.

The result includes a **serialized recognition plan** tied to exact code and engine hashes. The graph builder can consume that plan without re-running registration recognition. Standalone JSON replay still runs shared value-flow analysis to resolve function relationships: recognizing a module ID alone does not identify its exported function values. This explicit artifact boundary allows separate execution and inspection; integrated execution reuses solved state in memory, while separate commands replay the saved plan.

## Deployment and invocation

Use Node.js 24+ and `npm ci` in the ReCall root. No model endpoint, source maps, package database, or bundle execution is required.

```sh
node bin/recall.mjs modules --inventory outputs/bundle.json --bundler outputs/bundler.json --out outputs/bundle-modules.json
```

The bundler artifact is optional. It must describe the same input inventory. Its family label is advisory; ambiguity is retained while compatible structural adapters resolve real operations.

To change analysis limits, pass `--config recall.json` with a `modules` section:

```json
{"modules": {
  "followDependencies": true,
  "valueLimit": 64,
  "eventLimit": 50000000,
  "maxFiles": 20000,
  "maxBytes": 1073741824
}}
```

These are the defaults. File and byte limits bound context collection; the event limit bounds solving. An exhausted hard budget fails explicitly, rather than claiming a complete result. The value-set limit widens difficult values to an unknown abstraction and can reduce resolved edges.

## Input scope and output contract

Input: `recall.inventory/v1`, whose manifest roots bound filesystem dependency collection. Relative ESM imports/reexports, literal dynamic imports, local CommonJS requests, and supported module URLs can supply context. Computed chunk names require explicit supplied files. Bare packages, missing files, and outside-root dependencies remain diagnosed. Source and bundle manifests must keep independent realms separate using `environment`.

Output: `recall.modules/v1` with:

- `inputDigest`, `engineDigest`, and `planDigest` for compatible handoffs;
- exact `units`, including context-only units with no additional matchable function IDs;
- per-unit `plans` for registrations and loader roles;
- `moduleGraph.modules` and `moduleGraph.dependencies`;
- analysis options, diagnostics, coverage, and collected dependency records.

Explicit input files retain separate identities even if their code bytes are equal. Context collection does not add source-map labels, initialization-function matches, or a clique among all functions in a module. Module IDs are scoped to registries/environments.

## JavaScript API

```js
import {resolveModules} from './components/modules/index.mjs';
const moduleMap = resolveModules(inventory, {bundler: identification, followDependencies: true});
```

See [graph builder](../graph/README.md) to use or omit this result, and [engine boundary](../../src/engine/README.md) for implementation organization.

`moduleGraph` now carries `recall.module-ir/v1` with resolved exports and ESM bindings alongside modules and dependencies. See [adapter contract](../../docs/adapters.md) and [canonical configuration](../../docs/configuration.md).
