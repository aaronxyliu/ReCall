import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createProject} from '../src/project.mjs';import {resolveModules} from '../components/modules/index.mjs';import {buildGraph} from '../components/graph/index.mjs';import {createSourceResolver} from '../src/analysis/source-resolution.mjs';
function analyze(files,root){const p=createProject({roots:[root],files}),m=resolveModules(p),g=buildGraph(p,{moduleMap:m,siblingWindow:0,includeContainment:false});const edge=(a,b)=>g.edges.some(e=>p.functions.find(f=>f.id===e.from)?.name===a&&p.functions.find(f=>f.id===e.to)?.name===b);return {p,m,g,edge}}
function fixture(){return fs.mkdtempSync(path.join(os.tmpdir(),'recall-resolution-'))}
function file(root,rel,code,library,extra={}){const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,code);return {path:p,library,...extra}}
const lib=name=>({name,version:'1.0.0'});
test('resolves supplied package CJS entry into ESM namespace, named and default imports',()=>{
 const r=fixture();try{const a=analyze([
 file(r,'react/index.js',"module.exports=require('./cjs/react.production.js')",lib('react')),
 file(r,'react/cjs/react.production.js','exports.createContext=function createContext(){return {}};',lib('react')),
 file(r,'react/use.mjs',"import * as React from 'react';import {createContext as cc} from 'react';import R from 'react';export function use(){React.createContext();cc();R.createContext()}",lib('react'))],r);assert(a.edge('use','createContext'));assert.equal(a.m.coverage.unresolvedImports,0);
 }finally{fs.rmSync(r,{recursive:true,force:true})}});
test('resolves named, star and namespace reexports including extensionless index.mjs',()=>{
 const r=fixture();try{const a=analyze([
 file(r,'pkg/leaf.mjs','export function target(){return 1} export default function hidden(){return 2}',lib('pkg')),
 file(r,'pkg/barrel/index.mjs',"export * from '../leaf.mjs'; export {target as renamed} from '../leaf.mjs'; export * as nested from '../leaf.mjs'",lib('pkg')),
 file(r,'pkg/use.mjs',"import {renamed,nested} from './barrel';export function caller(){renamed();nested.target()}",lib('pkg'))],r);assert(a.edge('caller','target'));assert(!a.m.moduleGraph.exports.some(e=>e.name==='default'&&e.unit===a.p.units.find(u=>u.path.endsWith('barrel/index.mjs')).id));assert.equal(a.m.coverage.unresolvedImports,0);
 }finally{fs.rmSync(r,{recursive:true,force:true})}});
test('links normalized query/fragment aliases to supplied matchable unit, not a context duplicate',()=>{
 const r=fixture();try{const a=analyze([
 file(r,'pkg/leaf.mjs?abc','export function target(){return 1}',lib('pkg'),{aliasPaths:[path.join(r,'pkg/alias.mjs#fragment')]}),
 file(r,'pkg/use.mjs?def',"import {target} from './leaf.mjs';import {target as alias} from './alias.mjs';export function caller(){target();alias()}",lib('pkg'))],r);assert(a.edge('caller','target'));assert.equal(a.m.units.length,2);assert(a.m.moduleGraph.bindings.some(b=>b.request==='./alias.mjs'&&b.targets.length===1));assert.equal(a.m.coverage.unresolvedImports,0);assert(!a.m.diagnostics.some(d=>d.kind==='missing-relative-dependency'));
 }finally{fs.rmSync(r,{recursive:true,force:true})}});
test('honors supplied package exports and import/require branches',()=>{
 const r=fixture();try{fs.mkdirSync(path.join(r,'pkg'));fs.writeFileSync(path.join(r,'pkg/package.json'),JSON.stringify({name:'pkg',version:'1.0.0',exports:{'.':{import:'./esm.mjs',require:'./cjs.cjs'},'./feature':'./feature.mjs','./blocked':null}}));const a=analyze([
 file(r,'pkg/esm.mjs','export function esm(){return 1}',lib('pkg')),
 file(r,'pkg/cjs.cjs','exports.cjs=function cjs(){return 2}',lib('pkg')),
 file(r,'pkg/feature.mjs','export function feature(){return 3}',lib('pkg')),
 file(r,'pkg/use.mjs',"import {esm} from 'pkg';import {feature} from 'pkg/feature';const c=require('pkg');export function caller(){esm();feature();c.cjs()}",lib('pkg'))],r);assert(a.edge('caller','esm'));assert(a.edge('caller','cjs'));assert(a.edge('caller','feature'));assert(!createSourceResolver(a.m.units).resolve(a.m.units.at(-1),'pkg/blocked'));
 }finally{fs.rmSync(r,{recursive:true,force:true})}});
test('does not invent missing barrels or select ambiguous package versions/path aliases',()=>{
 const r=fixture();try{const a=analyze([
 file(r,'pkg/leaf.mjs','export function target(){return 1}',lib('pkg')),
 file(r,'pkg/use.mjs',"import {target} from './missing.mjs';export function caller(){target()}",lib('pkg'))],r);assert(!a.edge('caller','target'));assert(a.m.diagnostics.some(d=>d.kind==='missing-relative-dependency'));
 const u=(id,p,version='1',environment='main')=>({id,path:p,environment,library:{name:'pkg',version},packageRoot:path.dirname(p)});
 const index=createSourceResolver([u('a','/a/index.js'),u('b','/b/index.js','2')]);assert.equal(index.resolve({path:'/consumer/main.js',environment:'main'},'pkg'),null);
 const aliases=createSourceResolver([u('a','/a/foo.mjs?one'),u('b','/a/foo.mjs?two')]);assert.equal(aliases.resolve({path:'/a/use.mjs',library:{name:'pkg',version:'1'},packageRoot:'/a'},'./foo.mjs'),null);assert.equal(aliases.resolve({path:'/a/use.mjs',library:{name:'pkg',version:'1'},packageRoot:'/a'},'./foo.mjs?one')?.id,'a');
 const workers=createSourceResolver([u('a','/a/foo.mjs?one','1','worker')]);assert.equal(workers.resolve({path:'/a/use.mjs',environment:'main'},'./foo.mjs'),null);
 }finally{fs.rmSync(r,{recursive:true,force:true})}});

test('resolved package binding puts correct function into actual recovery candidate list',async()=>{
 const {extractFeatures}=await import('../components/pog/index.mjs'),{runPipeline}=await import('../components/pipeline/index.mjs');const r=fixture();
 try{
  const anchor='function createContext(o){o.a;o.b;o.c;o.d;o.e;o.f;o.g;o.h;o.i;o.j;return {}}';
  const files=[file(r,'react/index.js',"module.exports=require('./cjs/production.js')",lib('react')),file(r,'react/cjs/production.js','exports.createContext='+anchor,lib('react')),file(r,'react/context.mjs',"import * as React from 'react';export function getContext(){return React.createContext({})}",lib('react'))];
  const source=extractFeatures({roots:[r],files}),bundle=extractFeatures({roots:[r],files:[file(r,'bundle.js',anchor+' function context(){return createContext({})}',null)]});const models={config:{provider:'test'},async embed(xs){return xs.map(()=>[1,1])},async validate(){return {verdict:'accept',validator:'model'}}};
  const result=await runPipeline({source,bundle,config:{recovery:{libraryGate:false,conflictPolicy:'retain',topK:3},graph:{siblingWindow:0,includeContainment:false}},models});
  const s=source.functions.find(f=>f.name==='getContext'),b=bundle.functions.find(f=>f.name==='context');assert(result.recovery.queries.some(q=>q.bundleId===b.id&&q.candidates.some(c=>c.sourceId===s.id)));
 }finally{fs.rmSync(r,{recursive:true,force:true})}
});

test('bare package without metadata can use its supplied index.mjs',()=>{
 const r=fixture();try{const a=analyze([file(r,'pkg/index.mjs','export function target(){return 1}',lib('pkg')),file(r,'pkg/use.mjs',"import {target} from 'pkg';export function caller(){target()}",lib('pkg'))],r);assert(a.edge('caller','target'));assert.equal(a.m.coverage.unresolvedImports,0)}finally{fs.rmSync(r,{recursive:true,force:true})}
});

test('independent package discovery resolves typed barrels and package imports without maps',async()=>{
 const {referenceManifest}=await import('../src/workflow/inputs.mjs');const r=fixture();
 try{
  file(r,'pkg/package.json',JSON.stringify({name:'pkg',version:'1.0.0',exports:{'.':'./src/index.ts'},imports:{'#leaf':'./src/leaf.ts','#blocked':null}}));
  file(r,'pkg/src/index.ts',"export {target} from './leaf.js'; export {caller} from './caller.js';");
  file(r,'pkg/src/leaf.ts','export function target(x:number){return x+1}');
  file(r,'pkg/src/caller.ts',"import {target} from '#leaf'; export function caller(x:number){return target(x)}");
  file(r,'pkg/src/types.d.ts','declare function ghost():void;');
  file(r,'consumer/package.json',JSON.stringify({name:'consumer',version:'1.0.0'}));
  file(r,'consumer/index.js',"import {target} from 'pkg'; export function external(){return target(1)}\n//# sourceMappingURL=poison.map");
  const manifest=referenceManifest(r);assert(manifest.files.some(f=>f.path.endsWith('leaf.ts')));assert(!manifest.files.some(f=>f.path.endsWith('.d.ts')));
  const a=analyze(manifest.files,r);assert(a.edge('caller','target'));assert(!a.edge('external','target'));assert.equal(a.m.coverage.unresolvedImports,1);
  file(r,'consumer/poison.map',JSON.stringify({version:3,sources:['fake.js'],sourcesContent:['export function forged(){}'],mappings:'AAAA'}));
  const after=analyze(referenceManifest(r).files,r);assert.deepEqual(after.g.edges,a.g.edges);assert.equal(after.p.inputDigest,a.p.inputDigest);assert(!after.p.functions.some(f=>f.name==='forged'));
  const from=after.m.units.find(u=>u.path.endsWith('caller.ts'));assert.equal(createSourceResolver(after.m.units).resolve(from,'#blocked'),null);
 }finally{fs.rmSync(r,{recursive:true,force:true})}
});
test('unrestricted bundle resolver can still resolve nearest supplied dependencies',()=>{
 const u=(id,root,version)=>({id,path:path.join(root,'index.js'),packageRoot:root,library:{name:'dep',version},packageInfo:{name:'dep',version,main:'index.js'}});
 const resolver=createSourceResolver([u('outer','/project/node_modules/dep','1.0.0'),u('inner','/project/node_modules/consumer/node_modules/dep','2.0.0')],{isolateLibraries:false});
 assert.equal(resolver.resolve({path:'/project/node_modules/consumer/main.js'},'dep')?.id,'inner');
 assert.equal(resolver.resolve({path:'/project/app/main.js'},'dep')?.id,'outer');
 assert.equal(resolver.resolve({path:'/unrelated/main.js'},'dep'),null);
});
