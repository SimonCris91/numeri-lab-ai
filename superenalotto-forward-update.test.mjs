import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { advance } from './superenalotto-forward-update.mjs';

const receipt = JSON.parse(await readFile(new URL('./superenalotto-forward-update-2026-10-01.json', import.meta.url)));
const integrated = JSON.parse(receipt.before.integrated);
const baseline = JSON.parse(receipt.before.baseline);
const historical = JSON.parse(await readFile(new URL('./superenalotto-integrated-walk-forward.json', import.meta.url)));
const history = historical.rows.map(r => ({ date: r.date, numbers: r.actual }));
const draw = JSON.parse(await readFile(new URL('./superenalotto-draw-2026-10-01.json', import.meta.url)));

test('Frozen predictions scored before rolling forward; source and pending payout retained', () => {
  const updated = advance(integrated, baseline, history, draw);
  assert.equal(updated.integrated.processedDraws, 1);
  assert.equal(updated.baseline.processedDraws, 2);
  assert.deepEqual(updated.integrated.results[0].prediction, integrated.nextPrediction);
  assert.equal(updated.integrated.results[0].mainHits, 2);
  assert.equal(updated.integrated.results[0].comparators.random.mainHits, 0);
  assert.equal(updated.integrated.results[0].grossReturn, null);
  assert.deepEqual(updated.baseline.results[0], baseline.results[0]);
  assert.deepEqual(updated.integrated.model, integrated.model);
  assert.deepEqual(updated.baseline.strategy, baseline.strategy);
  assert.deepEqual(updated.integrated.nextPrediction, [7,12,16,18,28,85]);
  assert.deepEqual(updated.baseline.nextPrediction, [2,8,12,16,28,85]);
  assert.deepEqual(updated.integrated.comparators.randomBaseline.nextPrediction, [14,27,64,71,72,76]);
  assert.equal(integrated.processedDraws, 0);
});
test('Duplicate is a no-op; conflicting result rejected', () => {
  const first = advance(integrated, baseline, history, draw);
  const again = advance(first.integrated, first.baseline, [...history, draw], draw);
  assert.equal(again.alreadyProcessed, true);
  assert.deepEqual(again.integrated, first.integrated);
  assert.throws(() => advance(first.integrated, first.baseline, history, {...draw, jolly:74}), /conflitto/);
});
test('Invalid draw, changed frozen ticket, skipped contest and misaligned history rejected', () => {
  assert.throws(() => advance(integrated, baseline, history, {...draw, numbers:[5,5,28,41,56,66]}));
  assert.throws(() => advance({...integrated, nextPrediction:[1,2,3,4,5,6]}, baseline, history, draw), /congelate/);
  assert.throws(() => advance(integrated, baseline, history, {...draw, contest:159}), /consecutivo/);
  assert.throws(() => advance(integrated, baseline, history.slice(0,-1), draw), /allineate/);
});
