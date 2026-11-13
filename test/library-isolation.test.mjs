import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {extractFeatures,identifyAnchors} from '../components/pog/index.mjs';
import {resolveModules} from '../components/modules/index.mjs';
import {buildGraph,graphDigest} from '../components/graph/index.mjs';
import {preparePipeline,recoverFunctions} from '../components/pipeline/index.mjs';
import {createSourceResolver} from '../src/analysis/source-resolution.mjs';
const library=name=>({name,version:'1.0.0'});
const anchor='function anchor(o){o.a;o.b;o.c;o.d;o.e;o.f;o.g;o.h;o.i;o.j;return o}';
const config={recovery:{neighborhoodOrder:'bundle-first',oneBundlePerSource:false,libraryGate:false,astBeforeRanking:false},graph:{useModules:false}};
function inputs(){const source=extractFeatures({files:['a','b'].map(name=>({id:name,path:name+'/index.js',code:anchor+' function next(x){return x+1}',library:library(name),packageRoot:name}))});const bundle=extractFeatures({files:[{path:'bundle.js',code:anchor+' function target(x){return x+2}'}]});return {source,bundle}}
test('each library has independent anchors, candidate pools and accepted targets against the full bundle',async()=>{
 const {source,bundle}=inputs(),prepared=preparePipeline({source,bundle,config});
 assert.equal(prepared.anchors.matches.length,2);const seen=[];
 const recovery=await recoverFunctions({source,bundle,...prepared,config:prepared.options,candidateSelector:async q=>{seen.push(q);assert.equal(new Set(q.candidates.map(f=>f.library.name)).size,1);return q.candidates[0].id}});
 assert.equal(recovery.promotions.length,4);assert.equal(seen.length,2);assert.equal(new Set(seen.map(q=>q.libraryScope)).size,2);
 assert.equal(new Set(recovery.promotions.map(p=>p.bundleId)).size,2);
 assert.equal(recovery.stats.conflicts,0);
 const resumed=await recoverFunctions({source,bundle,...prepared,config:prepared.options,resume:recovery,candidateSelector:async()=>{throw Error('fixed point must not query')}});assert.equal(resumed.promotions.length,4);
 const old=structuredClone(recovery);delete old.scopePolicy;await assert.rejects(recoverFunctions({source,bundle,...prepared,config:prepared.options,resume:old,candidateSelector:async()=>null}),/predates strict library isolation/);
});
test('recovery rejects a supplied source graph that crosses libraries',async()=>{
 const {source,bundle}=inputs(),prepared=preparePipeline({source,bundle,config}),g=structuredClone(prepared.sourceGraph);
 g.edges.push({from:source.functions[0].id,to:source.functions.at(-1).id,kind:'call'});g.graphDigest=graphDigest(g);
 await assert.rejects(recoverFunctions({source,bundle,...prepared,sourceGraph:g,config:prepared.options}),/crosses library boundaries/);
});
test('source resolver forbids external ESM, CJS, reexports, dynamic imports and relative escapes but bundle graph retains them',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'recall-scope-'));
 try{
 const files=[{id:'a',path:path.join(root,'a/index.js'),library:library('a'),packageRoot:path.join(root,'a'),code:"import {f} from 'b'; export {f} from 'b'; const b=require('b'); export function caller(){f();b.f();import('b').then(n=>n.f())}"},{id:'b',path:path.join(root,'b/index.js'),library:library('b'),packageRoot:path.join(root,'b'),code:'export function f(){return 1}'}];
 for(const f of files){fs.mkdirSync(path.dirname(f.path),{recursive:true});fs.writeFileSync(f.path,f.code)}
 const source=extractFeatures({roots:[root],files});const m=resolveModules(source,{isolateLibraries:true});
 assert(!m.moduleGraph.bindings.some(b=>b.targets.length));assert(!m.moduleGraph.dependencies.some(d=>d.status==='supplied'));
 assert(!buildGraph(source,{moduleMap:m,siblingWindow:0}).edges.some(e=>e.fromUnit==='a'&&e.toUnit==='b'));
 const resolver=createSourceResolver(source.units);assert.equal(resolver.resolve(source.units[0],'../b/index.js'),null);
 const full=resolveModules(source,{isolateLibraries:false}),g=buildGraph(source,{moduleMap:full,isolateLibraries:false,siblingWindow:0});assert(full.moduleGraph.dependencies.some(d=>d.status==='supplied'));assert(g.edges.some(e=>e.fromUnit==='a'&&e.toUnit==='b'));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('same-name/version copies remain separate and package self references stay within their own root',()=>{
 const units=['one','two'].map(id=>({id,path:`/${id}/index.js`,library:library('pkg'),packageRoot:`/${id}`,packageInfo:{exports:'./index.js'}}));
 const r=createSourceResolver(units);assert.equal(r.resolve(units[0],'pkg')?.id,'one');assert.equal(r.resolve(units[0],'../two/index.js'),null);
 const source=extractFeatures({files:units.map(u=>({...u,code:anchor}))}),bundle=extractFeatures({files:[{path:'bundle.js',code:anchor}]});assert.equal(identifyAnchors(source,bundle).matches.length,2);
});
test('filesystem context cannot follow a symlink or nested package out of a source library',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'recall-scope-fs-'));
 try{fs.mkdirSync(path.join(root,'a/nested'),{recursive:true});fs.mkdirSync(path.join(root,'b'));fs.writeFileSync(path.join(root,'b/index.js'),'export function evil(){}');fs.symlinkSync(path.join(root,'b/index.js'),path.join(root,'a/link.js'));
 fs.writeFileSync(path.join(root,'a/nested/package.json'),JSON.stringify({name:'other',version:'1.0.0'}));fs.writeFileSync(path.join(root,'a/nested/index.js'),'export function other(){}');
 const source=extractFeatures({roots:[root],files:[{path:path.join(root,'a/index.js'),code:"import './link.js'; import './nested/index.js';",library:library('a'),packageRoot:path.join(root,'a')}]});const m=resolveModules(source);assert.equal(m.units.length,1);assert.equal(m.contextDependencies.filter(d=>d.status==='outside-library').length,2);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('validation budget and resume preserve separate library queries',async()=>{
 const {source,bundle}=inputs(),prepared=preparePipeline({source,bundle,config});
 const client=()=>({config:{provider:'test'},async embed(xs){return xs.map(()=>[1,0])},async validate(){return {verdict:'accept',validator:'test'}}});
 const partial=await recoverFunctions({source,bundle,...prepared,config:{...prepared.options,maxValidationCalls:1},models:client()});assert.equal(partial.status,'budget-exhausted');assert(partial.pendingRound);
 const resumed=await recoverFunctions({source,bundle,...prepared,config:{...prepared.options,maxValidationCalls:10},models:client(),resume:partial});
 const full=await recoverFunctions({source,bundle,...prepared,config:{...prepared.options,maxValidationCalls:10},models:client()});
 assert.deepEqual(resumed.promotions,full.promotions);assert.equal(resumed.stats.validationCalls,2);assert.equal(new Set(resumed.queries.map(q=>q.libraryScope)).size,2);
});

test('package self references cannot be shadowed by a nested installation with the same name',()=>{
 const outer={id:'outer',path:'/project/node_modules/pkg/index.js',library:library('pkg')},inner={id:'inner',path:'/project/node_modules/pkg/node_modules/pkg/index.js',library:{name:'pkg',version:'2.0.0'}};
 const resolver=createSourceResolver([outer,inner]);assert.equal(resolver.resolve(outer,'pkg')?.id,'outer');assert.equal(resolver.resolve(inner,'pkg')?.id,'inner');assert.equal(resolver.resolve(outer,'./node_modules/pkg/index.js'),null);
});
