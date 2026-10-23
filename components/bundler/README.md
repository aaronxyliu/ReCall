# 2. Bundler identifier

## Purpose and high-level method

The identifier examines AST structure and lexical bindings to recognize module registrations and loader protocols. It reuses structural runtime patterns without running the bundle or solving the function graph. Outputs retain per-unit evidence, candidate families, uncertainty, and recognition errors.

Supported family labels are webpack, Rspack, esbuild, Rollup, Rolldown, Turbopack, and Parcel. A label is not always uniquely inferable:

- Webpack-compatible factory tables may be emitted by either webpack or Rspack.
- ESM links and generic CommonJS/getter helpers can be compatible with esbuild, Rollup, or Rolldown.
- Unmarked flattened code may provide no reliable evidence; it remains `unknown`.
- Turbopack and Parcel registrations can provide more specific protocol evidence.

Generic helper-shape evidence is deliberately weak and may also occur in application code. It does not establish a particular bundler. The result is `identified`, `ambiguous`, or `unknown`; an optional explicit hint is `user-specified`. A hint never changes code evidence into an inferred fact, nor forces the resolver to apply a protocol absent from the code.

## Deployment

Install the root package with Node.js 24+ and `npm ci`. This component needs no models or network.

```sh
node bin/recall.mjs pog extract --manifest examples/minimal/bundle.json --out outputs/bundle.json
node bin/recall.mjs bundler --inventory outputs/bundle.json --out outputs/bundler.json
```

If a build configuration independently identifies the backend:

```sh
node bin/recall.mjs bundler --inventory outputs/bundle.json --hint rspack --out outputs/bundler-with-hint.json
```

The minimal example deliberately produces a webpack/Rspack-compatible ambiguous result.

## Contract and parameters

Input: `recall.inventory/v1` from the POG component. Output: `recall.bundler/v1`, containing `inputDigest`, `family` (possibly null), `candidates`, `status`, `hint`, and `units[].evidence`/`diagnostics`.

The API is `identifyBundler(inventory, {hint: null})`. CLI `--hint` accepts one of the seven family names. `--config` can provide `{ "bundler": {"hint": "rspack"} }`; an explicit CLI hint takes precedence. Existing output files are protected unless `--overwrite` is supplied.

```js
import {identifyBundler} from './components/bundler/index.mjs';
const result = identifyBundler(inventory);
```

Pass the result to the module resolver for provenance. Unknown/ambiguous family labels do not block mechanism-based module resolution. The resolver still inspects the actual registration, loading, and export operations. See [module resolver](../modules/README.md).

## Inspect without generating POGs

```sh
node bin/recall.mjs bundler --directory examples/minimal/bundle --out outputs/bundler-direct.json
```

This builds only a syntax inventory. `--inventory` also accepts a shared syntax-only project from `recall project`; POG extraction is not required. Canonical configuration uses the `bundler` section. See [adapter development](../../docs/adapters.md).
