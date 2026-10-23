import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {extractFeatures,identifyAnchors,identifyLibraries} from '../components/pog/index.mjs';
import {identifyBundler} from '../components/bundler/index.mjs';
import {resolveModules} from '../components/modules/index.mjs';
import {buildGraph} from '../components/graph/index.mjs';
import {runPipeline,preparePipeline,recoverFunctions} from '../components/pipeline/index.mjs';
import {createModelClient,cosine} from '../components/pipeline/models.mjs';
import {inventoryDigest} from '../src/shared/artifacts.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),example=path.join(root,'examples/minimal');
const inputs=()=>({source:extractFeatures(path.join(example,'source.json')),bundle:extractFeatures(path.join(example,'bundle.json'))});
const config={recovery:{minAnchors:1},graph:{siblingWindow:0,includeContainment:false}};
const mock=()=>({config:{provider:'deterministic-test'},async embed(xs){return xs.map(()=>[1,1])},async validate({source,bundle}){return {verdict:/function h\(/.test(bundle.code)&&/function helper\(/.test(source.code)?'accept':'reject'}}});

test('POG inventory preserves own-body counting and establishes one exact anchor',()=>{
 const {source,bundle}=inputs(),a=identifyAnchors(source,bundle);
 assert.equal(a.matches.length,1);assert.equal(source.functions.find(f=>f.name==='anchor').propertyOperations,10);
 assert.equal(identifyAnchors(source,bundle,{minFeatures:11}).matches.length,0);
 assert.throws(()=>identifyAnchors(source,bundle,{minFeatures:0}),/minFeatures/);
 assert.throws(()=>identifyAnchors(source,bundle,{featureMetric:'properties'}),/featureMetric/);
});
test('library identification honors required distinct anchor count and preserves versions',()=>{
 const {source,bundle}=inputs();assert.equal(identifyLibraries(source,bundle,{minAnchors:1}).libraries[0].detected,true);
 assert.equal(identifyLibraries(source,bundle,{minAnchors:2}).libraries[0].detected,false);
 const extra=structuredClone(bundle.units[0]);extra.id='second-chunk';
 const repeated=extractFeatures({files:[bundle.units[0],extra]});
 const libs=identifyLibraries(source,repeated,{minAnchors:2});assert.equal(libs.libraries[0].matchedAnchorFunctions,1);assert.equal(libs.libraries[0].detected,false);
 const versions=extractFeatures({files:[...source.units,...source.units.map(u=>({...u,id:u.id+'v2',library:{...u.library,version:'2.0.0'}}))]});
 assert.equal(identifyLibraries(versions,bundle,{minAnchors:1}).libraries.filter(x=>x.detected).length,2);
 assert.equal(identifyAnchors(versions,bundle).matches.length,0);
});
test('unparseable inputs remain diagnosed rather than fabricating features',()=>{
 const i=extractFeatures({files:[{path:'bad.js',code:'function {'}]});assert.equal(i.functions.length,0);assert.equal(i.diagnostics[0].kind,'parse-error');
});
test('bundler identification exposes ambiguity, unknown input, and explicit hints',()=>{
 const {source,bundle}=inputs();assert.deepEqual(identifyBundler(bundle).candidates,['rspack','webpack']);
 assert.equal(identifyBundler(bundle,{hint:'rspack'}).status,'user-specified');assert.equal(identifyBundler(bundle,{hint:'rspack'}).family,'rspack');
 assert.equal(identifyBundler(extractFeatures({files:[{path:'plain.js',code:'function f(){return 1}'}]})).status,'unknown');
 assert.deepEqual(identifyBundler(source).candidates,['esbuild','rolldown','rollup']);
});
test('module map survives JSON handoff and enables both source and bundled edges',()=>{
 const {source,bundle}=inputs();
 for(const i of [source,bundle]){
  const map=JSON.parse(JSON.stringify(resolveModules(i))),g=buildGraph(i,{moduleMap:map,siblingWindow:0,includeContainment:false});
  assert(g.edges.some(e=>e.kind==='call'));const local=buildGraph(i,{siblingWindow:0,includeContainment:false});assert(!local.edges.some(e=>e.kind==='call'));
 }
});
test('stale inventories, module plans, graphs, and anchors are rejected',async()=>{
 const {source,bundle}=inputs(),map=resolveModules(source),bad=structuredClone(map);bad.plans[source.units[0].id].diagnostics.push({bad:true});
 assert.throws(()=>buildGraph(source,{moduleMap:bad}),/modified module map/);
 const modified=structuredClone(source);modified.functions[0].pogHash='changed';assert.throws(()=>identifyAnchors(modified,bundle),/changed input digest/);
 const p=preparePipeline({source,bundle,config}),g=structuredClone(p.sourceGraph);g.edges=[];
 await assert.rejects(recoverFunctions({source,bundle,...p,sourceGraph:g,models:mock()}),/Modified relationship graph/);
 await assert.rejects(recoverFunctions({source,bundle,...p,config:{minFeatures:11},models:mock()}),/Anchor options disagree/);
});
test('complete pipeline recovers imported helper with model decisions and no oracle',async()=>{
 const {source,bundle}=inputs(),r=await runPipeline({source,bundle,config,models:mock()});
 const helper=source.functions.find(f=>f.name==='helper');
 assert(r.recovery.promotions.some(p=>p.sourceId===helper.id&&p.kind==='model-recovered'));
 assert.equal(r.recovery.promotions.filter(p=>p.kind==='pog-anchor').length,1);assert.equal(r.recovery.status,'fixed-point');
 const local=await runPipeline({source,bundle,config:{...config,graph:{...config.graph,useModules:false}},models:mock()});
 assert(!local.recovery.promotions.some(p=>p.sourceId===helper.id));
});
test('library gating and validation budgets are explicit terminal states',async()=>{
 const {source,bundle}=inputs();const gated=await runPipeline({source,bundle,config:{...config,recovery:{minAnchors:2}},models:mock()});
 assert.equal(gated.recovery.promotions.length,0);assert.equal(gated.recovery.stats.validationCalls,0);
 const r=await runPipeline({source,bundle,config:{...config,recovery:{minAnchors:1,maxValidationCalls:1}},models:mock()});
 assert.equal(r.recovery.status,'budget-exhausted');assert.equal(r.recovery.stats.validationCalls,1);
});
test('invalid validator output does not become a recovered identity',async()=>{
 const {source,bundle}=inputs(),m=mock();m.validate=async()=>({verdict:'invalid'});
 const r=await runPipeline({source,bundle,config,models:m});assert.equal(r.recovery.promotions.length,1);
});
test('module-aware context collection retains non-target imported helper files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recall-context-'));
 fs.writeFileSync(path.join(dir,'helper.js'),'export function identity(x){return x}');
 fs.writeFileSync(path.join(dir,'main.js'),"import {identity} from './helper.js';function target(){};function caller(){identity(target)()}");
 const i=extractFeatures({roots:[dir],files:[{path:path.join(dir,'main.js')}]});const map=resolveModules(i);
 assert(map.units.some(u=>u.contextOnly&&u.path.endsWith('helper.js')&&u.functions.length===0));
 assert.equal(buildGraph(i,{moduleMap:map}).functions.length,i.functions.length);
});
test('identical explicit source files retain separate function identities',()=>{
 const i=extractFeatures({files:[{id:'a',path:'a.js',code:'export function f(){return 1}'},{id:'b',path:'b.js',code:'export function f(){return 1}'}]});
 const map=resolveModules(i,{followDependencies:false});assert.equal(map.units.length,2);assert.equal(buildGraph(i,{moduleMap:map}).functions.length,2);
});
test('cosine rejects incompatible and non-finite vectors',()=>{
 assert.throws(()=>cosine([1],[1,2]),/dimensions/);assert.throws(()=>cosine([0],[1]),/Zero/);assert.throws(()=>cosine([NaN],[1]),/values/);
});
test('HTTP model adapter enforces settings, caches decisions, and separates deployments',async t=>{
 const calls=[],server=http.createServer(async(req,res)=>{
  let text='';for await(const c of req)text+=c;const body=text?JSON.parse(text):null;calls.push({url:req.url,body});res.setHeader('content-type','application/json');
  if(req.url==='/api/tags')res.end(JSON.stringify({models:[{name:'embed:test',digest:'e1'},{name:'validator:test',digest:'v1'}]}));
  else if(req.url==='/api/embed')res.end(JSON.stringify({embeddings:body.input.map(()=>[1,2])}));
  else res.end(JSON.stringify({message:{content:'T'},prompt_eval_count:4,eval_count:1}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const endpoint=`http://127.0.0.1:${server.address().port}`,cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'recall-cache-'));
 const opts={endpoint,embeddingModel:'embed:test',validationModel:'validator:test',cacheDir,numCtx:2048,numPredict:3,seed:7};
 const client=createModelClient(opts),pair={source:{code:'function f(){return 1}'},bundle:{code:'function a(){return 1}'},minified:'function(){return 1}'};
 assert.equal((await client.validate(pair)).verdict,'accept');await client.validate(pair);await client.embed(['code']);
 assert.equal(calls.filter(c=>c.url==='/api/chat').length,1);const request=calls.find(c=>c.url==='/api/chat').body;
 assert.equal(request.think,false);assert.equal(request.options.num_ctx,2048);assert.equal(request.options.seed,7);
 assert.equal(JSON.parse(request.messages[1].content).minified_source_function,pair.minified);
 const second=createModelClient(opts);await second.validate(pair);assert.equal(calls.filter(c=>c.url==='/api/chat').length,1);
 const changed=createModelClient({...opts,seed:8});await changed.validate(pair);assert.equal(calls.filter(c=>c.url==='/api/chat').length,2);
});
test('documented CLI preparation runs every static component and refuses overwrite',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recall-cli-')),out=path.join(dir,'prepared');
 const args=['bin/recall.mjs','run','--source-manifest','examples/minimal/source.json','--bundle-manifest','examples/minimal/bundle.json','--config','examples/minimal/config.json','--prepare-only','--out',out];
 execFileSync(process.execPath,args,{cwd:root});
 for(const f of ['source','bundle','libraries','anchors','sourceBundler','bundleBundler','sourceModules','bundleModules','sourceGraph','bundleGraph'])assert(fs.existsSync(path.join(out,f+'.json')));
 assert.equal(JSON.parse(fs.readFileSync(path.join(out,'status.json'))).status,'prepared');
 assert.throws(()=>execFileSync(process.execPath,args,{cwd:root,stdio:'pipe'}));
 assert.throws(()=>execFileSync(process.execPath,['bin/recall.mjs','bundler','--inventory',path.join(out,'bundle.json'),'--out',path.join(out,'oops.json'),'--typo','yes'],{cwd:root,stdio:'pipe'}));
});

test('complete CLI composes all five components using configured HTTP models',async t=>{
 const calls=[],server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;
  const body=raw?JSON.parse(raw):null;calls.push({url:req.url,body});res.setHeader('content-type','application/json');
  if(req.url==='/api/tags')res.end(JSON.stringify({models:[{name:'embed:test',digest:'e1'},{name:'validator:test',digest:'v1'}]}));
  else if(req.url==='/api/embed')res.end(JSON.stringify({embeddings:body.input.map(()=>[1,1])}));
  else {const pair=JSON.parse(body.messages[1].content);res.end(JSON.stringify({message:{content:/function h\(/.test(pair.bundled_function)&&/function helper\(/.test(pair.source_function)?'T':'F'}}))}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recall-full-cli-')),out=path.join(dir,'run'),cfg=path.join(dir,'config.json');
 fs.writeFileSync(cfg,JSON.stringify({...config,models:{endpoint:`http://127.0.0.1:${server.address().port}`,embeddingModel:'embed:test',validationModel:'validator:test',thinking:false}}));
 await promisify(execFile)(process.execPath,['bin/recall.mjs','run','--source-manifest','examples/minimal/source.json','--bundle-manifest','examples/minimal/bundle.json','--config',cfg,'--out',out],{cwd:root});
 const result=JSON.parse(fs.readFileSync(path.join(out,'recovery.json')));
 assert(result.promotions.some(p=>p.kind==='model-recovered'));
 assert.equal(result.status,'fixed-point');assert(calls.some(c=>c.url==='/api/embed'));assert(calls.some(c=>c.url==='/api/chat'&&c.body.think===false));
 const recoveryOnly=path.join(dir,'recovery-only.json');
 await promisify(execFile)(process.execPath,['bin/recall.mjs','recover','--source',path.join(out,'source.json'),'--bundle',path.join(out,'bundle.json'),'--source-graph',path.join(out,'sourceGraph.json'),'--bundle-graph',path.join(out,'bundleGraph.json'),'--anchors',path.join(out,'anchors.json'),'--libraries',path.join(out,'libraries.json'),'--library-gate','true','--config',cfg,'--out',recoveryOnly],{cwd:root});
 const standalone=JSON.parse(fs.readFileSync(recoveryOnly));
 assert.deepEqual(standalone.promotions.map(p=>[p.sourceId,p.bundleId]),result.promotions.map(p=>[p.sourceId,p.bundleId]));
});
test('resource limits account for identical explicit files independently',()=>{
 const i=extractFeatures({files:[{id:'a',path:'a.js',code:'function f(){}'},{id:'b',path:'b.js',code:'function f(){}'}]});
 assert.throws(()=>resolveModules(i,{maxFiles:1,followDependencies:false}),/maxFiles/);
});

test('library artifacts preserve zero-evidence candidates and reject incompatible gating thresholds',async()=>{
 const {source,bundle}=inputs();const zero=identifyLibraries(source,bundle,{minFeatures:100,minAnchors:1});
 assert.equal(zero.libraries.length,1);assert.equal(zero.libraries[0].matchedAnchorFunctions,0);assert.equal(zero.libraries[0].detected,false);
 const p=preparePipeline({source,bundle,config});
 await assert.rejects(recoverFunctions({source,bundle,...p,config:{libraryGate:true,minAnchors:2},models:mock()}),/Library options disagree/);
});
const protocols={
 rspack:`(self['rspackChunkdemo']=[]).push([[1],{17:(m,x,q)=>{function target(){}q.d(x,{go:()=>target})},23:(m,x,q)=>{var lib=q(17);function caller(){lib.go()}}}])`,
 turbopack:`(globalThis.TURBOPACK||=[]).push([0,1,e=>{function target(){}e.s(['go',0,target])},2,e=>{const ns=e.i(1);function caller(){ns.go()}}])`,
 parcel:`var loader=globalThis.parcelRequire123;loader.register('one',(m,x)=>{function target(){}x.go=target});loader.register('two',(m,x)=>{let y=loader('one');function caller(){y.go()}})`,
 rolldown:`var lazy=(e,t)=>()=>(t||(e((t={exports:{}}).exports,t),e=null),t.exports);var req=lazy((x,m)=>{function target(){}m.exports={go:target}});function caller(){req().go()}`
};
for(const [family,code]of Object.entries(protocols))test(family+' module plans preserve imported call edges through standalone JSON handoff',()=>{
 const i=extractFeatures({files:[{path:family+'.js',code}]}),map=JSON.parse(JSON.stringify(resolveModules(i,{followDependencies:false}))),g=buildGraph(i,{moduleMap:map,siblingWindow:0,includeContainment:false});
 const caller=i.functions.find(f=>f.name==='caller'),target=i.functions.find(f=>f.name==='target');
 assert(g.edges.some(e=>e.from===caller.id&&e.to===target.id&&e.kind==='call'));
});
test('cross-chunk propagation is opt-in while per-chunk source identities are reusable',async()=>{
 const source=inputs().source,bundle=extractFeatures({files:[
 {id:'helper-chunk',path:'helper-chunk.js',code:'(self.example=[]).push([[0],{0:(m,x,r)=>{x.helper=function h(y){return y.value+1}}}])'},
 {id:'anchor-chunk',path:'anchor-chunk.js',code:'(self.example=[]).push([[1],{1:(m,x,r)=>{const h=r(0).helper;function a(y){y.a;y.b;y.c;y.d;y.e;y.f;y.g;y.h;y.i;y.j;return h(y)}x.anchor=a}}])'}]});
 const helper=source.functions.find(f=>f.name==='helper');
 const local=await runPipeline({source,bundle,config,models:mock()});
 assert(!local.recovery.promotions.some(p=>p.sourceId===helper.id));
 const enabled=await runPipeline({source,bundle,config:{...config,recovery:{minAnchors:1,crossChunk:true}},models:mock()});
 assert(enabled.recovery.promotions.some(p=>p.sourceId===helper.id&&p.kind==='model-recovered'));
 const repeats=extractFeatures({files:[...bundle.units,...bundle.units.map(u=>({...u,id:u.id+'-copy',environment:'copy'}))]});
 assert.equal(identifyAnchors(source,repeats).matches.length,2);
});

test('external connectivity selector uses the same neighborhoods without models or minification gates',async()=>{
 const {source,bundle}=inputs(),prepared=preparePipeline({source,bundle,config}),helper=source.functions.find(f=>f.name==='helper'),h=bundle.functions.find(f=>f.name==='h');
 let selections=0;
 const r=await recoverFunctions({source,bundle,...prepared,config:{...prepared.options,topK:1},models:{async embed(){throw Error('Embedding forbidden')},async validate(){throw Error('Validation forbidden')}},candidateSelector:({bundle,candidates})=>{selections++;return bundle.id===h.id&&candidates.some(s=>s.id===helper.id)?helper.id:null}});
 assert(r.promotions.some(p=>p.sourceId===helper.id&&p.kind==='externally-selected'));assert(selections>0);assert.equal(r.selectionMode,'external-neighborhood-selector');assert.equal(r.stats.validationCalls,0);assert.equal(r.stats.embeddingFunctions,0);assert.equal(r.stats.model.requests,0);
});
test('external selector cannot introduce a match outside the candidate neighborhood',async()=>{
 const {source,bundle}=inputs(),prepared=preparePipeline({source,bundle,config});
 await assert.rejects(recoverFunctions({source,bundle,...prepared,config:prepared.options,candidateSelector:()=> 'not-a-candidate'}),/outside the neighborhood/);
});
