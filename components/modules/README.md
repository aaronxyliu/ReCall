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

## Import namespace and cached-export flow

Literal dynamic imports retain a modeled promise rather than treating the promise itself as a module namespace. Fulfilled namespaces flow through `await`, `.then()` callbacks (including destructured parameters), and fulfilled `.catch()`/`.finally()` pass-through. This model is limited to import-derived promises; it does not simulate arbitrary promises or rejection control flow. Dynamic CommonJS imports provide their named exports and default namespace.

Vite's preload helper is recognized through the preload-error protocol, Promise dependency aggregation, and invocation of its loader parameter. The analysis follows that supplied loader's returned import promise. CSS preloads and dependency arrays do not add fetched files or guessed chunk URLs. Destructured Turbopack context parameters preserve loader/export roles and ESM namespace semantics across chunks. Zero-argument cached CommonJS wrappers can expose a returned outer namespace when a captured initialization guard is set and all their own returns identify the same captured value. Local or parameter-dependent return values are not generalized into arbitrary argument/return propagation.

These summaries add function relationships where output code preserves enough value-flow evidence. They do not create module containers for flattened code or introduce relationships merely because functions belong to the same library. Recognition and the resulting function edges survive serialized module-plan replay.

## Parcel factory tables

Parcel table runtimes store `[factory, dependencyMap]` entries and call factories with `(localRequire, module, exports)`. Registration runtimes instead pass `(module, exports)`. Both forms are recognized structurally; the table form requires the loader invocation shape and Parcel runtime marker. Module-local request aliases remain scoped to their own dependency map and registry. Missing targets remain explicit, and disabled imports do not create function targets.

The serialized recognition plan retains factory parameter roles and dependency maps. The solver also models three-parameter export getters, namespace wrapping for CommonJS defaults, and getter-based `exportAll` forwarding. Independent registries and global hosts stay separate. These mechanisms are tested through JSON plan replay.

## Counting module-crossing relationships

Runtime factory boundaries and chunk/file boundaries identify only part of the inter-module relationships in flattened output. The function graph can already contain direct calls and references between original modules even when no emitted module container survives. A zero runtime-boundary count therefore does not imply that the graph contains no original inter-module relationships.

For evaluation, original source-file crossings can be labeled after graph construction from saved source maps. Keep those labels outside inference. Report the graph's code-visible crossings separately from post-hoc original-file crossings, and disclose the source-label coverage and unresolved cases. These counts overlap and must not be summed.

## Independent package references

Use `--references /path/to/packages` with independently acquired, versioned npm
package directories or pinned source checkouts containing `package.json`.
Reference discovery includes JS/TS/TSX implementation files and excludes declaration
files, maps, and nested `node_modules` installations. Supply each intended library
explicitly (or list its files and package root in a source manifest). Each package
is an independent recovery unit, not a dependency to traverse from another library.
The manifest retains `name`, `version`, `main`, `module`, `exports`, and `imports`
from package metadata; this metadata participates in the inventory digest.

Static module relationships use import/export syntax and those package descriptors.
Typed relative imports written with `.js`, `.mjs`, or `.cjs` can resolve to supplied
`.ts`, `.mts`, or `.cts` implementations after checking the literal path. Package-local
`#imports` support exact and wildcard relative targets with import/require/default
conditions. External `#imports` aliases remain unresolved. Package self-imports stay inside the owning package. Imports, reexports, `require`,
and literal dynamic imports of another package remain unresolved in source mode,
even when that dependency is supplied. Relative escapes, external aliases, nested
package boundaries and filesystem symlink escapes are blocked. Package name, version,
root and environment separate library instances. The bundled graph is resolved
without library restrictions; `isolateLibraries: false` also exposes that mode to
standalone module-graph callers.

No source-map URL, mappings, `sources`, or `sourcesContent` is consumed. A source
manifest is caller-supplied data: the tool cannot infer whether its files were
previously extracted from a map. For source-map-independent experiments, obtain both
reference bytes and package/version selection independently; historical dataset
snapshot exports do not meet that provenance requirement. New dataset exports require
`--references INDEPENDENT_PACKAGE_DIRECTORY` and never copy reference snapshots. Existing experiments
are not migrated or reinterpreted by this resolver update.
