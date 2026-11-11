import test from 'node:test';
import assert from 'node:assert/strict';
import {neighbors, neighborhoodLookup} from '../src/analysis/neighborhood.mjs';
test('cached traversal preserves BFS order, self exclusion, cycles and eviction', () => {
  const graph = new Map([['a',new Set(['a','c','b'])],['b',new Set(['a','d'])],['c',new Set(['a','d'])],['d',new Set(['b','c'])]]);
  for (const radius of [1,2,3]) {
    const lookup = neighborhoodLookup(graph,radius,{maxEntries:2,maxMembers:4});
    for (const id of ['a','a','b','c','missing','a','d','b'])
      assert.deepEqual([...lookup(id)],[...neighbors(id,graph,radius)]);
  }
  assert.deepEqual([...neighbors('a',graph,2)],['c','b','d']);
});
test('oversized neighborhoods bypass the cache; small neighborhoods are reused', () => {
  const graph = new Map([['a',new Set(['b','c'])],['b',new Set(['a'])]]);
  const lookup = neighborhoodLookup(graph,1,{maxMembers:1});
  assert.notEqual(lookup('a'),lookup('a'));
  assert.equal(lookup('b'),lookup('b'));
});
