# Optional page capture

Input acquisition is separate from the fixed-dataset recovery experiment.

### Capture from a webpage with page-fetch

Use [Detectify/page-fetch](https://github.com/detectify/page-fetch) to visit a URL in Chrome/Chromium and save network response bodies. ReCall's **offline capture importer** converts those files into a bundle manifest, preserving script bytes, original URLs, and query variants.

<details>
<summary><strong>Install the tested page-fetch version</strong></summary>

Install Go and Chrome/Chromium, then run from the ReCall checkout:

```sh
git clone https://github.com/detectify/page-fetch.git outputs/tools/page-fetch
git -C outputs/tools/page-fetch checkout 5d8639a4044a41b24b316452f72e123f192c5238
go -C outputs/tools/page-fetch build -mod=mod -o page-fetch .
```

This builds the upstream capture tool without changing its capture logic. `-mod=mod` lets Go update module bookkeeping in that external checkout. If you already have `page-fetch`, use that executable in the next command. Generated captures and downloaded tools stay under Git-ignored `outputs/`.

</details>

**1. Capture a URL.** Replace the example with your target. Use a fresh output directory per page/session and keep third-party resources, including CDN libraries.

```sh
printf '%s\n' 'https://lodash.com/' |
  outputs/tools/page-fetch/page-fetch --concurrency 1 --delay 1500 \
    --output outputs/captures/site-raw
```

**2. Import the saved responses.** Keep the `.meta` sidecars: they identify JavaScript even when filenames have no extension or end in a suffix such as `.js.1`.

```sh
node bin/recall.mjs capture import-page-fetch outputs/captures/site-raw \
  --out outputs/captures/site-input
```

This writes `bundle.json`, `capture.json` (URLs, hashes, and diagnostics), and unchanged JavaScript bodies under `files/`. If one raw directory contains several seed URLs, add `--page-url 'https://your-site.example/page'` to select one. Conflicting bodies for the same URL require a fresh capture.

**3. Prepare recovery.** Supply reference packages and a configuration as described below:

```sh
cp examples/recall.config.json recall.json

node bin/recall.mjs run \
  --bundle-manifest outputs/captures/site-input/bundle.json \
  --references ./reference-packages \
  --config recall.json --prepare-only --out outputs/site
```

You can substitute `--catalog ./library-catalog.json` for `--references`. To continue with the configured models, repeat the command with `--resume` instead of `--prepare-only`. Use the generated **manifest**, rather than passing `files/` to directory discovery, so extensionless scripts and URL aliases are retained.

The delay captures some automatically requested late resources; it does not enumerate every lazy chunk. The tested upstream collector has a ten-second per-page timeout, and this adapter does not extract inline scripts or infer separate iframe/worker realms. Inspect capture logs, `capture.json`, and ReCall parse diagnostics. See the [capture guide](../components/capture/README.md) for input handling, resolution boundaries, and troubleshooting.
