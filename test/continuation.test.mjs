import test from 'node:test';import assert from 'node:assert/strict';
import {extractFeatures} from '../components/pog/index.mjs';import {runPipeline,recoverFunctions,preparePipeline} from '../components/pipeline/index.mjs';import {migrateRecovery} from '../src/workflow/continuation.mjs';import {inventoryDigest} from '../src/shared/artifacts.mjs';import {graphDigest} from '../components/graph/index.mjs';
const config={recovery:{neighborhoodOrder:'bundle-first',oneBundlePerSource:false,astBeforeRanking:false,libraryGate:false,conflictPolicy:'retain',topK:3},graph:{useModules:false,siblingWindow:2,includeContainment:true}};
function fixture(){const a='anchor(o){o.a;o.b;o.c;o.d;o.e;o.f;o.g;o.h;o.i;o.j}';const source=extractFeatures({files:[{id:'s',path:'s.js',library:{name:'lib',version:'1'},code:'class A{'+a+'connect(x){this.delegate.connect(x)}}'}]}),bundle=extractFeatures({files:[{id:'b',path:'b.js',code:'class B{'+a+'connect(y){this.delegate.connect(y)}}'}]});const oldSource=structuredClone(source),oldBundle=structuredClone(bundle);for(const p of [oldSource,oldBundle]){for(const f of p.functions){f.code=p.units.find(u=>u.id===f.unit).code.slice(...f.span);delete f.codeSpan}p.inputDigest=inventoryDigest(p)}return {source,bundle,oldSource,oldBundle}}
const models=()=>({config:{provider:'test'},async embed(xs){return xs.map(()=>[1,1])},async validate(){return {verdict:'accept',validator:'model'}}});
test('upgrade preserves accepted anchors and recovers discarded method without restarting recovery',async()=>{
 const i=fixture(),old=await runPipeline({source:i.oldSource,bundle:i.oldBundle,config,models:models()}),fresh=preparePipeline({source:i.source,bundle:i.bundle,config});assert.equal(old.recovery.promotions.length,1);
 const args={prior:old.recovery,...i,oldSourceGraph:old.sourceGraph,oldBundleGraph:old.bundleGraph,sourceGraph:fresh.sourceGraph,bundleGraph:fresh.bundleGraph,models:models().config,implementation:{prior:'old',next:'new'}};
 const seed=migrateRecovery(args);assert.equal(seed.promotions.length,1);assert.equal(seed.nextRound,old.recovery.stats.rounds+1);assert.deepEqual(seed.processedStates,[]);
 const result=await recoverFunctions({source:i.source,bundle:i.bundle,...fresh,config:config.recovery,resume:seed,models:models()});assert.equal(result.promotions.length,2);assert.deepEqual(result.promotions[0],old.recovery.promotions[0]);assert.equal(result.continuation.preservedAcceptedPairs,1);assert(result.queries.every(q=>q.phase==='source-resolution-method-v1'));
 const changed=structuredClone(i.source);changed.units[0].code+='\n';changed.inputDigest=inventoryDigest(changed);const cg=structuredClone(fresh.sourceGraph);cg.inputDigest=changed.inputDigest;cg.graphDigest=graphDigest(cg);assert.throws(()=>migrateRecovery({...args,source:changed,sourceGraph:cg}),/identical supplied units/);
 assert.throws(()=>migrateRecovery({...args,models:{provider:'different'}}),/model settings/);
 assert.throws(()=>migrateRecovery({...args,prior:{...old.recovery,checkpointDigest:'tampered'}}),/checksum/);
});

test('upgrade recomputes unmatched pair decisions instead of reusing historical verdicts',async()=>{
 const i=fixture();const rejected=models();rejected.validate=async()=>({verdict:'reject',validator:'model'});
 const old=await runPipeline({source:i.source,bundle:i.bundle,config,models:rejected});assert.equal(old.recovery.promotions.length,1);assert(old.recovery.queries.some(q=>q.checks.length));
 const seed=migrateRecovery({prior:old.recovery,oldSource:i.source,oldBundle:i.bundle,source:i.source,bundle:i.bundle,oldSourceGraph:old.sourceGraph,oldBundleGraph:old.bundleGraph,sourceGraph:old.sourceGraph,bundleGraph:old.bundleGraph,models:models().config,implementation:{prior:'old',next:'new'}});assert(seed.queries.every(q=>q.checks.every(c=>c.reusableAfterMigration===false)));
 let calls=0;const m=models();m.validate=async()=>{calls++;return {verdict:'accept',validator:'ast'}};
 const next=await recoverFunctions({source:i.source,bundle:i.bundle,sourceGraph:old.sourceGraph,bundleGraph:old.bundleGraph,anchors:old.anchors,libraries:old.libraries,config:config.recovery,resume:seed,models:m});assert.equal(next.promotions.length,2);assert.equal(calls,1);assert(next.queries.some(q=>q.phase==='baseline'));assert(next.queries.some(q=>q.phase==='source-resolution-method-v1'));
});
