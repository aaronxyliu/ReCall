import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceVariableKeys,mappingPrompt,mappingSchema,parseMappingResult} from './variable-mapping-policy.mjs';
test('extracts variables from nested functions and captures without property names',()=>{
 const rows=sourceVariableKeys('function(name,props){jQuery.fn[name]=function(speed,easing,callback){return this.animate(props,speed,easing,callback)}}');
 assert.deepEqual(rows.map(x=>x.key),['name','props','jQuery','speed','easing','callback']);
});
test('distinguishes shadowed bindings and preserves shared captures',()=>{
 const rows=sourceVariableKeys('function(x){var y=x;return function(x){return x+y+free}}');
 assert.deepEqual(rows.map(x=>x.key),['f0.x','y','f1.x','free']);
});
test('requires complete variable mappings, valid decisions, and rejection explanations',()=>{
 const keys=['x','captured'];
 assert.equal(parseMappingResult('{"variable_mapping":{"x":"e","captured":null},"equivalent":true,"explanation":""}',keys).verdict,'accept');
 assert.equal(parseMappingResult('{"variable_mapping":{"x":"e"},"equivalent":true,"explanation":""}',keys).verdict,'invalid');
 assert.equal(parseMappingResult('{"variable_mapping":{"x":"e","captured":"t"},"equivalent":false,"explanation":""}',keys).verdict,'invalid');
 assert.deepEqual(mappingSchema(keys).properties.variable_mapping.required,keys);
 assert.ok(mappingPrompt(keys).endsWith('Required source keys: x, captured.'));
});
test('active mapping-only response rejects explanations, incomplete mappings, and non-Boolean verdicts',async()=>{
 const {mappingOnlyPrompt,mappingOnlySchema,parseMappingOnlyResult}=await import('./variable-mapping-policy.mjs');
 const keys=['x','captured'];
 assert.deepEqual(mappingOnlySchema(keys).required,['variable_mapping','equivalent']);
 assert.ok(!mappingOnlyPrompt(keys).includes('"explanation"'));
 assert.equal(parseMappingOnlyResult('{"variable_mapping":{"x":"e","captured":null},"equivalent":true}',keys).verdict,'accept');
 for(const content of ['{"variable_mapping":{"x":"e"},"equivalent":true}','{"variable_mapping":{"x":"e","captured":"t"},"equivalent":"true"}','{"variable_mapping":{"x":"e","captured":"t"},"equivalent":true,"explanation":""}'])assert.equal(parseMappingOnlyResult(content,keys).verdict,'invalid');
});
test('diagnostic requires an explanation for both true and false without changing active policy',async()=>{
 const {mappingExplainAllPrompt,parseMappingExplainAllResult,mappingOnlyPrompt}=await import('./variable-mapping-policy.mjs');
 for(const equivalent of [true,false]){
  const value={variable_mapping:{x:'e'},equivalent,explanation:'The return values differ.'};
  assert.equal(parseMappingExplainAllResult(JSON.stringify(value),['x']).decision,equivalent);
  value.explanation='';assert.equal(parseMappingExplainAllResult(JSON.stringify(value),['x']).verdict,'invalid');
 }
 assert.ok(mappingExplainAllPrompt(['x']).includes('Always provide a nonempty explanation'));
 assert.ok(!mappingExplainAllPrompt(['x']).includes('For true, explanation must be ""'));
 assert.ok(mappingOnlyPrompt(['x']).includes('Do not output an explanation.'));
});
test('T/F diagnostic accepts only the requested single uppercase character',async()=>{
 const {parseTFVerdict,verdictOnlyTFPrompt,mappingExplainAllPrompt}=await import('./variable-mapping-policy.mjs');
 assert.equal(parseTFVerdict('T').decision,true);assert.equal(parseTFVerdict('F\n').decision,false);
 for(const content of ['true','false','"T"','t','T because they match',''])assert.equal(parseTFVerdict(content).verdict,'invalid');
 const prompt=verdictOnlyTFPrompt(mappingExplainAllPrompt(['x']));
 assert.ok(prompt.includes('Output exactly one uppercase character'));
 assert.ok(prompt.endsWith('Required source keys: x.'));assert.ok(!prompt.includes('"explanation"'));
});
