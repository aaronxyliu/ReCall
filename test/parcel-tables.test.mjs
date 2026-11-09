import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../src/project.mjs';
import {resolveModules} from '../components/modules/index.mjs';
import {buildGraph} from '../components/graph/index.mjs';
import {identifyBundler} from '../components/bundler/index.mjs';

function bundle(table,{registry='parcelRequireRenamed',marker=true,host='typeof globalThis!=="undefined"?globalThis:typeof window!=="undefined"?window:{}'}={}){return `(function(entries,cache,roots){var host=${host};function load(id){if(!cache[id]){function local(name){return load(entries[id][1][name]||name)}var mod=cache[id]={exports:{}};entries[id][0].call(mod.exports,local,mod,mod.exports,this)}return cache[id].exports} ${marker?'load.isParcelRequire=!0;':''}host.${registry}=load;return load(roots[0])})(${table},{},["entry"])`}
function analyze(...files){const p=createProject({files:files.map((code,i)=>({id:'chunk'+i,path:'/tmp/parcel-chunk'+i+'.js',code}))}),m=resolveModules(p,{followDependencies:false}),g=buildGraph(p,{moduleMap:m,siblingWindow:0,includeContainment:false}),replay=buildGraph(p,{moduleMap:JSON.parse(JSON.stringify(m)),siblingWindow:0,includeContainment:false});assert.deepEqual(g.edges,replay.edges);const edge=(a,b)=>g.edges.some(e=>e.kind==='call'&&p.functions.find(f=>f.id===e.from)?.name===a&&p.functions.find(f=>f.id===e.to)?.name===b);return {p,m,g,edge};}
const helpers=`"helper":[function(req,mod,exp){exp.export=function(out,key,get){Object.defineProperty(out,key,{enumerable:true,get:get})};exp.interopDefault=function(value){return value&&value.__esModule?value:{default:value}};exp.exportAll=function(from,to){return Object.keys(from).forEach(function(key){key==="default"||key==="__esModule"||to.hasOwnProperty(key)||Object.defineProperty(to,key,{enumerable:true,get:function(){return from[key]}})}),to}},{}]`;
test('Parcel tuple tables resolve request maps and factory require/module/exports roles',()=>{
 const a=analyze(bundle(`{"lib":[function(q,m,x){x.go=function target(){}},{}],"entry":[function(q,m,x){const lib=q("./renamed");function caller(){lib.go()}},{"./renamed":"lib"}]}`));
 assert(a.edge('caller','target'));assert.equal(a.m.moduleGraph.modules.length,2);assert(a.m.moduleGraph.dependencies.some(e=>e.kind==='parcel-local-require'&&e.toModule.endsWith(':lib')&&e.status==='supplied'));assert.equal(identifyBundler(a.p).family,'parcel');
});
test('Parcel helpers expose three-parameter getters, namespace interop, and exportAll',()=>{
 const a=analyze(bundle(`{${helpers},"leaf":[function(q,m,x){function target(){};q("helper").export(x,"go",()=>target)},{}],"barrel":[function(q,m,x){q("helper").exportAll(q("leaf"),x)},{}],"cjs":[function(q,m,x){m.exports=function commonTarget(){}},{}],"entry":[function(q,m,x){const lib=q("barrel"),common=q("helper").interopDefault(q("cjs"));function caller(){lib.go()}function commonCaller(){common.default()}},{}]}`));
 assert(a.edge('caller','target'));assert(a.edge('commonCaller','commonTarget'));assert.equal(a.m.moduleGraph.modules.length,5);
});
test('exportAll does not manufacture a default export',()=>{
 const a=analyze(bundle(`{${helpers},"leaf":[function(q,m,x){x.go=function target(){};x.default=function hidden(){}},{}],"entry":[function(q,m,x){q("helper").exportAll(q("leaf"),x);function caller(){x.default()}},{}]}`));assert(!a.edge('caller','hidden'));
});
test('request maps remain local to their module and disabled/missing imports stay unresolved',()=>{
 const a=analyze(bundle(`{"lib":[function(q,m,x){x.go=function target(){}},{}],"first":[function(q,m,x){const lib=q("alias");function caller(){lib.go()}},{"alias":"lib"}],"entry":[function(q,m,x){const missing=q("alias"),off=q("disabled");function wrong(){missing.go();off.go()}},{"alias":"absent","disabled":false}]}`));
 assert(a.edge('caller','target'));assert(!a.edge('wrong','target'));assert(a.m.moduleGraph.dependencies.some(e=>e.toModule.endsWith(':absent')&&e.status==='not-supplied'));assert(!a.m.moduleGraph.dependencies.some(e=>e.toModule.endsWith(':disabled')));
});
test('separate Parcel registries with the same IDs never share exports',()=>{
 const a=analyze(bundle(`{"lib":[function(q,m,x){x.go=function one(){}},{}],"entry":[function(q,m,x){const lib=q("lib");function first(){lib.go()}},{}]}`,{registry:'parcelRequireOne'}),bundle(`{"lib":[function(q,m,x){x.go=function two(){}},{}],"entry":[function(q,m,x){const lib=q("lib");function second(){lib.go()}},{}]}`,{registry:'parcelRequireTwo'}));
 assert(a.edge('first','one'));assert(a.edge('second','two'));assert(!a.edge('first','two'));assert(!a.edge('second','one'));
});
test('same registry supports supplied cross-chunk modules and scoped local maps',()=>{
 const a=analyze(bundle(`{"lib":[function(q,m,x){x.go=function target(){}},{}],"entry":[function(q,m,x){},{}]}`),bundle(`{"entry":[function(q,m,x){const lib=q("./lib");function caller(){lib.go()}},{"./lib":"lib"}]}`));assert(a.edge('caller','target'));
});
test('ordinary tuple data without the Parcel loader marker is not a Parcel registration',()=>{
 const a=analyze(bundle(`{"entry":[function(q,m,x){x.go=function target(){}},{}]}`,{marker:false}));assert.equal(a.m.moduleGraph.modules.length,0);
});

test('the same Parcel property name under different global hosts stays isolated',()=>{
 const first=bundle(`{"lib":[function(q,m,x){x.go=function one(){}},{}],"entry":[function(q,m,x){const lib=q("lib");function first(){lib.go()}},{}]}`,{host:'globalThis.scopeOne'});
 const second=bundle(`{"lib":[function(q,m,x){x.go=function two(){}},{}],"entry":[function(q,m,x){const lib=q("lib");function second(){lib.go()}},{}]}`,{host:'globalThis.scopeTwo'});
 const a=analyze(first,second);assert(a.edge('first','one'));assert(a.edge('second','two'));assert(!a.edge('first','two'));assert(!a.edge('second','one'));
});
test('a computed public loader name comes from the immediate bootstrap argument',()=>{
 const code=bundle(`{"lib":[function(q,m,x){x.go=function target(){}},{}],"entry":[function(q,m,x){const lib=q("alias");function caller(){lib.go()}},{"alias":"lib"}]}`)
 .replace('(entries,cache,roots)','(entries,cache,roots,publicName)').replace('host.parcelRequireRenamed=load','host[publicName]=load').replace('},["entry"])','},["entry"],"parcelRequireRenamed")');
 const a=analyze(code);assert(a.edge('caller','target'));assert(a.m.moduleGraph.modules.every(m=>m.key.includes('global.parcelRequireRenamed')));
});
