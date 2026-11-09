// Bounded JSON strings keep large query histories below V8's string limit.
import fs from 'node:fs';
import {JSONParser} from '@streamparser/json';
export function* jsonChunks(value,split=false){
 if(!split&&!(Array.isArray(value)&&value.length>64)){
  try{const text=JSON.stringify(value);if(text!==undefined)yield text;return}catch(error){if(!(error instanceof RangeError)||!value||typeof value!=='object')throw error}
 }
 if(value===null||typeof value!=='object'||typeof value.toJSON==='function'){const text=JSON.stringify(value);if(text!==undefined)yield text;return}
 if(Array.isArray(value)){
  yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';const v=value[i];if(v===undefined||typeof v==='function'||typeof v==='symbol')yield 'null';else yield* jsonChunks(v)}yield ']';
 }else{
  yield '{';let first=true;for(const key of Object.keys(value)){const v=value[key];if(v===undefined||typeof v==='function'||typeof v==='symbol')continue;if(!first)yield ',';first=false;yield JSON.stringify(key)+':';yield* jsonChunks(v)}yield '}';
 }
}
export function readJSONFile(file,{streamThreshold=128*1024*1024,chunkSize=1024*1024}={}){
 if(fs.statSync(file).size<streamThreshold)return JSON.parse(fs.readFileSync(file,'utf8'));
 const parser=new JSONParser({paths:['$'],keepStack:true});let value,found=false;
 parser.onValue=r=>{value=r.value;found=true};parser.onError=error=>{throw error};
 const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(chunkSize);
 try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))parser.write(buffer.subarray(0,n));if(!parser.isEnded)parser.end();if(!found)throw Error('Incomplete JSON artifact');return value}finally{fs.closeSync(fd)}
}
export function writeJSONChunks(fd,value){
 for(const part of jsonChunks(value,true)){const bytes=Buffer.from(part);for(let offset=0;offset<bytes.length;)offset+=fs.writeSync(fd,bytes,offset,bytes.length-offset)}fs.writeSync(fd,'\n');
}
