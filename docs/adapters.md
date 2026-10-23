# Extend module recognition

ReCall follows runtime mechanisms rather than repository names. `src/engine/adapters` contains webpack-compatible bootstrap/chunk tables, Turbopack context registrations, Parcel loader registrations, and shared CJS/ESM/export-helper modeling used by esbuild, Rollup, and Rolldown. Native ESM syntax is handled by the common analyzer. Erased module boundaries in flattened code are not reconstructed speculatively.

## Recognition adapter contract

An adapter exports `{id, families, apply(context)}`. Register it in `runtimeAdapters` in `src/engine/recognize.mjs`. `recognition-context.mjs` supplies parsed nodes, lexical binding identities, aliases, constant-ID helpers, registry namespaces, and evidence collectors. The adapter must use these structural identities rather than application-specific names.

Append registrations of this form:

```js
context.registrations.push({
  kind: 'webpack',                 // existing runtime semantics
  namespace: 'registry:main:...',  // scoped execution/registry identity
  id: '17',                       // constant module ID, normalized to a string
  node: factoryFunctionNode,
  mechanism: 'new-supported-table-form'
});
```

Loaders use `{namespace,requireNode,mechanism}`; Parcel loaders use `{namespace,node}`. The analyzer serializes AST identities as exact source spans for independent replay. `validateRecognition()` rejects malformed output. New syntax for an existing protocol can reuse its semantics. A genuinely new loader/export protocol also needs value-flow semantics in the shared engine; the adapter interface does not magically model arbitrary JavaScript runtimes.

Shared lazy-CJS and export/getter helper summaries live in `adapters/helpers.mjs`. They are intentionally shared across bundler brands with equivalent emitted mechanisms. They run against the common solver rather than emitting fictional module registrations for every flattened helper.

## Common representation

`recall.modules/v1` contains replayable registration/loader plans and `moduleGraph` with schema `recall.module-ir/v1`:

- `modules`: scoped module identities and factory locations;
- `dependencies`: runtime loads, ESM imports/reexports, and lazy CJS references;
- `exports`: modeled exported names and function targets;
- `bindings`: ESM binding requests and resolved function targets.

Exports/bindings retain only relationships statically resolved by the engine. This is a partial representation, not a complete module reconstruction guarantee. Missing targets remain visible in dependency status and diagnostics. The graph builder consumes this representation/plan and shared value-flow results; neighborhood recovery contains no bundler-specific search rules.

## Required tests

Add synthetic fixtures covering normal and renamed bindings, cross-unit relationships, independent runtime scopes, unresolved IDs, serialization/replay, and the new syntax form. Assert that module-aware function edges survive a JSON handoff and that in-memory reuse gives the same edges. Run `npm test`. Existing fixtures cover webpack-compatible/Rspack, Turbopack, Parcel, Rolldown helper, and native ESM cases. These tests check mechanisms; they do not establish generalization to every bundler release.

Engine fingerprints include all analysis/adapter source files, so changed adapters invalidate saved module maps and run checkpoints. Keep historical experiment files under `scripts/` unchanged when extending public runtime code.
