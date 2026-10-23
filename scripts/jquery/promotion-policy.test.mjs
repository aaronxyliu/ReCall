import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldPromote,stopValidation} from './promotion-policy.mjs';
test('unique policy continues after acceptance and blocks multiple positives',()=>{
 assert.equal(stopValidation('accept','unique-positive'),false);
 assert.equal(shouldPromote(['a','b'],'unique-positive'),false);
 assert.equal(shouldPromote(['a'],'unique-positive'),true);
});
test('first positive stops only at acceptance; rejects and invalids continue',()=>{
 for(const verdict of ['reject','invalid','error'])assert.equal(stopValidation(verdict,'first-positive'),false);
 assert.equal(stopValidation('accept','first-positive'),true);
 assert.equal(shouldPromote([],'first-positive'),false);
 assert.equal(shouldPromote(['a'],'first-positive'),true);
});
