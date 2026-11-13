import test from 'node:test';import assert from 'node:assert/strict';
import {extractFeatures} from '../components/pog/index.mjs';import {runPipeline,preparePipeline,recoverFunctions} from '../components/pipeline/index.mjs';import {migrateASTBeforeRanking} from '../src/workflow/ast-continuation.mjs';
const anchor='function anchor(o){o.a;o.b;o.c;o.d;o.e;o.f;o.g;o.h;o.i;o.j;}';
const config={recovery:{neighborhoodOrder:'bundle-first',oneBundlePerSource:false,libraryGate:false,conflictPolicy:'retain',topK:3,astBeforeRanking:false},graph:{useModules:false,siblingWindow:10,includeContainment:true}};
function inputs(target=5,ambiguous=false){return {source:extractFeatures({files:[{id:'s',path:'s.js',library:{name:'lib',version:'1'},code:anchor+Array.from({length:5},(_,i)=>`function f${i+1}(n){return n+${ambiguous&&i===3?5:i+1}}`).join('')}]}),bundle:extractFeatures({files:[{id:'b',path:'b.js',code:anchor+`function target(n){return n+${target}}`}]})}}
const rejects=()=>({config:{provider:'test'},async embed(xs){return xs.map(()=>[1,1])},async validate(){return {verdict:'reject',validator:'model'}}});
test('default AST before top-three recovers a fifth-ranked candidate without embedding or Qwen',async()=>{
 const i=inputs(),old=await runPipeline({...i,config,models:rejects()});assert.equal(old.recovery.promotions.length,1);assert.equal(old.recovery.queries[0].checks.length,3);
 const models={config:{provider:'test'},async embed(){throw Error('Unexpected embedding')},async validate(){throw Error('Unexpected Qwen')}};
 const {astBeforeRanking,topK,...defaultRecovery}=config.recovery;const r=await runPipeline({...i,config:{...config,recovery:defaultRecovery},models});assert.equal(r.recovery.configuration.astBeforeRanking,true);assert.equal(r.recovery.configuration.topK,3);assert.equal(r.recovery.promotions.length,2);const q=r.recovery.queries[0];assert.equal(q.selection,'ast-before-ranking');assert.equal(q.candidatePoolSize,5);assert.equal(q.astChecks,5);assert.equal(q.astSearch,'first-hit');assert.equal(q.checks[0].validator,'ast');assert.equal(r.recovery.promotions[1].sourceId,i.source.functions.find(f=>f.name==='f5').id);
});
test('no AST match retains three semantic checks without a similarity threshold',async()=>{
 const i=inputs(99);let calls=0;const m=rejects();m.validate=async()=>{calls++;return {verdict:'reject',validator:'model'}};const r=await runPipeline({...i,config:{...config,recovery:{...config.recovery,astBeforeRanking:true}},models:m});assert.equal(calls,3);assert.equal(r.recovery.configuration.minSimilarity,-1);assert.equal(r.recovery.promotions.length,1);assert.equal(r.recovery.stats.astPreRankingChecks,5);
});
test('first AST match is accepted immediately without embedding even with multiple matches',async()=>{
 const i=inputs(5,true);const m={config:{provider:'test'},async embed(){throw Error('No embedding after AST hit')},async validate(){throw Error('No Qwen after AST hit')}};const r=await runPipeline({...i,config:{...config,recovery:{...config.recovery,astBeforeRanking:true}},models:m});assert.equal(r.recovery.queries[0].astChecks,4);assert.equal(r.recovery.promotions[1].sourceId,i.source.functions.find(f=>f.name==='f4').id);
});
test('policy continuation preserves accepted matches and reopens only unmatched targets',async()=>{
 const i=inputs(),m=rejects(),old=await runPipeline({...i,config,models:m});const next=preparePipeline({...i,config:{...config,recovery:{...config.recovery,astBeforeRanking:true}}});const args={prior:old.recovery,...i,sourceGraph:old.sourceGraph,bundleGraph:old.bundleGraph,models:m.config,configuration:next.options,implementation:{prior:'before',next:'after'}};const seed=migrateASTBeforeRanking(args);assert.deepEqual(seed.promotions,old.recovery.promotions);assert.equal(seed.nextRound,old.recovery.stats.rounds+1);assert.equal(seed.processedStates.length,0);assert.deepEqual(seed.queries,old.recovery.queries.map(q=>({...q,phase:'baseline'})));const result=await recoverFunctions({...i,...next,config:next.options,models:m,resume:seed});assert.equal(result.promotions.length,2);assert.deepEqual(result.promotions[0],old.recovery.promotions[0]);assert.equal(result.continuation.id,'ast-first-hit-immediate-v2');
 assert.throws(()=>migrateASTBeforeRanking({...args,configuration:{...next.options,topK:5}}),/unrelated/);assert.throws(()=>migrateASTBeforeRanking({...args,models:{provider:'other'}}),/model/);assert.throws(()=>migrateASTBeforeRanking({...args,prior:{...old.recovery,sourceDigest:'bad'}}),/unchanged/);
});
test('periodic in-round checkpoint resumes pending AST promotions without replaying decisions',async t=>{
 const {performance}=await import('node:perf_hooks');const i=inputs(),p=preparePipeline({...i,config:{...config,recovery:{...config.recovery,astBeforeRanking:true}}}),m=rejects();let seed,clock=0;
 const mocked=t.mock.method(performance,'now',()=>clock+=120001);
 await assert.rejects(recoverFunctions({...i,...p,config:p.options,models:m,onCheckpoint:r=>{if(r.pendingRound){seed=structuredClone(r);throw Error('test stop after durable pending round')}}}),/test stop/);
 mocked.mock.restore();assert.equal(seed.pendingRound.proposals.length,0);assert.equal(seed.promotions.length,2);const result=await recoverFunctions({...i,...p,config:p.options,models:{...m,async embed(){throw Error('Decision replayed')},async validate(){throw Error('Decision replayed')}},resume:seed});assert.equal(result.promotions.length,2);assert.equal(result.promotions.filter(x=>x.kind==='ast-recovered').length,1);
});
test('a first AST hit becomes an anchor for later targets in the same pass',async()=>{
 const {graphDigest}=await import('../components/graph/index.mjs');const i=inputs();i.bundle=extractFeatures({files:[{id:'b',path:'b.js',code:anchor+'function a(n){return n+4}function b(n){return n+5}'}]});const p=preparePipeline({...i,config:{...config,recovery:{...config.recovery,astBeforeRanking:true}}});const id=(inventory,name)=>inventory.functions.find(f=>f.name===name).id;
 p.sourceGraph.edges=[{from:id(i.source,'anchor'),to:id(i.source,'f4'),kind:'call'},{from:id(i.source,'f4'),to:id(i.source,'f5'),kind:'call'}];p.sourceGraph.graphDigest=graphDigest(p.sourceGraph);p.bundleGraph.edges=[{from:id(i.bundle,'anchor'),to:id(i.bundle,'a'),kind:'call'},{from:id(i.bundle,'a'),to:id(i.bundle,'b'),kind:'call'}];p.bundleGraph.graphDigest=graphDigest(p.bundleGraph);
 const r=await recoverFunctions({...i,...p,config:p.options,models:{config:{provider:'test'},async embed(){throw Error('Unexpected embedding')},async validate(){throw Error('Unexpected validation')}}});assert.equal(r.promotions.length,3);assert(r.promotions.filter(p=>p.kind==='ast-recovered').every(p=>p.round===1));
});

test('source-first checks bundled neighbors beyond top three for AST matches', async () => {
 const i = inputs();
 i.source = extractFeatures({files:[{id:'s',path:'s.js',code:anchor+'function source(n){return n+5}'}]});
 i.bundle = extractFeatures({files:[{id:'b',path:'b.js',code:anchor+
  Array.from({length:5},(_,n)=>`function b${n}(x){return x+${n+1}}`).join('')} ]});
 let requests = 0;
 const models = rejects();
 models.validate = async () => { requests++; return {verdict:'reject',validator:'model'} };
 const {recovery} = await runPipeline({...i, models, config:{
  ...config, recovery:{maxRounds:1}
 }});
 assert.equal(recovery.configuration.neighborhoodOrder, 'source-first');
 assert.equal(recovery.configuration.oneBundlePerSource, true);
 assert.equal(requests, 0);
 const matches = recovery.promotions.filter(p=>p.kind==='ast-recovered');
 assert.equal(matches.length, 1);
 assert.equal(matches[0].bundleId, i.bundle.functions.find(f=>f.name==='b4').id);
});

test('one bundle per source reserves model matches within the round in both orders', async () => {
 const source = extractFeatures({files:[{id:'s',path:'s.js',code:anchor+'function ref(n){return n+1}'}]});
 const bundle = extractFeatures({files:[{id:'b',path:'b.js',code:anchor+
  'function first(n){return n+2} function second(n){return n+3}'}]});
 for(const neighborhoodOrder of ['bundle-first','source-first']){
  let calls=0;
  const models=rejects();
  models.validate=async()=>{calls++;return {verdict:'accept',validator:'model'}};
  const {recovery}=await runPipeline({source,bundle,models,config:{
   ...config,recovery:{neighborhoodOrder,oneBundlePerSource:true}
  }});
  assert.equal(calls,1);
  assert.equal(recovery.promotions.length,2);
  assert.equal(new Set(recovery.promotions.map(p=>p.sourceId)).size,2);
 }
});

test('strict source-first reports and checkpoints inside an AST-only round', async t => {
 const {performance}=await import('node:perf_hooks');
 const i=inputs();
 const models={async embed(){throw Error('Unexpected embedding')},async validate(){throw Error('Unexpected model call')}};
 // Limit the fixture to the anchor and the source that matches the target.
 const selected=i.source.functions.filter(f=>['anchor','f5'].includes(f.name)).map(f=>f.code).join('\n');
 i.source=extractFeatures({files:[{id:'s',path:'s.js',code:selected}]});
 const prepared=preparePipeline({...i,config:{graph:config.graph}});
 let clock=0,checkpoint;
 const events=[];
 const timer=t.mock.method(performance,'now',()=>clock+=120001);
 const args={...i,...prepared,config:prepared.options,models};
 await assert.rejects(recoverFunctions({...args,onProgress:event=>events.push(event),onCheckpoint:state=>{
  if(state.pendingRound){checkpoint=structuredClone(state);throw Error('Stopped after in-round checkpoint')}
 }}),/Stopped after in-round checkpoint/);
 timer.mock.restore();
 assert.equal(events[0].astPreRankingAccepted,1);
 assert.equal(events[0].validationBreakdown.qwenRequests,0);
 assert.equal(checkpoint.pendingRound.round,1);
 assert.equal(checkpoint.promotions.length,2);
 const resumed=await recoverFunctions({...args,resume:checkpoint});
 assert.equal(resumed.status,'fixed-point');
 assert.deepEqual(resumed.promotions,checkpoint.promotions);
});

test('strict recovery claims bundled targets across libraries for anchors and pending model matches', async () => {
 const source=extractFeatures({files:['a','b'].map(id=>({id,path:id+'.js',library:{name:id,version:'1'},
  code:anchor+`function start(o){return o.${id}()} function ref(n){return n+1}`}))});
 const bundle=extractFeatures({files:[{id:'bundle',path:'bundle.js',code:anchor+
  'function target(n){return n+2} function extra(n){return n+3}'}]});
 const target=bundle.functions.find(f=>f.name==='target');
 const i={source,bundle};
 const p=preparePipeline({...i,config:{graph:config.graph}});
 const seedB=bundle.functions.find(f=>f.name==='extra').id;
 const sourceB=source.functions.find(f=>f.library.name==='b'&&f.name==='anchor');
 const anchors={...p.anchors,matches:[
  ...p.anchors.matches,
  {sourceId:sourceB.id,bundleId:seedB,kind:'pog-anchor'}
 ]};
 let calls=0;
 const models=rejects();
 models.stats={validationRequests:0};
 models.validate=async()=>{calls++;models.stats.validationRequests++;return {verdict:'accept',validator:'model'}};
 const events=[];
 const r=await recoverFunctions({...i,...p,anchors,config:p.options,models,onProgress:event=>events.push(event)});
 assert.equal(events[0].validationBreakdown.qwenRequests,1);
 assert.equal(calls,1);
 assert.equal(r.promotions.length,3);
 assert.equal(r.promotions.filter(p=>p.bundleId===target.id).length,1);
 assert.equal(new Set(r.promotions.map(p=>p.bundleId)).size,r.promotions.length);
 assert.equal(new Set(r.promotions.map(p=>p.sourceId)).size,r.promotions.length);
});
