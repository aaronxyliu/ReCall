import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFeatures,identifyAnchors,identifyLibraries} from '../components/pog/index.mjs';
import {runPipeline,recoverFunctions} from '../components/pipeline/index.mjs';
import {buildCatalog,identifyCatalog} from '../src/workflow/inputs.mjs';

const body='o.a;o.b;o.c;o.d;o.e;o.f;o.g;o.h;o.i;o.j;';
function inputs(){return {
 source:extractFeatures({files:[{path:'source.js',library:{name:'lib',version:'1.0.0'},code:`function anchor(o){${body}} function helper(v){return v+1}`}]}),
 bundle:extractFeatures({files:[{path:'bundle.js',code:`function a(o){${body}} function b(o){${body}} function h(v){return v+1} function k(v){return v+1}`}]}),
};}
const config={recovery:{neighborhoodOrder:'bundle-first',oneBundlePerSource:false,minAnchors:1},graph:{useModules:false,siblingWindow:10,includeContainment:false}};
const models=()=>({config:{provider:'test'},async embed(xs){return xs.map(()=>[1,1])},async validate(){return {verdict:'accept',validator:'model'}}});
const identities=r=>r.promotions.map(p=>[p.bundleId,p.sourceId].join('|')).sort();

test('one source anchors all same-chunk POG copies without AST or model validation',()=>{
 const {source,bundle}=inputs(),anchors=identifyAnchors(source,bundle);
 assert.equal(anchors.matches.length,2);
 assert.equal(new Set(anchors.matches.map(p=>p.sourceId)).size,1);
 assert.equal(new Set(anchors.matches.map(p=>p.bundleId)).size,2);
 assert.deepEqual(anchors.ambiguous,[]);
 // Target multiplicity does not manufacture distinct library anchors.
 const libraries=identifyLibraries(source,bundle,{minAnchors:2});
 assert.equal(libraries.options.uniqueBundle,false);
 assert.equal(libraries.libraries[0].matchedAnchorFunctions,1);
 assert.equal(libraries.libraries[0].detected,false);
 assert.equal(libraries.libraries[0].evidence[0].bundleIds.length,2);
 const catalog=identifyCatalog(buildCatalog(source),bundle,{minAnchors:1});
 assert.equal(catalog[0].matchedAnchorFunctions,1);assert.equal(catalog[0].detected,true);
 const ambiguousSource=extractFeatures({files:[{path:'source.js',code:`function x(o){${body}} function y(o){${body}}`}]});
 assert.equal(identifyAnchors(ambiguousSource,bundle).matches.length,0);
});

for(const astBeforeRanking of [false,true])test(`same-chunk sources remain reusable during propagation and resume (AST before ranking: ${astBeforeRanking})`,async()=>{
 const i=inputs(),cfg={...config,recovery:{...config.recovery,astBeforeRanking}},r=await runPipeline({...i,config:cfg,models:models()});
 assert.equal(r.anchors.matches.length,2);
 assert.equal(r.recovery.configuration.conflictPolicy,'discard');
 assert.equal(r.recovery.promotions.length,4);
 assert.equal(r.recovery.multipleMatches.sourceChunkGroupsWithMultipleTargets,2);
 assert.equal(r.recovery.multipleMatches.bundledFunctionsWithMultipleSources,0);
 assert.equal(r.recovery.stats.conflicts,0);
 assert.equal(r.recovery.queries.length,2);
 assert.equal(new Set(r.recovery.promotions.map(p=>p.bundleId)).size,4);
 const limited=await runPipeline({...i,config:{...cfg,recovery:{neighborhoodOrder:'bundle-first',oneBundlePerSource:false,...cfg.recovery,maxValidationCalls:1}},models:models()});
 assert.equal(limited.recovery.status,'budget-exhausted');
 const resumed=await recoverFunctions({...i,...limited,config:cfg.recovery,models:models(),resume:limited.recovery});
 assert.deepEqual(identities(resumed),identities(r.recovery));
 const finished=await recoverFunctions({...i,...r,config:cfg.recovery,models:models(),resume:r.recovery});
 assert.deepEqual(identities(finished),identities(r.recovery));
});

test('external selection can recover repeated copies of an already-used source',async()=>{
 const i=inputs(),helper=i.source.functions.find(f=>f.name==='helper');
 const r=await runPipeline({...i,config,candidateSelector:({candidates})=>candidates.some(s=>s.id===helper.id)?helper.id:null});
 assert.equal(r.recovery.promotions.filter(p=>p.sourceId===helper.id).length,2);
 assert.equal(r.recovery.stats.validationCalls,0);
});
