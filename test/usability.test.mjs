import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {extractFeatures} from '../components/pog/index.mjs';
import {discoverJavaScript,referenceManifest,buildCatalog,identifyCatalog,prepareInputs,fetchReference} from '../src/workflow/inputs.mjs';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'recall-usability-'));
const example=new URL('../examples/minimal/',import.meta.url);
test('directory discovery and catalog reproduce manifest identification',async()=>{
 const source=extractFeatures(fileURLToPath(new URL('source.json',example))),bundle=extractFeatures(discoverJavaScript(fileURLToPath(new URL('bundle',example))));
 const catalog=buildCatalog(source);assert.equal(identifyCatalog(catalog,bundle,{minAnchors:1})[0].detected,true);
 const prepared=await prepareInputs({captured:fileURLToPath(new URL('bundle',example)),catalog,recovery:{minAnchors:1},inputs:{offline:true}});
 assert.equal(prepared.source.functions.length,source.functions.length);assert.equal(prepared.catalogSelection.libraries[0].detected,true);
 const directory=temp();fs.writeFileSync(path.join(directory,'file.js'),'function f(){}');fs.symlinkSync(fileURLToPath(new URL('bundle',example)),path.join(directory,'linked'));
 assert.equal(discoverJavaScript(directory).files.length,1);assert.throws(()=>discoverJavaScript(directory,{maxFiles:0}),/maxFiles/);
});
test('versioned local references require no handwritten manifest',()=>{
 const root=temp();fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0'}));fs.writeFileSync(path.join(root,'main.js'),'export function f(){}');
 assert.equal(extractFeatures(referenceManifest(root)).functions[0].library.name,'fixture');
});
test('npm reference fetching verifies archives and supports offline reuse without executing scripts',async t=>{
 const fixture=temp(),directory=path.join(fixture,'package');fs.mkdirSync(directory);
 fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0',scripts:{install:'exit 99'}}));fs.writeFileSync(path.join(directory,'index.js'),'function f(){}');
 const archive=execFileSync('tar',['-czf','-','package'],{cwd:fixture,env:{...process.env,COPYFILE_DISABLE:'1'}}),integrity='sha512-'+crypto.createHash('sha512').update(archive).digest('base64');
 let requests=0,url;
 const server=http.createServer((req,res)=>{requests++;if(req.url==='/fixture/1.0.0'){res.setHeader('content-type','application/json');res.end(JSON.stringify({name:'fixture',version:'1.0.0',dist:{integrity,tarball:url+'/archive.tgz'}}))}else res.end(archive)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));url=`http://127.0.0.1:${server.address().port}`;
 const options={registry:url,cacheDir:path.join(fixture,'cache')},library={name:'fixture',version:'1.0.0'};
 const source=await fetchReference(library,options);assert(fs.existsSync(path.join(source,'index.js')));assert.equal(requests,2);
 assert.equal(await fetchReference(library,{...options,offline:true}),source);assert.equal(requests,2);
 fs.writeFileSync(path.join(source,'index.js'),'changed');await assert.rejects(fetchReference(library,{...options,offline:true}),/Modified/);
 await assert.rejects(fetchReference({name:'fixture',version:'2.0.0'},{...options,offline:true}),/offline/);
});

test('canonical configuration is strict and paths are relative to its file',async()=>{
 const {normalizeConfig}=await import('../src/config.mjs');
 assert.throws(()=>normalizeConfig({recovery:{topk:9}}),/Unknown/);
 assert.throws(()=>normalizeConfig({graph:{useModules:'false'}}),/Boolean/);
 assert.throws(()=>normalizeConfig({models:{think:false}}),/Unknown/);
 assert.equal(normalizeConfig().recovery.libraryGate,true);
 assert.equal(normalizeConfig({inputs:{catalog:'catalog.json'}},{baseDir:'/tmp/project'}).inputs.catalog,'/tmp/project/catalog.json');
});
test('syntax-only project, in-memory analysis, and serialized replay preserve common identities and edges',async()=>{
 const {createProject}=await import('../src/project.mjs'),{addFeatures}=await import('../components/pog/index.mjs'),{resolveModules}=await import('../components/modules/index.mjs'),{buildGraph}=await import('../components/graph/index.mjs');
 const project=createProject(fileURLToPath(new URL('source.json',example)));assert(project.functions.every(f=>f.pogHash===null));
 assert.deepEqual(addFeatures(project).functions.map(f=>f.id),project.functions.map(f=>f.id));
 const map=resolveModules(project),memory=buildGraph(project,{moduleMap:map}),replay=buildGraph(project,{moduleMap:JSON.parse(JSON.stringify(map))});
 assert.deepEqual(memory.edges,replay.edges);assert.equal(map.moduleGraph.schema,'recall.module-ir/v1');assert(map.moduleGraph.bindings.some(b=>b.importedName==='helper'));
});
test('adapter contract rejects malformed third-party registration output',async()=>{
 const {recognize}=await import('../src/engine/recognize.mjs'),{recognitionInput}=await import('../components/bundler/index.mjs');
 const unit={id:'test',code:'function f(){}',path:'/tmp/test.js'};
 assert.throws(()=>recognize(recognitionInput(unit),{adapters:[{id:'bad',apply(c){c.registrations.push({kind:'magic'})}}]}),/invalid module registration/);
});

test('checkpoint continuation matches uninterrupted recovery and rejects incompatible graphs/settings/models',async()=>{
 const {preparePipeline,recoverFunctions}=await import('../components/pipeline/index.mjs');
 const source=extractFeatures(fileURLToPath(new URL('source.json',example))),bundle=extractFeatures(fileURLToPath(new URL('bundle.json',example))),config={recovery:{minAnchors:1},graph:{siblingWindow:0,includeContainment:false}},p=preparePipeline({source,bundle,config});
 const model=()=>({config:{provider:'fixture'},modelDigests:{validation:'same'},async metadata(){return this.modelDigests},async embed(xs){return xs.map(()=>[1,1])},async validate({source,bundle}){return {verdict:/function h\(/.test(bundle.code)&&/function helper\(/.test(source.code)?'accept':'reject'}}});
 const first=await recoverFunctions({source,bundle,...p,config:{...p.options,maxValidationCalls:1},models:model()});assert.equal(first.status,'budget-exhausted');
 const resumed=await recoverFunctions({source,bundle,...p,config:p.options,models:model(),resume:JSON.parse(JSON.stringify(first))});
 const complete=await recoverFunctions({source,bundle,...p,config:p.options,models:model()});
 assert.deepEqual(resumed.promotions.map(x=>[x.sourceId,x.bundleId]),complete.promotions.map(x=>[x.sourceId,x.bundleId]));assert.equal(resumed.stats.validationCalls,complete.stats.validationCalls);
 await assert.rejects(recoverFunctions({source,bundle,...p,config:{...p.options,topK:1},models:model(),resume:first}),/settings changed/);
 const changed=model();changed.modelDigests={validation:'different'};await assert.rejects(recoverFunctions({source,bundle,...p,config:p.options,models:changed,resume:first}),/digests changed/);
});
test('prepared runs resume static artifacts, preflight is read-only, and changed input is refused',async()=>{
 const {runDirectory}=await import('../src/workflow/run.mjs'),{preflight}=await import('../src/workflow/preflight.mjs');
 const directory=temp(),captured=path.join(directory,'capture');fs.mkdirSync(captured);fs.copyFileSync(new URL('bundle/app.js',example),path.join(captured,'app.js'));
 const output=path.join(directory,'out'),input={captured,sourceManifest:fileURLToPath(new URL('source.json',example)),output,config:{recovery:{minAnchors:1}},prepareOnly:true};
 assert.equal((await preflight(input)).status,'ready');assert(!fs.existsSync(output));
 await runDirectory(input);const before=fs.statSync(path.join(output,'sourceGraph.json')).mtimeMs;
 await runDirectory({...input,resume:true});assert.equal(fs.statSync(path.join(output,'sourceGraph.json')).mtimeMs,before);
 fs.appendFileSync(path.join(captured,'app.js'),'\nfunction added(){}');await assert.rejects(runDirectory({...input,resume:true}),/input files changed/);
});

test('directory CLI completes budget-limited recovery, resumes, exports identities, and skips completed inference',async t=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),run=promisify(execFile);
 let chats=0;
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const p of req)raw+=p;const body=raw?JSON.parse(raw):null;res.setHeader('content-type','application/json');
  if(req.url==='/api/tags')res.end(JSON.stringify({models:[{name:'embed:test',digest:'embedding'},{name:'validate:test',digest:'validator'}]}));
  else if(req.url==='/api/embed')res.end(JSON.stringify({embeddings:body.input.map(()=>[1,1])}));
  else {chats++;const pair=JSON.parse(body.messages[1].content);res.end(JSON.stringify({message:{content:/function h\(/.test(pair.bundled_function)&&/function helper\(/.test(pair.source_function)?'T':'F'}}))}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const root=fileURLToPath(new URL('../',import.meta.url)),directory=temp(),configFile=path.join(directory,'recall.json'),output=path.join(directory,'out');
 fs.writeFileSync(configFile,JSON.stringify({recovery:{minAnchors:1},graph:{siblingWindow:0,includeContainment:false},models:{endpoint:`http://127.0.0.1:${server.address().port}`,embeddingModel:'embed:test',validationModel:'validate:test'}}));
 const args=['bin/recall.mjs','recover',fileURLToPath(new URL('bundle',example)),'--references',fileURLToPath(new URL('source',example)),'--config',configFile,'--out',output];
 await run(process.execPath,[...args,'--max-validation-calls','1'],{cwd:root});assert.equal(JSON.parse(fs.readFileSync(path.join(output,'status.json'))).status,'budget-exhausted');
 await run(process.execPath,[...args,'--resume','--max-validation-calls','10'],{cwd:root});
 const summary=JSON.parse(fs.readFileSync(path.join(output,'summary.json'))),mapping=JSON.parse(fs.readFileSync(path.join(output,'recovered-functions.json')));
 assert.equal(summary.status,'fixed-point');assert.equal(summary.accuracy,null);assert(mapping.functions.some(f=>f.source.name==='helper'&&f.source.library.name==='example-library'));assert.equal(summary.validationCalls,2);
 const previous=chats;await run(process.execPath,[...args,'--resume','--max-validation-calls','10'],{cwd:root});assert.equal(chats,previous);
 const help=await run(process.execPath,['bin/recall.mjs','graph','--help'],{cwd:root});assert(help.stdout.startsWith('graph --inventory'));assert(!fs.existsSync(path.join(output,'.recall.lock')));
});
test('reference archive reader rejects links and traversal',async()=>{
 const {extractPackageArchive}=await import('../src/workflow/inputs.mjs');const directory=temp(),pkg=path.join(directory,'package');fs.mkdirSync(pkg);fs.symlinkSync('/tmp',path.join(pkg,'link'));
 const archive=execFileSync('tar',['-czf','-','package'],{cwd:directory,env:{...process.env,COPYFILE_DISABLE:'1'}});
 assert.throws(()=>extractPackageArchive(archive,path.join(directory,'target')),/links and special files/);
});
