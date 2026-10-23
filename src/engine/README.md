# Shared analysis engine

This is the component-facing port of the existing `scripts/real-app/bundle-graph-v2` analyzer. The original experiment implementation is retained unchanged because experiment snapshots and hash manifests refer to it.

The port adds one boundary: module recognition can record a serializable registration/loader plan or consume a supplied plan. Plans address AST nodes by source ranges and are tied to exact input and engine hashes. `components/modules` records the plan; `components/graph` consumes it. The shared lexical binding/value-flow solver remains necessary on both sides of that boundary: a factory registration alone does not resolve the function value exported by it.

The bundler identifier calls structural recognition separately and does not solve the graph. Its ambiguous family result does not prevent a compatible runtime adapter from resolving actual imports and exports.

Runtime recognition adapters now live under `adapters/`; `recognition-context.mjs` owns shared alias/registry utilities. Shared helper summaries are isolated in `adapters/helpers.mjs`. Analysis/parsing/context/minification utilities live under `src/analysis`. Integrated graph construction reuses solved state, while serialized plans replay independently. See [adapter development](../../docs/adapters.md).
