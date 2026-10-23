# Minimal integration example

The reference library has two files: an anchor containing ten own-body property operations and a small imported helper below the anchor threshold. The delivered fixture embeds them in a webpack-compatible module registry with renamed bindings.

With proximity and containment disabled, local lexical graphs do not connect the imported helper on both sides. Module-aware graphs resolve the source import and bundled loader/export relationship. One accepted anchor can then expose the helper to ranking and validation. The component integration test verifies this distinction using a deterministic fake provider; it does not invoke a model or claim a model recovery rate.

From the repository root:

```sh
node bin/recall.mjs run --source-manifest examples/minimal/source.json --bundle-manifest examples/minimal/bundle.json --config examples/minimal/config.json --prepare-only --out outputs/minimal-prepared
```

Inspect `anchors.json`, `libraries.json`, `bundleBundler.json`, the two module maps, and the two graphs. The bundler result is deliberately ambiguous between webpack and Rspack because the fixture supplies a compatible registry, not uniquely identifying build metadata. Required library anchors are one only because this tiny fixture contains one eligible anchor.

The source folder now includes a package.json for automatic reference discovery. See the root quickstart for `recover examples/minimal/bundle --references examples/minimal/source`. Use `--resume` to continue a compatible prepared run; all commands share nested configuration.
