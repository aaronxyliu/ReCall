# Efficiency review — 2026-11-11

## Measured improvement

Recovery repeatedly requested the same immutable source and bundle neighborhoods inside its library/target/round loops. A per-run FIFO cache now reuses the ordered BFS results. Each graph cache is capped at 4,096 entries and 250,000 retained neighbor memberships; oversized neighborhoods bypass caching. The cache does not change candidate ordering, scope boundaries, AST decisions, model settings, or checkpoint contents.

On saved drawDB query-parent lookups (radius 1), five measured runs after warmup had median uncached traversal **56.70 ms**, cached **1.98 ms** (28.6x for this operation). There were 23,784 lookups, 4,546 unique sources, and identical ordered neighbors for every requested source. This workload uses final saved parent correspondences, not an exact reconstruction of historical invocation order. It is a microbenchmark, not an end-to-end speedup or new recovery result.

```sh
node benchmarks/neighborhood.mjs /path/to/isolated/sourceGraph.json /path/to/isolated/recovery.json
```

Raw measurements: [neighborhood-result.json](../benchmarks/neighborhood-result.json). Timing is machine-dependent. Benchmark input came from the 2026-11-10 cross-chunk drawDB experiment; no model was invoked and no result was changed.

## Existing efficiencies

- AST prechecks avoid embedding and model calls on a shape match.
- Function representations and embedding vectors are reused within recovery.
- HTTP caches include exact requests, endpoint, model digest and settings.
- Module/graph preparation and checkpoints support compatible resume.
- Initial anchor construction and candidate lookups use maps and sets.

## Remaining costs and limitations

- Recovery scans every supplied bundle function for every source library and round. A frontier index could reduce scanning, but must preserve same-pass AST promotion and candidate ordering. This was not changed without a broader equivalence evaluation.
- Candidate ranking still computes all candidate similarities and sorts the complete pool. Saved traces include all ranks; replacing this with top-K selection would change trace detail and requires deliberate evaluation.
- Validation is sequential and stops at the first acceptance. Parallel speculation could waste requests and change propagation semantics; no concurrency change was made.
- Full graph construction, feature extraction and Terser/AST normalization can dominate preparation. Their costs depend on code and module structure.
- Checkpoints serialize accumulated queries/promotions. Large traces consume disk and memory; output compaction would change diagnostic contracts.
- Existing minification and AST canonicalization caches are process-global and unbounded. They work well for separate per-repository processes, but a long-lived multi-repository service needs an explicit cache lifecycle before claiming bounded total memory. The new neighborhood cache alone does not solve that issue.

The implementation avoids redundant work in several places, but this audit does not establish end-to-end scalability or predict real-model runtime. The previous simulation excludes validation-model latency. No full-dataset rerun was performed.

## Validation and maintenance

156 current-runtime tests pass, including graph isolation, cross-chunk recovery, repeated bundled copies, AST-first behavior, budget/checkpoint resume, and cache order/eviction. Ten legacy policy tests remain with historical experiment code in ReCall Exp; four engine test files now exercise the active src/ implementation. Two cache tests were added.

Historical scripts, old validation JSON records and unused illustrations were preserved byte-for-byte in ReCall Exp/archive/recall-cleanup-2026-11-11/ with SHA-256 records before removal from ReCall. ReCall Exp symlinks to removed scripts/prompts were materialized at their existing paths, retaining exact contents. Required vendor code, input acquisition APIs, local outputs and all dataset/experiment results remain intact.
