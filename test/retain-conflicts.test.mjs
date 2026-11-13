import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractFeatures} from '../components/pog/index.mjs';
import {runPipeline,recoverFunctions} from '../components/pipeline/index.mjs';
const anchor='function anchor(o){o.a;o.b;o.c;o.d;o.e;o.f;o.g;o.h;o.i;o.j;}';
function inputs(){return {source:extractFeatures({files:[{id:'s',path:'source.js',code:anchor+'function x(v){return v+1}function y(v){return v+2}',library:{name:'lib',version:'1'}}]}),bundle:extractFeatures({files:[{id:'b',path:'bundle.js',code:anchor+'function a(v){return v+1}function b(v){return v+2}'}]})};}
const models=()=>({config:{provider:'test'},async embed(xs){return xs.map(()=>[1,1])},async validate(){return {verdict:'accept',validator:'ast'}}});
const config={recovery:{neighborhoodOrder:'bundle-first',oneBundlePerSource:false,astBeforeRanking:false,libraryGate:false,conflictPolicy:'retain'},graph:{useModules:false,siblingWindow:2,includeContainment:true}};
test('stops at first acceptance, skips matched targets, retains cross-target conflicts',async()=>{
 const i=inputs(),r=await runPipeline({...i,config,models:models()});
 assert.equal(r.recovery.status,'fixed-point');
 assert.equal(r.recovery.multipleMatches.bundledFunctionsWithMultipleSources,0);
 assert.equal(r.recovery.promotions.length,3);
 assert.equal(r.recovery.queries.length,2);
 assert(r.recovery.queries.every(q=>q.checks.length===1));
 assert(r.recovery.multipleMatches.sourceChunkGroupsWithMultipleTargets>=1);
 assert.equal(new Set(r.recovery.promotions.map(p=>p.bundleId+'|'+p.sourceId)).size,r.recovery.promotions.length);
 assert(!r.recovery.queries.some(q=>q.status==='identity-conflict'));
 const resumed=await recoverFunctions({...i,...r,config:{...config.recovery},models:models(),resume:r.recovery});
 assert.equal(resumed.promotions.length,r.recovery.promotions.length);
});
test('budget resume preserves retained alternatives without duplicates',async()=>{
 const i=inputs(),limited={...config,recovery:{...config.recovery,maxValidationCalls:1}},r=await runPipeline({...i,config:limited,models:models()});
 assert.equal(r.recovery.status,'budget-exhausted');
 const resumed=await recoverFunctions({...i,...r,config:{...config.recovery},models:models(),resume:r.recovery});
 assert.equal(resumed.status,'fixed-point');
 assert.equal(new Set(resumed.promotions.map(p=>p.bundleId+'|'+p.sourceId)).size,resumed.promotions.length);
 const full=await runPipeline({...i,config,models:models()});
 assert.deepEqual(resumed.promotions.map(p=>p.bundleId+'|'+p.sourceId).sort(),full.recovery.promotions.map(p=>p.bundleId+'|'+p.sourceId).sort());
});

// A later AST match must not bypass an earlier candidate's semantic decision.
for (const verdict of ['T','F']) test(`rank order applies AST then semantic (${verdict}) before advancing`,async()=>{
 const {createModelClient}=await import('../components/pipeline/models.mjs');
 const previous=globalThis.fetch;let chats=0;
 globalThis.fetch=async(url,options)=>({ok:true,json:async()=>{
  if(url.endsWith('/tags'))return {models:[{name:'qwen3-embedding:0.6b',digest:'e'},{name:'qwen3.5:27b',digest:'v'}]};
  if(url.endsWith('/embed'))return {embeddings:JSON.parse(options.body).input.map(()=>[1,1])};
  chats++;return {message:{content:verdict}};
 }});
 try{
  const i=inputs();
  i.bundle=extractFeatures({files:[{id:'b',path:'bundle.js',code:anchor+'function a(v){return v+2}function b(v){return v+2}'}]});
  const client=createModelClient({astFirst:true}),r=await runPipeline({...i,config,models:client});
  assert.equal(r.recovery.queries.length,2);assert.equal(chats,2);
  for(const q of r.recovery.queries){
   assert.equal(q.checks.length,verdict==='T'?1:2);
   assert.equal(q.checks[0].validator,'model');
   if(verdict==='F')assert.equal(q.checks[1].validator,'ast');
  }
  assert.equal(client.stats.astAccepted,verdict==='T'?0:2);
 }finally{globalThis.fetch=previous;}
});


test('top-three caps checks at three with no similarity filter',async()=>{
 const i=inputs();i.source=extractFeatures({files:[{id:'s',path:'source.js',library:{name:'lib',version:'1'},code:anchor+Array.from({length:6},(_,n)=>`function f${n}(v){return v+${n+1}}`).join('')} ]});
 const m={config:{provider:'test'},async embed(xs){return xs.map(()=>[1,1])},async validate(){return {verdict:'reject',validator:'model'}}};
 const r=await runPipeline({...i,config:{...config,recovery:{...config.recovery,topK:3},graph:{...config.graph,siblingWindow:10}},models:m});
 assert.equal(r.recovery.configuration.minSimilarity,-1);assert(r.recovery.queries.some(q=>q.candidates.length>3));assert(r.recovery.queries.every(q=>q.checks.length===3));
});
