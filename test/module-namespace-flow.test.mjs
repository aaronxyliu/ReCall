import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createProject} from '../src/project.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {extractFeatures} from '../components/pog/index.mjs';
import {identifyBundler} from '../components/bundler/index.mjs';
import {resolveModules} from '../components/modules/index.mjs';
import {buildGraph} from '../components/graph/index.mjs';
import {runPipeline} from '../components/pipeline/index.mjs';

function analyze(t,code,{leaf='export function target(){}',files=[],environment='main'}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'recall-namespace-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const manifest={roots:[root],files:[...(leaf===null?[]:[{path:path.join(root,'leaf.js'),code:leaf,environment}]),...files.map(f=>({...f,path:path.join(root,f.path)})),{path:path.join(root,'entry.js'),code}]};
 const p=createProject(manifest),m=resolveModules(p,{followDependencies:false}),g=buildGraph(p,{moduleMap:m,siblingWindow:0,includeContainment:false});
 const replay=buildGraph(p,{moduleMap:JSON.parse(JSON.stringify(m)),siblingWindow:0,includeContainment:false});assert.deepEqual(replay.edges,g.edges);
 const edge=(from,to)=>g.edges.some(e=>e.kind==='call'&&p.functions.find(f=>f.id===e.from)?.name===from&&p.functions.find(f=>f.id===e.to)?.name===to);
 return {p,m,g,edge,manifest};
}

test('Vite and Bun labels are accepted without claiming unique code inference',t=>{
 const {p}=analyze(t,'function caller(){}');
 for(const hint of ['vite','bun']){const r=identifyBundler(p,{hint});assert.equal(normalizeConfig({bundler:{hint}}).bundler.hint,hint);assert.equal(r.family,hint);assert.equal(r.status,'user-specified');assert.deepEqual(r.candidates,identifyBundler(p).candidates);}
});
for(const code of [
 'import("./leaf.js").then(function ready(ns){ns.target()})',
 'const load=()=>import("./leaf.js");load().then(function ready({target:renamed}){renamed()})',
 'import("./leaf.js").then(ns=>ns.target).catch(()=>null).finally(()=>{}).then(function ready(fn){fn()})',
 'async function ready(){const {target}=await import("./leaf.js");target()}',
])test('dynamic import namespace reaches callback/await through JSON replay: '+code,t=>{
 const a=analyze(t,code);assert(a.edge('ready','target'));assert.equal(a.m.coverage.unresolvedImports,0);
});
test('an exported function named then is distinct from the import promise then method',t=>{
 const a=analyze(t,'import("./leaf.js").then(function ready(ns){ns.target()});async function afterAwait(){const ns=await import("./leaf.js");ns.then()}',{leaf:'export function target(){};export function then(){}'});
 assert(a.edge('ready','target'));assert(a.edge('afterAwait','then'));assert(!a.edge('ready','then'));
});
test('dynamic CommonJS imports expose named exports and a default namespace',t=>{
 const a=analyze(t,'const p=import("./leaf.js");p.then(function namedReady(ns){ns.go()});p.then(function defaultReady(ns){ns.default.go()})',{leaf:'exports.go=function target(){}'});
 assert(a.edge('namedReady','target'));assert(a.edge('defaultReady','target'));
});
test('alternative imported namespaces remain ambiguous instead of selecting the first promise',t=>{
 const a=analyze(t,'const p=flag?import("./leaf.js"):import("./other.js");p.then(function ready(ns){ns.target()})',{leaf:'export function first(){};export {first as target}',files:[{path:'other.js',code:'export function second(){};export {second as target}'}]});
 assert(!a.edge('ready','first'));assert(!a.edge('ready','second'));assert.equal(a.m.coverage.unresolvedImports,0);
});
test('Vite preload helper propagates only the supplied import loader result across chunks',t=>{
 const helper='export function renamed(load,deps,base){let wait=Promise.resolve();if(deps&&deps.length)wait=Promise.allSettled(deps.map(x=>x));function fail(error){const event=new Event("vite:preloadError",{cancelable:true});event.payload=error;throw error}return wait.then(()=>load().catch(fail))}';
 const a=analyze(t,'import {renamed as p} from "./helper.js";p(()=>import("./leaf.js"),["./not-captured.js"]).then(function ready({target:go}){go()})',{files:[{path:'helper.js',code:helper}]});
 assert(a.edge('ready','target'));assert.equal(a.m.units.length,3);assert(!a.m.moduleGraph.dependencies.some(e=>e.toModule.includes('not-captured')));
});
test('unrelated wrappers do not acquire Vite preload semantics',t=>{
 const a=analyze(t,'function wrapper(load,deps){const event=new Event("vite:preloadError");Promise.allSettled(deps);return {}}wrapper(()=>import("./leaf.js"),[]).then(function ready(ns){ns.target()})');
 assert(!a.edge('ready','target'));
});
test('destructured Turbopack context roles preserve exports and cross-chunk calls',t=>{
 const a=analyze(t,'globalThis.TURBOPACK.push(["entry.js",2,({i:load,s:publish})=>{const ns=load(1);function caller(){ns.target()}publish(["caller",()=>caller])}])',{leaf:null,files:[{path:'registered.js',code:'globalThis.TURBOPACK.push(["registered.js",1,({s:publish})=>{function target(){}publish(["target",()=>target])}])'}]});
 assert(a.edge('caller','target'));assert.equal(a.m.moduleGraph.modules.length,2);assert(a.m.moduleGraph.exports.some(e=>e.name==='target'&&e.targets.length===1));
});
for(const options of [{leaf:null},{environment:'worker'}])test('missing or separate-realm imports do not resolve to supplied functions: '+JSON.stringify(options),t=>{
 const a=analyze(t,'import("./leaf.js").then(function ready(ns){ns.target()})',options);assert(!a.edge('ready','target'));assert(a.m.moduleGraph.dependencies.some(e=>e.status==='not-supplied'));
});
test('computed imports and arbitrary then methods do not gain invented namespace flow',t=>{
 const a=analyze(t,'import(which).then(function ready(ns){ns.target()});const box={then(cb){return this}};box.then(function unrelated(ns){ns.target()})');
 assert(!a.edge('ready','target'));assert(!a.edge('unrelated','target'));
});
test('cached CommonJS export namespace wrapper exposes its target without a fabricated module',t=>{
 const a=analyze(t,'var box={exports:{}},done;function renamed(){if(done)return box.exports;done=1;(function(e){e.go=function target(){}})(box.exports);return box.exports}function caller(){renamed().go()}',{leaf:null});
 assert(a.edge('caller','target'));assert.equal(a.m.moduleGraph.modules.length,0);
});
test('local, parameter-dependent, or competing namespace returns are not summarized as captured returns',t=>{
 const a=analyze(t,'var a={go:function target(){}},b={};function local(){var box;box=a;return box}function competing(){if(flag)return a;return b}function parameter(box){if(flag)return box;return box}function caller(){local().go();competing().go();parameter(a).go()}',{leaf:null});
 assert(!a.edge('caller','target'));
});
test('new dynamic namespace relationship makes a source recovery candidate reachable',async t=>{
 const body='o.a;o.b;o.c;o.d;o.e;o.f;o.g;o.h;o.i;o.j;';
 const a=analyze(t,'import("./leaf.js").then(function ready(ns){return ns.anchor()})',{leaf:`export function anchor(o){${body}}`});
 const source=extractFeatures(a.manifest),bundle=extractFeatures({files:[{path:'bundle.js',code:`function anchor(o){${body}}function caller(){return anchor()}`}]});
 const ready=source.functions.find(f=>f.name==='ready'),caller=bundle.functions.find(f=>f.name==='caller');
 const r=await runPipeline({source,bundle,config:{recovery:{libraryGate:false},graph:{siblingWindow:0,includeContainment:false}},models:{config:{provider:'fixture'},async embed(xs){return xs.map(()=>[1,1])},async validate({source}){return {verdict:source.id===ready.id?'accept':'reject'}}}});
 assert(r.recovery.promotions.some(p=>p.sourceId===ready.id&&p.bundleId===caller.id));
});
