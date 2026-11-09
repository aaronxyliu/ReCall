import {test} from 'node:test';
import assert from 'node:assert/strict';
import {astMatch} from '../src/analysis/ast-match.mjs';
import {createModelClient} from '../components/pipeline/models.mjs';

test('allows consistent external renaming without binding verification',()=>{
 assert(astMatch('function f(a){left(a,0)}','function g(b){right(b,0)}'));
 assert(astMatch('function lazy(x){return kind(x)===LAZY}','function memo(y){return type(y)===MEMO}'));
});
test('preserves external reuse, local scope, properties and constants',()=>{
 assert(!astMatch('function(x){return a(x)+a(x)}','function(y){return b(y)+c(y)}'));
 assert(!astMatch('function(x){return a(x)+b(x)}','function(y){return c(y)+c(y)}'));
 assert(!astMatch('function(x){return function(y){return x+y}}','function(a){return function(b){return b+b}}'));
 assert(!astMatch('function(x){return ext+x}','function(z){return z+z}'));
 assert(!astMatch('function(x){return x.left}','function(y){return y.right}'));
 assert(!astMatch('function(x){return x+1}','function(y){return y+2}'));
 assert(!astMatch('function(x){return {left:x}}','function(y){return {right:y}}'));
});
test('dynamic scope and unsupported input fall through',()=>{
 assert(!astMatch('function(x){return eval(x)}','function(y){return eval(y)}'));
 assert(!astMatch('invalid syntax','function(){}'));
});
test('AST acceptance bypasses HTTP; mismatch invokes model with separate provenance',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url)=>{calls++;return {ok:true,json:async()=>url.endsWith('/tags')?{models:[{name:'qwen3-embedding:0.6b',digest:'e'},{name:'qwen3.5:27b',digest:'v'}]}:{message:{content:'F'}}};};
 try{
  const client=createModelClient({astFirst:true});
  const accepted=await client.validate({source:{code:'function(x){return x+1}'},bundle:{code:'function(y){return y+1}'}});
  assert.equal(accepted.validator,'ast');assert.equal(calls,0);assert.equal(client.stats.astAccepted,1);
  const rejected=await client.validate({source:{code:'function(x){return x+1}'},bundle:{code:'function(y){return y+2}'}});
  assert.equal(rejected.validator,'model');assert.equal(rejected.verdict,'reject');assert.equal(client.stats.validationRequests,1);assert.equal(client.stats.astChecks,2);assert.equal(calls,2);
 }finally{globalThis.fetch=previous;}
});
