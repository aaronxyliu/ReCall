# Diagnose a run

| Symptom | What to inspect or change |
|---|---|
| Preflight reports unavailable model | Check the endpoint and exact model aliases/digests; use `--prepare-only` for static preparation |
| No JavaScript discovered | Supply `.js`, `.mjs`, or `.cjs`; symlinks/hidden paths/dependency installations are skipped; TS/JSX is not erased automatically |
| No catalog candidate passes | Check catalog coverage and `minFeatures`/`minAnchors`; the tool cannot identify an unindexed package/version |
| Library detected but no unique anchors | Several reference versions may share fingerprints; inspect `anchors.json` ambiguity rather than guessing a version |
| Unexpected configuration ignored | It should fail: every unknown setting is rejected; migrate old flat JSON into canonical sections |
| Run directory exists | Use `--resume` for the same inputs/settings or choose a new directory |
| Resume rejected | Read the mismatch: changed input/context, tool code, model identity, or settings requires a new run |
| Stale run lock after forced termination | Read `.recall.lock`; remove it only after confirming its PID is no longer running |
| Many functions unqueried | Compare both graphs, accepted anchors, library gating, code-size limits, radius, and cross-chunk setting; unqueried alone is not a connectivity diagnosis |
| Module links unresolved | Supply shared/lazy chunks, check context roots/environments, and inspect resolver diagnostics |
| Resource limit exceeded | Deliberately increase the appropriate input/module budget; increasing it does not guarantee enough memory |
| Invalid validator output | Only trimmed uppercase `T`/`F` is accepted; inspect the serving model/prompt and response in `recovery.json` |
| Offline reference missing | Populate the exact version cache online first or supply verified local package references |
| npm package cannot be unpacked | The built-in reader accepts standard files/directories plus path metadata; links, special files, and unsupported PAX size overrides are rejected |

Progress is printed to stderr. Output artifacts remain JSON files. `summary.json` reports coverage over parsed input functions, not accuracy or recovery of all functions originally present before tree shaking. Ground-truth evaluation belongs in the experiment repository.
