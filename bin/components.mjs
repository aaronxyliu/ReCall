import {importPageFetch} from '../components/capture/index.mjs';
import {runDirectory} from '../src/workflow/run.mjs';
import {preflight} from '../src/workflow/preflight.mjs';
import {createProject} from '../src/project.mjs';
import {discoverJavaScript} from '../src/workflow/inputs.mjs';
import {normalizeConfig} from '../src/config.mjs';
import {buildCatalog,referenceManifest} from '../src/workflow/inputs.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {extractFeatures,identifyAnchors,identifyLibraries} from '../components/pog/index.mjs';
import {identifyBundler} from '../components/bundler/index.mjs';
import {resolveModules} from '../components/modules/index.mjs';
import {buildGraph} from '../components/graph/index.mjs';
import {recoverFunctions} from '../components/pipeline/index.mjs';
import {readJSON,writeJSON} from '../src/shared/artifacts.mjs';

const help=`ReCall — recover library function identities from captured JavaScript

Start:
  recall recover CAPTURED_DIRECTORY --references LOCAL_PACKAGES --out DIRECTORY
  recall recover CAPTURED_DIRECTORY --catalog CATALOG.json --config recall.json --out DIRECTORY
  recall preflight CAPTURED_DIRECTORY --config recall.json [--prepare-only]

Use --prepare-only for static preparation; --resume continues the same run.
Use --quiet to suppress progress. All commands accept the same nested --config.

Capture import (offline):
  recall capture import-page-fetch RAW_DIRECTORY --out DIRECTORY [--page-url URL]

Components:
  recall project --manifest FILE --out INVENTORY.json
  recall pog extract --manifest FILE --out INVENTORY.json
  recall pog anchors --source FILE --bundle FILE --out ANCHORS.json
  recall pog libraries --source FILE --bundle FILE --out LIBRARIES.json
  recall catalog build --references LOCAL_PACKAGES --out CATALOG.json
  recall bundler --inventory FILE --out BUNDLER.json [--hint FAMILY]
  recall modules --inventory FILE --out MODULES.json [--bundler FILE]
  recall graph --inventory FILE --out GRAPH.json [--module-map FILE]
  recall recover --source FILE --bundle FILE --source-graph FILE --bundle-graph FILE --out FILE
  recall run --source-manifest FILE --bundle-manifest FILE --out DIRECTORY

Use recall COMMAND --help for command-specific parameters.
Legacy graph MANIFEST OUTPUT and recover --input DETECTOR --out DIR remain available.
`;
function commandHelp(command){
 const specific={
  capture:'capture import-page-fetch RAW_DIRECTORY --out DIRECTORY [--page-url URL]\n  Imports saved responses; does not run a browser. Use a fresh output directory.',
  recover:'recover CAPTURED_DIRECTORY --references DIR | --catalog FILE --out DIR\n  --config FILE --prepare-only --resume --offline --quiet\n  Advanced: --source FILE --bundle FILE --source-graph FILE --bundle-graph FILE\n  --anchors FILE --libraries FILE --out FILE',
  run:'run --source-manifest FILE --bundle-manifest FILE --out DIR\n  --config FILE --prepare-only --resume --offline --quiet',
  preflight:'preflight CAPTURED_DIRECTORY --references DIR | --catalog FILE\n  --config FILE --prepare-only (skip model checks) --out REPORT.json (optional)',
  catalog:'catalog build --references DIR | --source-manifest FILE --out FILE',
  project:'project --manifest FILE --out FILE (syntax only, no POG generation)',
  pog:'pog extract --manifest FILE --out FILE\npog anchors | libraries --source FILE --bundle FILE --out FILE\n  --min-features N --feature-metric propertyOperations|graphNodes --min-anchors N',
  bundler:'bundler --inventory FILE | --directory DIR --out FILE [--hint FAMILY]',
  modules:'modules --inventory FILE --out FILE [--bundler FILE]',
  graph:'graph --inventory FILE --out FILE [--module-map FILE]'
 };
 if(!specific[command])throw Error('Unknown command: '+command);
 return specific[command]+'\n\nAll commands: --config FILE --overwrite (files only) --quiet\nRecovery overrides: --top-k N --radius N --min-features N --min-anchors N\n  --embedding-model NAME --validation-model NAME --endpoint URL --thinking true|false\n  --cross-chunk true|false --library-gate true|false --max-validation-calls N --cache DIR\nSee docs/quickstart.md and docs/configuration.md.';
}
export async function componentsCLI(argv){
 if(!argv.length||['--help','-h','help'].includes(argv[0])){console.log(help);return}
 if(argv.some(x=>['--help','-h'].includes(x))){console.log(commandHelp(argv[0]));return}
 let command=argv.shift();const action=['pog','catalog','capture'].includes(command)?argv.shift():null;
 const rawCapture=command==='capture'?argv.shift():null;
 const captured=['recover','preflight'].includes(command)&&argv[0]&&!argv[0].startsWith('--')?argv.shift():null;if(captured&&command==='recover')command='run';
 const boolean=new Set(['--prepare-only','--overwrite','--offline','--resume','--quiet']);const opts={};
 for(let i=0;i<argv.length;i++){
  const k=argv[i];if(!k.startsWith('--')||Object.hasOwn(opts,k))throw Error('Invalid/duplicate option: '+k);
  if(boolean.has(k))opts[k]=true;else{if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing value for '+k);opts[k]=argv[++i]}
 }
 const shared=['--out','--config','--overwrite','--quiet'];
 const recoveryFlags=['--min-features','--feature-metric','--min-anchors','--top-k','--radius','--max-validation-calls','--cross-chunk','--library-gate','--embedding-model','--validation-model','--endpoint','--thinking','--cache'];
 const allowed={capture:[...shared,'--page-url'],project:[...shared,'--manifest'],preflight:[...shared,'--source-manifest','--bundle-manifest','--references','--catalog','--prepare-only','--offline'],catalog:[...shared,'--references','--source-manifest'],pog:[...shared,'--manifest','--source','--bundle','--min-features','--feature-metric','--min-anchors'],bundler:[...shared,'--inventory','--directory','--hint'],modules:[...shared,'--inventory','--bundler'],graph:[...shared,'--inventory','--module-map'],recover:[...shared,...recoveryFlags,'--source','--bundle','--source-graph','--bundle-graph','--anchors','--libraries'],run:[...shared,...recoveryFlags,'--source-manifest','--bundle-manifest','--prepare-only','--references','--catalog','--offline','--resume']}[command];
 if(!allowed)throw Error('Unknown component command: '+command);
 for(const k of Object.keys(opts))if(!allowed.includes(k))throw Error('Unknown option for '+command+': '+k);
 const required=k=>{if(!opts[k])throw Error('Required option: '+k);return opts[k]},json=k=>readJSON(required(k));
 let config=normalizeConfig(opts['--config']?readJSON(opts['--config']):{},{baseDir:opts['--config']?path.dirname(path.resolve(opts['--config'])):process.cwd()});
 const override=(keys)=>Object.fromEntries(keys.filter(([flag])=>Object.hasOwn(opts,flag)).map(([flag,key,type])=>{
  let value=opts[flag];if(type==='number'){value=Number(value);if(!Number.isFinite(value))throw Error('Invalid number: '+flag)}
  if(type==='boolean'){if(!['true','false'].includes(value))throw Error(flag+' requires true or false');value=value==='true'}
  return [key,value];
 }));
 const features=override([['--min-features','minFeatures','number'],['--feature-metric','featureMetric'],['--min-anchors','minAnchors','number']]);
 const recovery={...config.recovery,...features,...override([['--top-k','topK','number'],['--radius','radius','number'],['--max-validation-calls','maxValidationCalls','number'],['--cross-chunk','crossChunk','boolean'],['--library-gate','libraryGate','boolean']])};
 const models={...config.models,...override([['--embedding-model','embeddingModel'],['--validation-model','validationModel'],['--endpoint','endpoint'],['--thinking','thinking','boolean'],['--cache','cacheDir']])};
 const write=(file,value)=>writeJSON(file,value,{overwrite:!!opts['--overwrite']});
 config=normalizeConfig({...config,recovery,models,inputs:{...config.inputs,...(opts['--references']?{references:path.resolve(opts['--references'])}:{}),...(opts['--catalog']?{catalog:path.resolve(opts['--catalog'])}:{}),...(opts['--offline']?{offline:true}:{})}});
 if(opts['--hint'])config.bundler.hint=opts['--hint'];
 if(opts['--quiet'])config.execution.progress=false;
 const output=opts['--out']?path.resolve(opts['--out']):command==='preflight'?null:path.resolve(required('--out'));
 if(command!=='run'&&command!=='preflight'&&!opts['--overwrite']&&fs.existsSync(output))throw Error('Output exists: '+output);
 if(command==='capture'){
  if(action!=='import-page-fetch'||!rawCapture||rawCapture.startsWith('--'))throw Error('Use capture import-page-fetch RAW_DIRECTORY --out DIRECTORY');
  const result=importPageFetch(rawCapture,{output,pageURL:opts['--page-url']||null,maxFiles:config.inputs.maxFiles,maxBytes:config.inputs.maxBytes});
  writeJSON(path.join(output,'resolved-config.json'),config);
  console.log(JSON.stringify({importedScripts:result.importedScripts,pageURL:result.pageURL,manifest:result.manifest,report:path.join(output,'capture.json')},null,2));return;
 }else if(command==='project'){write(output,createProject(required('--manifest')))}else if(command==='preflight'){
  const report=await preflight({captured,sourceManifest:opts['--source-manifest'],bundleManifest:opts['--bundle-manifest'],references:config.inputs.references,catalog:config.inputs.catalog,output,config,prepareOnly:!!opts['--prepare-only']});
  if(output)write(output,report);else console.log(JSON.stringify(report,null,2));if(report.status==='blocked')process.exitCode=1;return;
 }else if(command==='catalog'){
  if(action!=='build')throw Error('catalog requires build');
  write(output,buildCatalog(extractFeatures(opts['--source-manifest']?required('--source-manifest'):referenceManifest(config.inputs.references||required('--references'),config.inputs))));
 }else if(command==='pog'){
  if(action==='extract')write(output,extractFeatures(required('--manifest')));
  else if(action==='anchors'||action==='libraries')write(output,(action==='anchors'?identifyAnchors:identifyLibraries)(json('--source'),json('--bundle'),config.recovery));
  else throw Error('pog requires extract, anchors, or libraries');
 }else if(command==='bundler')write(output,identifyBundler(opts['--directory']?createProject(discoverJavaScript(opts['--directory'],config.inputs)):json('--inventory'),{...config.bundler,hint:opts['--hint']||config.bundler.hint}));
 else if(command==='modules')write(output,resolveModules(json('--inventory'),{...config.modules,bundler:opts['--bundler']?json('--bundler'):null}));
 else if(command==='graph')write(output,buildGraph(json('--inventory'),{...config.graph,moduleMap:opts['--module-map']?json('--module-map'):null}));
 else if(command==='recover'){
  config.models.cacheDir??=path.join(path.dirname(output),'model-cache');
  const result=await recoverFunctions({source:json('--source'),bundle:json('--bundle'),sourceGraph:json('--source-graph'),bundleGraph:json('--bundle-graph'),anchors:opts['--anchors']?json('--anchors'):null,libraries:opts['--libraries']?json('--libraries'):null,config:{...config.recovery,models:config.models}});
  write(output,result);
 }else if(command==='run'){
  const controller=new AbortController(),interrupt=()=>controller.abort(Error('Interrupted by user'));
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  let lastProgress=0,lastStage=null;
  const onProgress=config.execution.progress?event=>{if(event.stage===lastStage&&event.elapsedMs-lastProgress<5000)return;lastProgress=event.elapsedMs;lastStage=event.stage;const detail=event.recovered===undefined?'':` ${event.recovered}/${event.targets} recovered`;console.error(`[ReCall] ${event.stage}${detail} (${(event.elapsedMs/1000).toFixed(1)}s)`)}:null;
  try{await runDirectory({captured,sourceManifest:opts['--source-manifest'],bundleManifest:opts['--bundle-manifest'],output,config,prepareOnly:!!opts['--prepare-only'],resume:!!opts['--resume'],onProgress,signal:controller.signal})}
  finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt)}
 }

 if(command!=='run')write(output+'.config.json',config);
}
