# Component contracts and execution order

```text
Captured JS manifest + local versioned reference manifest
                     |
                 POG extraction
                     |
             source / bundle inventories
              /          |            \
      anchors +       bundler       module resolver
    library candidates identifier         |
              \          |          serialized plan
               \         |               |
                \        +------> relationship graphs
                 \                       |
                  +-------> ranking + T/F validation
                                         |
                                 partial function mapping
```

All components are deployable as commands of one installed Node package and callable as independent ES modules. They are logical/API boundaries, not five network services. No component requires the experiment or dataset Git repositories. Captured files can be discovered from a directory. References can be supplied explicitly or obtained from npm after matching a supplied fingerprint catalog.

| Artifact schema | Producer | Consumers |
|---|---|---|
| `recall.capture-input/v1` | page-fetch import adapter | Manifest loader / POG extraction |
| `recall.page-fetch-import/v1` | page-fetch import adapter | Capture provenance and diagnostics |
| `recall.inventory/v1` | POG extraction | All other components |
| `recall.anchors/v1` | POG identifier | Recovery |
| `recall.libraries/v1` | POG identifier | Optional recovery library gate |
| `recall.bundler/v1` | Bundler identifier | Optional resolver provenance |
| `recall.modules/v1` | Module resolver | Module-aware graph builder |
| `recall.graph/v1` | Graph builder | Recovery |
| `recall.recovery/v1` | Recovery pipeline | Caller/downstream analysis/evaluation |

Function identity is a positional ID within an input unit. Source and bundle functions never align by array order. Unit IDs are stable within the saved artifacts; callers should supply unique IDs in manifests. Package/version metadata describes reference candidates and never labels a bundled function by itself.

Capture manifests optionally supply `aliasPaths`, resolved relative to the manifest, to preserve exact query-bearing module paths while keeping URL variants distinct. The loader retains these aliases, and inventory digests bind them together with unit paths, environments, runtime grouping, code bytes, and function feature/identity records. The capture report retains original URLs and response hashes; raw request headers stay outside inference artifacts. Module plans also bind context code and engine version; graph digests bind edges and settings. Handoffs reject incompatible inputs before model calls. Schemas are versioned internal JSON contracts, not a formal compatibility promise for arbitrary future versions.

Saved plans contain exact code as analysis context. Protect them as you protect captured scripts, and keep generated inventories/plans/model caches under ignored output directories. No source maps or ground-truth pairs belong in these inference artifacts. Source-map evaluation remains a separate experiment concern.

Module-aware construction uses shared bounded value-flow results directly in integrated execution. Across independent processes, the resolver saves a registration/loader plan and the graph builder replays it to solve function values. Both paths are tested for matching edges. Syntax-only `createProject` inventories need no POGs; the POG component adds features before identification. Public components depend on `src`, not historical experiment scripts.

Additional contracts are `recall.catalog/v1`, `recall.catalog-selection/v1`, `recall.module-ir/v1`, `recall.preflight/v1`, `recall.run/v1`, `recall.summary/v1`, and `recall.function-mapping/v1`. These are versioned internal contracts. Inventory schemas retain exact paths/context: complete run directories are tied to those paths for resume; they are not fully relocatable project archives. A catalog can fall back to exact npm retrieval when its local reference locations are unavailable.
