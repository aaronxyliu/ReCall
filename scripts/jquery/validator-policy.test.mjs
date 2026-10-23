import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDecision,parseValidationResult} from './validator-policy.mjs';
test('only literal JSON booleans become pair decisions',()=>{
 assert.deepEqual(parseDecision('true'),{decision:true,verdict:'accept'});
 assert.deepEqual(parseDecision('false'),{decision:false,verdict:'reject'});
 for(const invalid of ['"false"','"uncertain"','null','{}','1','', 'true because similar'])assert.deepEqual(parseDecision(invalid),{decision:null,verdict:'invalid'});
});
test('v7 requires an explanation for false and an empty explanation for true',()=>{
 assert.deepEqual(parseValidationResult('{"equivalent":false,"explanation":"Different return value."}'),{decision:false,verdict:'reject',explanation:'Different return value.'});
 assert.deepEqual(parseValidationResult('{"equivalent":true,"explanation":""}'),{decision:true,verdict:'accept',explanation:''});
 for(const invalid of ['false','{"equivalent":false,"explanation":""}','{"equivalent":false,"explanation":"  "}','{"equivalent":true}','{"equivalent":"false","explanation":"different"}'])assert.equal(parseValidationResult(invalid).verdict,'invalid');
});
