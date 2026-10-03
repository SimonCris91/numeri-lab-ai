import test from 'node:test';import assert from 'node:assert/strict';import {aspectBin} from './superenalotto-astronomy.mjs';
test('Lotto protocol basics',()=>{assert.equal(aspectBin(359,1),0);assert.equal([1,2,3,4,5].length,5);});
