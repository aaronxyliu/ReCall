# BundleGraph v2

A code-only static module and function relationship analyzer for webpack-compatible runtimes, Rolldown lazy factories, Turbopack contexts, Parcel loaders, and flattened/native-ESM output. It supplies relationship edges to the existing neighborhood propagation algorithm. There are no model clients, source-map matching, library-name predictions or bundle execution in extraction.

The adapters target runtime calling conventions and export operations. Repository names, library names, local variable spelling and chunk hashes are not recognition rules.

## Run on another build

Supply the emitted JavaScript files for one build, including entry, runtime, shared and lazy chunks. A build asset manifest is preferable to selecting files by whether they contain target libraries.

```json
{
  "roots": ["dist"],
  "files": [
    {"path":"dist/main.js", "environment":"browser"},
    {"path":"dist/vendor.js", "environment":"browser"},
    {"path":"dist/runtime.js", "environment":"browser"},
    {"path":"dist/worker.js", "environment":"worker"}
  ]
}
```

Paths are relative to the manifest. Use distinct `environment` values for different workers, browser/server realms or independent runtimes. Do not combine independently compiled applications with overlapping module IDs into one environment. Explicitly supply chunks loaded through computed webpack runtime filenames: static dependency collection does not evaluate arbitrary chunk filename generators.

```sh
node --expose-gc --max-old-space-size=8192 \
  scripts/real-app/bundle-graph-v2/analyze.mjs manifest.json relationships.json
```

The collector follows relative ESM imports/reexports, literal dynamic imports, local CommonJS requests, and JavaScript module URLs within allowed roots. Literal `new Worker(new URL(..., import.meta.url))` dependencies receive a worker environment. Other worker entry conventions require manifest annotations. Missing files, external/bare specifiers, computed imports and outside-root requests remain explicit diagnostics. The collector never fetches code or uses source maps. A manifest containing only an entry script is insufficient when its loader constructs chunk names dynamically.

The output contains function IDs/spans, directed relationship edges with kinds, module registrations, static module/chunk dependencies, context provenance and SHA-256 hashes, unresolved dependencies, parser failures, convergence and bounded-analysis counters. This is a partial static graph; convergence does not establish completeness or precision.

## Architecture

```text
emitted artifact manifest and execution environments
                  |
          dependency context collection
                  |
          AST + lexical binding normalization
                  |
      runtime mechanism adapters / module operations
                  |
        indexed, bounded value-flow worklists
                  |
       module graph + function relationship graph
                  |
     existing paired-neighborhood propagation
```

`recognize.mjs` handles runtime structure. `context.mjs` handles artifact context. `analyzer.mjs` compiles one file at a time into value constraints and solves them across the supplied build. `module-graph.mjs` exports an inspectable dependency graph and indexes lazy modules by key. The evaluation driver is separate and is the only stage that reads the frozen oracle and seeds.

### Normalized operations

The adapters normalize module registration, loader identity, import-by-ID, module/exports/require factory roles, native chunk imports, export getters and namespace/default interop. Shared function values, static object fields, class members, IIFE results and small ordinary return summaries resolve calls and references. Ordinary summaries cover direct parameter returns, constant member paths from parameters and direct function/class value returns; they do not perform unbounded context-insensitive argument propagation.

- **webpack/Rspack:** structurally identify cache/table loader invocations with module/exports/require roles; decode object or sparse array tables; bind IIFE tables and aliases; detect legacy JSONP, array-push and exported CommonJS/ESM chunk tables. Registry paths use AST bindings and normalize dot/bracket syntax and custom globals. Installer table writes associate a main loader with its pushed registry. Exported-table formats use an execution-environment/runtime-group namespace; keep independent builds partitioned. Webpack export helpers support getter maps and the older `(exports, name, getter)` form.
- **Rolldown:** use native ESM links and structurally recognized lazy CJS helpers, with a fresh module/exports record per factory. Helper recognition checks callback binding and module allocation roles. Export getter helpers distinguish a fresh returned namespace from an existing destination object. Imported runtime-only helpers are context even when they are not matchable targets.
- **Turbopack:** resolve global context registrations, merged IDs and aliased factory expressions; model context/module/exports roles, CJS require, namespace imports, getter/direct-value export arrays, setters and explicit export IDs.
- **Parcel:** follow the actual lexical loader's `parcelRequire*` global identity and direct or aliased registration operations. Independent loaders in a file remain separate. Scope-hoisted lexical/ESM code uses the shared resolver.
- **esbuild/Rollup:** flattened lexical bindings and ESM chunks use the shared resolver. The same CJS/getter adapters cover tested helper forms; removed original module boundaries are not reconstructed or invented.

Both lexical aliases and global registry paths use bounded worklists. Recursive alias expansion is avoided. Registry paths that become ambiguous abstain. The shared value limit is 64; overflow widens to `TOP`. Helper recognition has a 512-AST-node inspection budget, independent of whitespace/comment length. A 50-million event budget fails explicitly. These bounds do not prove linear-time behavior, soundness or completeness.

Native Object/Reflect operations keep opaque native alternatives. A conditional `Object.keys` fallback cannot become a definite cross-library call target. Unknown/ambiguous calls are not guessed. No module-membership cliques, extra POG seeds or source/bundle initialization-function matching are added.

## D-Bundlr relationship

D-Bundlr's analyzer (§3.2) identifies main loaders and sub-chunk module maps using runtime signatures, then binds module/exports/require objects to wrapper parameters and continues lightweight pointer analysis. V2 adopts this analyzer organization and constant-ID lookup idea, extending normalized operations to other runtime families. It does not reproduce the paper's complete library predictor, sandbox validation, rewriting pipeline or downstream CodeQL evaluation.

- [Paper](https://reallytg.github.io/files/papers/debundling_icse.pdf)
- [Authors' artifact](https://github.com/Anemone95/D-Bundlr), previously inspected commit `c28a5d62efeecc46cc146c3548c71b8071ba2e89`
- The original author patterns are used as a recognition-count comparator for the pinned webpack 1/3 chunks, not imported as the v2 solver.

## Reproduce validation and frozen-target evaluation

```sh
node --test scripts/real-app/bundle-graph-v2/*.test.mjs
node scripts/real-app/bundle-graph-v2/mutations.mjs
node scripts/real-app/bundle-graph-v2/webpack-matrix.mjs
node scripts/real-app/bundle-graph-v2/esm-matrix.mjs
node scripts/real-app/bundle-graph-v2/legacy-corpus.mjs
python3 scripts/real-app/bundle-graph-v2/run-scale.py
python3 scripts/real-app/bundle-graph-v2/run-extraction.py
node --max-old-space-size=8192 scripts/real-app/bundle-graph-v2/evaluate.mjs REPO_SLUG
python3 scripts/real-app/bundle-graph-v2/report.py
```

Completed build matrices and extraction/evaluation files refuse overwriting. Preserve completed results and choose a new versioned destination before intentionally rerunning changed code.

The experiment reads the frozen baseline and retains exactly the same source/bundle function inventory, supported target pairs, seeds, sibling window, size limit and uniqueness policy. Saved non-target artifacts and dependency closure add context with an empty matchable inventory. They supply semantics, not targets or anchors. Cross-chunk propagation remains separate from per-chunk propagation. The source-map oracle is used only for evaluation after extraction. Reported rates are supported-pair connectivity with oracle candidate selection, not measured model recovery or whole-library recall.

## Established limits

Current validation covers pinned real emitted formats, targeted mutations, synthetic chains and small real rebuild matrices. It does not establish an ecosystem-wide success percentage. HMR/development wrappers, module federation, unusual plugin wrappers, property-mangled runtimes, arbitrary dynamic filenames/proxies and full higher-order/async JavaScript semantics remain unvalidated or unresolved. Source TS/TSX parse gaps in the frozen experiment are unchanged. Precision requires additional independent edge auditing; high oracle connectivity alone cannot establish it.
