# Runtime mechanisms and the shared graph model

## What the tool recovers

The output describes static module/import/export relationships and function relationships in the supplied code. A bundled module ID is scoped to an execution environment and its registry or runtime group. It is not a library identity. Flattened code need not have a recoverable original module boundary; its lexical function relationships can still be used.

The shared abstract state contains value slots, function/class tokens, allocation-site objects with property slots, module records and export namespaces. Runtime adapters introduce these same objects and constraints for different generated calling conventions.

| Mechanism | Factory argument convention | Import result |
|---|---|---|
| webpack/Rspack table entry | module, exports, require | selected module record's exports slot |
| Rolldown lazy CJS callback | exports, module, optional exports | a memoized thunk whose call reads the module exports slot |
| Turbopack factory | context, module, exports | context require reads exports; namespace import applies modeled interop |
| Parcel registered factory | module, exports | the lexical loader's registry entry exports slot |
| Native ESM | lexical imports and exports | export-property or namespace slots in the resolved file |

These differences are captured by adapters, not copied into the propagation algorithm.

## Runtime recognition and normalization

A webpack-style main loader is recognized from an indexed factory-table call with consistent module/exports/require roles, including `.call` receivers and cached-module member expressions. Object and sparse-array tables preserve IDs. Immediate bootstrap arguments, declarations and lexical aliases locate the actual table. Factories and registries may be aliased.

For pushed chunks, the table's CJS/export-helper operations establish its role. The registry address is normalized from AST members and lexical aliases. A dot access, bracket access, renamed global property or changed local variable does not require a new repository rule. Legacy JSONP and exported CommonJS/ESM tables have separate normalized entry forms. Installer writes to the main table associate pushed chunks with the main loader. Exported-table formats share a supplied runtime group.

Both lexical alias sets and global-address paths reach fixed points through dependency-indexed worklists. Global paths use a single address or an ambiguous state. This prevents repeated recursive traversal of equivalent alias branches. Recognition uses bounded sets and fails or abstains when budgets/uniqueness conditions are not satisfied.

A module table identifies an import/export protocol. It does not automatically connect every pair of functions contained in a factory.

## Representative pointer constraints

For a factory `F` registered under ID `k`, the adapter allocates an abstract module `M_k` and initial exports object `E_k`. It connects the appropriate factory parameters to these objects and to its scoped loader/context token. Assignments to `M_k.exports` and `E_k.name` update slots by the common object rules.

A constant-ID import reads `M_k.exports`. An export getter such as `loader.d(E, {go: () => f})` connects `E.go` to the getter's returned value `f`. The getter function is not substituted for `f` as the public export. Older single-property export helpers are handled separately.

Rolldown lazy CJS wrappers create a thunk token. Invoking that token reads its module exports slot. Its callback is analyzed to populate those exports. This supplies semantic relationships without matching initialization functions to source functions.

Parcel loader identity follows its actual lexical/global binding. A module registered with loader A cannot be read through independent loader B merely because its ID matches.

Known export helpers support both `{fresh target; define getters; return target}` and `define getters into an existing target`. Their getter-map roles and the actual `Object.defineProperty` binding are checked. Ordinary small return summaries specialize parameter/member returns at each call site instead of merging every application's arguments into one global parameter state.

## Context population and target population

A runtime helper file may contain no target functions while being essential to resolve thousands of target functions. Dependency context must therefore be collected independently of target selection. Literal relative dependencies are followed within explicit build roots; computed runtime loading requires the emitted asset manifest. Unresolved imports remain evidence of incomplete context.

For oracle experiments, context-only functions have no matchable inventory IDs. Their code still contributes helper semantics and value constraints. They create neither ground-truth targets nor initial anchors. All frozen source/bundle pair and seed hashes remain unchanged.

In the general code-only CLI, parsed context functions are normal graph nodes. Consumers choose their target population independently.

## Relationship emission and neighborhood propagation

A modeled call produces an edge only when its modeled callable target is unique. Multiple possible callables, opaque native alternatives and overflow values abstain. This is a partial analysis: missing unknown flows are not automatically represented as a full sound top value, so singleton modeled targets are not a soundness guarantee.

Function-value references and callback argument uses are recorded with different edge kinds. They do not assert that a callback executes. The downstream neighborhood experiment uses undirected augmentations, preserving its original base graph and sibling policy.

The source and bundle sides are analyzed independently. A new oracle-assisted anchor requires a corresponding source-side relationship and bundle-side relationship to a previously accepted pair. No module membership clique, module-level matching shortcut, new seed or source-map-derived relationship is introduced.

## Validation boundary

Protocol coverage, function-edge precision, computational cost, seed stability and final recovery are different measurements. The shipped validation checks important protocol variations and selected true/false edges. The real-library evaluation measures oracle connectivity with fixed targets/seeds. Neither establishes sound JavaScript analysis or representative ecosystem coverage.

Relevant primary implementation references are linked in the README/report. The v2 analyzer is inspired by D-Bundlr's analyzer organization and extends its module-record abstraction to additional emitted mechanisms; it does not reproduce the paper's prediction, dynamic validation or rewriting stages.
