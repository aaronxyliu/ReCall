import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {hash,readJSON,writeJSON} from '../src/shared/artifacts.mjs';import {jsonChunks,readJSONFile} from '../src/shared/json.mjs';
test('chunked hashes preserve existing checkpoint digests and JSON semantics',()=>{
 for(const v of [{a:Array.from({length:200},(_,i)=>({i,s:'汉字😀\n"\\',no:undefined})),b:null,c:true},[undefined,NaN,Infinity,new Date(0)],{skip:undefined,fn:()=>{},neg:-0},null,12]){
 assert.equal([...jsonChunks(v,true)].join(''),JSON.stringify(v));assert.equal(hash(v),crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'))}
});
test('streamed artifacts round-trip across unicode/token chunk boundaries and remain atomic',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recall-json-')),file=path.join(dir,'checkpoint.json'),value={data:Array.from({length:80},(_,i)=>({i,s:'汉字😀',n:-1.25e10})),ok:true};
 try{writeJSON(file,value);assert.deepEqual(readJSON(file),value);for(const chunkSize of [1,7,128])assert.deepEqual(readJSONFile(file,{streamThreshold:0,chunkSize}),value);assert.throws(()=>writeJSON(file,{wrong:true}),/EEXIST/);assert.deepEqual(readJSON(file),value);assert.throws(()=>writeJSON(file,{x:1n},{overwrite:true}));assert.deepEqual(readJSON(file),value);assert.deepEqual(fs.readdirSync(dir),['checkpoint.json']);fs.writeFileSync(file,'{"x":[');assert.throws(()=>readJSONFile(file,{streamThreshold:0,chunkSize:1}));}finally{fs.rmSync(dir,{recursive:true,force:true})}
});
