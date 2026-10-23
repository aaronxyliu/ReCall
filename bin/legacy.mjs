#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [command,...args]=process.argv.slice(2);
if(!command||['--help','-h','help'].includes(command)){
 console.log(`ReCall - Function Recovery for Bundled JavaScript

  node bin/recall.mjs graph MANIFEST.json RELATIONSHIPS.json
  node bin/recall.mjs recover --input DETECTOR.json --out OUTPUT_DIR
      [--validator MODEL] [--ollama URL]

graph builds static module/function relationships without models or source maps.
recover runs the existing model pipeline on a prepared function inventory.
Defaults: qwen3.5:27b validation, qwen3-embedding:0.6b ranking, thinking off, T/F.
It requires an available Ollama-compatible endpoint and installed models.

The graph extension and legacy model recovery remain separate entry points.
Automatic webpage capture, library/version detection, and npm retrieval are
research workflow stages, not implemented by this packaging command.`);
 process.exit(0);
}
let script,env={...process.env},childArgs=[];
if(command==='graph'){
 if(args.length!==2)throw Error('graph requires MANIFEST.json and a new RELATIONSHIPS.json path');
 script=path.join(root,'scripts/real-app/bundle-graph-v2/analyze.mjs');
 childArgs=args.map(p=>path.resolve(p));
}else if(command==='recover'){
 const options={};
 for(let i=0;i<args.length;i+=2){
  if(!['--input','--out','--validator','--ollama'].includes(args[i])||!args[i+1])throw Error('Invalid recover option: '+args[i]);
  if(options[args[i]])throw Error('Duplicate option: '+args[i]);
  options[args[i]]=args[i+1];
 }
 if(!options['--input']||!options['--out'])throw Error('recover requires --input and --out');
 const input=path.resolve(options['--input']),out=path.resolve(options['--out']);
 const bytes=fs.readFileSync(input),inventory=JSON.parse(bytes);
 if(!Array.isArray(inventory.sources)||!Array.isArray(inventory.bundles))throw Error('Expected a prepared sources/bundles function inventory');
 fs.mkdirSync(out,{recursive:true});
 const dest=path.join(out,'detector-input.json');
 if(fs.existsSync(dest)){
  if(!fs.readFileSync(dest).equals(bytes))throw Error('Output contains a different inventory; select a new directory');
 }else fs.writeFileSync(dest,bytes,{flag:'wx'});
 env.EXPERIMENT_OUTPUT=out;
 env.PROMOTION_POLICY='first-positive';
 if(options['--validator'])env.VALIDATOR_MODEL=options['--validator'];
 if(options['--ollama'])env.OLLAMA_URL=options['--ollama'];
 script=path.join(root,'scripts/jquery/recover.mjs');
}else throw Error('Unknown command: '+command+'; use --help');
const r=spawnSync(process.execPath,['--expose-gc','--max-old-space-size=8192',script,...childArgs],{env,stdio:'inherit'});
if(r.error)throw r.error;
process.exit(r.status??1);
