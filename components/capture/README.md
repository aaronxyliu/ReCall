# Webpage capture adapter

ReCall reuses [Detectify/page-fetch](https://github.com/detectify/page-fetch) for browser capture. This component imports the saved response bodies into an explicit ReCall bundle manifest. It runs offline, invokes no models, and does not implement a browser or crawler.

## Capture and import

From the ReCall checkout, with Go and Chrome/Chromium installed:

```sh
git clone https://github.com/detectify/page-fetch.git outputs/tools/page-fetch
git -C outputs/tools/page-fetch checkout 5d8639a4044a41b24b316452f72e123f192c5238
go -C outputs/tools/page-fetch build -mod=mod -o page-fetch .

printf '%s\n' 'https://lodash.com/' |
  outputs/tools/page-fetch/page-fetch --concurrency 1 --delay 1500 \
    --output outputs/captures/site-raw

node bin/recall.mjs capture import-page-fetch outputs/captures/site-raw \
  --out outputs/captures/site-input
```

The pinned upstream source is the version tested for this integration. `-mod=mod` permits Go module bookkeeping updates in that external checkout; no upstream capture logic is patched. An existing `page-fetch` installation can be used instead of the local executable. Use a fresh raw directory for each page/session, and retain third-party responses: CDN scripts often contain the target libraries. Capture all resource types so JavaScript is not lost through MIME filtering; the importer selects JavaScript afterward.

`page-fetch` writes response bodies with matching `.meta` sidecars. The importer reads the sidecar's URL, parent seed URL, resource type, and response content type. It includes `Script` resources or JavaScript MIME responses, skips obvious HTML/JSON responses, and excludes unrelated assets. Selection does not depend on a `.js` suffix.

## Run ReCall

Prepare your versioned reference packages and configuration as described in the [main README](../../README.md#usage), then run:

```sh
node bin/recall.mjs run \
  --bundle-manifest outputs/captures/site-input/bundle.json \
  --references ./reference-packages \
  --config recall.json --prepare-only --out outputs/site
```

For catalog identification, replace `--references ./reference-packages` with `--catalog ./library-catalog.json`. After preparation, repeat the command with `--resume` instead of `--prepare-only` to run model-based recovery using the same inputs and settings. `--prepare-only` creates static artifacts and `status.json`, rather than a final recovered-function mapping.

Always use `bundle.json` for imported captures. Generic directory discovery can omit extensionless resources and does not carry the manifest's URL aliases and runtime grouping.

## Output and identity policy

```text
site-input/
├── bundle.json           # Input for recall run --bundle-manifest
├── capture.json          # URLs, hashes, selection diagnostics, capture scope
├── resolved-config.json  # Written by the CLI
└── files/                # Exact response bodies, grouped by URL origin
```

Bodies are copied byte for byte. Ordinary URL directory structure is retained to support relative ESM imports. Original URLs, including query strings, remain in `capture.json`. Query variants get separate identities and exact path aliases; the adapter does not arbitrarily choose one when an unqualified URL is ambiguous. Identical responses for the same URL are deduplicated; different bodies for the same URL fail import and require a fresh capture. Copies at different URLs remain separate inputs. No source rewriting, beautification, or source-map lookup is performed.

If a raw directory contains several seed pages, select one explicitly:

```sh
node bin/recall.mjs capture import-page-fetch outputs/captures/raw \
  --page-url 'https://example.org/page' --out outputs/captures/page-input
```

Output directories must be new and outside the raw capture tree. Symlinks are skipped. `inputs.maxFiles` bounds metadata records and `inputs.maxBytes` bounds inspected metadata plus selected JavaScript bodies. Configuration is passed using `--config`; no network requests are made by the importer.

## Capture boundaries

- The tested upstream collector has a fixed ten-second per-page context timeout. `--delay 1500` keeps the context alive briefly after navigation; it does not guarantee capture of later activity and cannot extend that timeout.
- Delayed imports are included when requested during this window. Chunks that are never requested remain absent. Recursive **automatic lazy-loading code extraction** is a [roadmap TODO](../../README.md#roadmap).
- `page-fetch` saves network response bodies. This adapter does not extract inline scripts from HTML or reconstruct `eval`/`blob` code.
- Metadata identifies the input seed URL, not each frame or worker realm. One import groups the page's scripts together and reports this limitation in `capture.json`; curate manifest environments when independent realms are present. Browser-resource type and MIME alone do not identify each script's execution realm.
- Relative module paths and exact query aliases are supported. Absolute-URL, root-relative, import-map, and runtime-computed module specifiers still depend on the analyzer's resolution capabilities; normalization does not guarantee those edges.
- The upstream `.meta` format does not record HTTP status. Inspect capture logs and ReCall parse diagnostics rather than treating every saved body as a successfully loaded module. Upstream browser errors can appear despite a zero exit code.
- Keep raw `.meta` files local: they can contain request headers. The normalized provenance report records selected fields and hashes, without copying cookies or authorization headers.

## API and validation

```js
import {importPageFetch} from './components/capture/index.mjs';
const result = importPageFetch('./raw', {output: './prepared-input'});
console.log(result.manifest, result.importedScripts);
```

`parsePageFetchMetadata(text)` is also exported. The importer returns its report plus the absolute manifest path. See the [validation record](../../docs/page-fetch-validation.json): a real browser fixture reaches `prepared` with one POG anchor and zero model calls; a public-site capture imports six scripts and parses 3,848 functions in the recorded session. Public-site counts can change. `npm test` exercises saved-response fixtures and does not require Go, Chrome, page-fetch, or external network access.
