import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeRoles,supportedByEdgeRole} from '../src/analysis/edge-roles.mjs';
import {recoveryOptions} from '../src/config.mjs';
const graph = edges => ({edges:edges.map(([from,to,kind])=>({from,to,kind}))});
test('candidate pruning requires a matching relationship direction and an accepted in-scope parent',()=>{
 const source=edgeRoles(graph([['s','callee','call'],['caller','s','call'],['s','sibling','sibling']]));
 const bundle=edgeRoles(graph([['b','target','call']]));
 const accepted=new Map([['b',new Set(['s'])]]);
 const supported=id=>supportedByEdgeRole(id,'target',['b'],accepted,source,bundle,()=>true);
 assert(supported('callee'));assert(!supported('caller'));assert(!supported('sibling'));
 assert(!supportedByEdgeRole('callee','target',['b'],accepted,source,bundle,()=>false));
 assert(!supportedByEdgeRole('callee','target',['b'],new Map(),source,bundle,()=>true));
});
test('any matching role is sufficient; bundle unit boundaries do not restrict support',()=>{
 const source=edgeRoles(graph([['s','f','contains'],['s','f','argument-reference']]));
 const bundle=edgeRoles(graph([['chunk1:b','chunk2:f','argument-reference']]));
 assert(supportedByEdgeRole('f','chunk2:f',['chunk1:b'],new Map([['chunk1:b',new Set(['s'])]]),source,bundle,()=>true));
 assert.equal(recoveryOptions().matchEdgeRoles,true);
 assert.throws(()=>recoveryOptions({matchEdgeRoles:false}),/Unfiltered recovery has been removed/);
 assert.throws(()=>recoveryOptions({matchEdgeRoles:true,radius:2}),/radius 1/);
});

import {extractFeatures} from '../components/pog/index.mjs';
import {runPipeline} from '../components/pipeline/index.mjs';
test('pipeline prunes an opposite-direction candidate before embeddings and validation',async()=>{
 const properties='o.a;o.b;o.c;o.d;o.e;o.f;o.g;o.h;o.i;o.j;';
 const source=extractFeatures({files:[{id:'s',path:'/s.js',library:{name:'lib',version:'1'},code:`function anchor(o){${properties}return callee(o)}function caller(x){return anchor(x)+7}function callee(x){return x+1}`} ]});
 const bundle=extractFeatures({files:[{id:'b',path:'/b.js',code:`function anchor(o){${properties}return target(o)}function target(x){return x+2}`} ]});
 const callee=source.functions.find(f=>f.name==='callee');
 async function run(){const validated=[];const result=await runPipeline({source,bundle,config:{recovery:{astBeforeRanking:false},graph:{useModules:false,siblingWindow:0,includeContainment:false}},models:{config:{provider:'test'},async embed(xs){return xs.map(()=>[1,1])},async validate({source}){validated.push(source.name);return {verdict:source.id===callee.id?'accept':'reject',validator:'model'}}}});return {result:result.recovery,validated}}
 const filtered=await run();
 assert.deepEqual(filtered.validated,['callee']);
 assert.equal(filtered.result.promotions.length,2);
 assert(filtered.result.stats.relationshipCandidatesPruned>0);
});
