import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { saveExperiment } from './superenalotto-integrated-walk-forward.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'superenalotto-rerun-'));
  t.after(async () => {
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('superenalotto-rerun-'));
    await rm(directory, { recursive: true, force: true });
  });
  const paths = {
    evaluation: join(directory, 'history.json'),
    forward: join(directory, 'integrated-forward.json'),
    baselineForward: join(directory, 'baseline-forward.json'),
    rerun: join(directory, 'rerun.json'),
  };
  const model = { name: 'fixture', windows: [12, 52, 104, 208], midTestParameterChanges: false };
  const evaluation = {
    generatedAt: '2026-09-29T20:49:00Z',
    coverage: { draws: 796 },
    evaluation: { testedDraws: 588 },
    model,
    methods: [{ totalHits: 225 }],
    nextPrediction: [2, 7, 12, 18, 28, 85],
    rows: [{ date: '2026-09-29', hits: 1 }],
  };
  const forward = {
    status: 'READY', processedDraws: 0, results: [], startsAfterDrawDate: '2026-09-29',
    model, nextPrediction: evaluation.nextPrediction,
  };
  return { paths, evaluation, forward };
}

test('initialization and a repeated run preserve all three existing files byte for byte', async (t) => {
  const { paths, evaluation, forward } = await fixture(t);
  const baseline = '{"status":"ACTIVE","processedDraws":1,"results":[{"hits":1}]}\r\n';
  await writeFile(paths.baselineForward, baseline);
  const first = await saveExperiment(evaluation, forward, paths);
  assert.equal(first.integratedProtocol, 'initialized');
  const historyBefore = await readFile(paths.evaluation, 'utf8');
  const forwardBefore = await readFile(paths.forward, 'utf8');

  const repeated = await saveExperiment({ ...evaluation, generatedAt: '2026-09-30T08:00:00Z' }, forward, paths);
  assert.equal(repeated.integratedProtocol, 'preserved');
  assert.equal(repeated.historicalResultsMatch, true);
  assert.equal(await readFile(paths.evaluation, 'utf8'), historyBefore);
  assert.equal(await readFile(paths.forward, 'utf8'), forwardBefore);
  assert.equal(await readFile(paths.baselineForward, 'utf8'), baseline);
  assert.equal(repeated.fileHashes.length, 3);
  assert.ok(repeated.fileHashes.every((file) => file.sha256Before === file.sha256After));
  const report = JSON.parse(await readFile(paths.rerun, 'utf8'));
  assert.equal(report.generatedAt, '2026-09-30T08:00:00Z');
});

test('rerunning history cannot reset an already processed forward test', async (t) => {
  const { paths, evaluation, forward } = await fixture(t);
  const active = { ...forward, status: 'ACTIVE', processedDraws: 2,
    nextPrediction: [3, 13, 23, 33, 43, 53], results: [{ hits: 2 }, { hits: 0 }] };
  const original = `${JSON.stringify(active)}\n`;
  await writeFile(paths.forward, original);
  const result = await saveExperiment(evaluation, forward, paths);
  assert.equal(result.integratedProtocol, 'preserved');
  assert.equal(await readFile(paths.forward, 'utf8'), original);
});

test('changed model or initial ticket is rejected before any results are written', async (t) => {
  const { paths, evaluation, forward } = await fixture(t);
  const original = `${JSON.stringify(forward)}\n`;
  await writeFile(paths.forward, original);
  await assert.rejects(saveExperiment(evaluation,
    { ...forward, model: { ...forward.model, windows: [26, 52] } }, paths), /protocollo congelato/);
  await assert.rejects(saveExperiment(evaluation,
    { ...forward, nextPrediction: [1, 2, 3, 4, 5, 6] }, paths), /iniziale congelata/);
  assert.equal(await readFile(paths.forward, 'utf8'), original);
  await assert.rejects(readFile(paths.evaluation), { code: 'ENOENT' });
  await assert.rejects(readFile(paths.rerun), { code: 'ENOENT' });
});
