// Offline microbenchmark: node benchmarks/neighborhood.mjs SOURCE_GRAPH RECOVERY
// Reads saved artifacts only; does not call models or mutate experiment results.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {adjacency,neighbors,neighborhoodLookup} from '../src/analysis/neighborhood.mjs';
const [graphFile,recoveryFile]=process.argv.slice(2);
if(!graphFile||!recoveryFile)throw Error('Provide sourceGraph.json and recovery.json');
const graph=adjacency(JSON.parse(fs.readFileSync(graphFile)));
const recovery=JSON.parse(fs.readFileSync(recoveryFile));
const accepted=new Map();for(const p of recovery.promotions){if(!accepted.has(p.bundleId))accepted.set(p.bundleId,[]);accepted.get(p.bundleId).push(p.sourceId)}
const workload=recovery.queries.flatMap(q=>(q.parentBundleIds||[]).flatMap(id=>accepted.get(id)||[]));
const radius=recovery.configuration.radius,lookup=neighborhoodLookup(graph,radius);
for(const id of new Set(workload))assert.deepEqual([...lookup(id)],[...neighbors(id,graph,radius)]);
function bench(cached){const get=cached?neighborhoodLookup(graph,radius):id=>neighbors(id,graph,radius);let memberships=0;const start=performance.now();for(const id of workload)memberships+=get(id).size;return {ms:performance.now()-start,memberships}}
bench(false);bench(true);const runs=Array.from({length:5},()=>({uncached:bench(false),cached:bench(true)}));
for(const run of runs)assert.equal(run.cached.memberships,run.uncached.memberships);
console.log(JSON.stringify({note:'Traversal microbenchmark using saved query parents, not end-to-end recovery timing or exact historical invocation order.',queries:recovery.queries.length,lookups:workload.length,uniqueSources:new Set(workload).size,runs},null,2));
