import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { integratedPrediction, frequency52Prediction, mulberry32, sampleSix } from './superenalotto-integrated-walk-forward.mjs';

export function advance(integrated, baseline, history, draw) {
  const validTicket = ticket => Array.isArray(ticket) && ticket.length === 6
    && new Set(ticket).size === 6 && ticket.every(n => Number.isInteger(n) && n >= 1 && n <= 90);
  if (!validTicket(draw.numbers) || !Number.isInteger(draw.jolly) || draw.jolly < 1
    || draw.jolly > 90 || draw.numbers.includes(draw.jolly)
    || !Number.isInteger(draw.superstar) || draw.superstar < 1 || draw.superstar > 90
    || !Number.isInteger(draw.contest) || !/^\d{4}-\d{2}-\d{2}$/.test(draw.date)
    || new Date(`${draw.date}T00:00:00Z`).toISOString().slice(0, 10) !== draw.date) throw new Error('Estrazione non valida');
  const existing = integrated.results.find(r => r.drawDate === draw.date);
  if (existing) {
    const other = baseline.results.find(r => r.drawDate === draw.date);
    if (!other || [existing, other].some(r => JSON.stringify(r.draw) !== JSON.stringify(draw.numbers)
      || r.jolly !== draw.jolly || r.superstar !== draw.superstar || r.contest !== draw.contest)) throw new Error('Estrazione già registrata in conflitto');
    return { integrated, baseline, alreadyProcessed: true };
  }
  if (integrated.processedDraws !== integrated.results.length || baseline.processedDraws !== baseline.results.length
    || integrated.processedDraws >= integrated.targetDraws || baseline.processedDraws >= baseline.targetDraws) throw new Error('Contatori non validi o test completo');
  if (draw.contest !== baseline.results.at(-1)?.contest + 1) throw new Error('Concorso non consecutivo');
  if (integrated.model.lookAhead !== false || integrated.model.midTestParameterChanges !== false
    || JSON.stringify(integrated.model.windows) !== '[12,52,104,208]'
    || baseline.strategy.frequencyWindow !== 52 || baseline.strategy.constraints.maxNumbersPerDecade !== 3
    || baseline.strategy.lookAhead !== false || baseline.strategy.midTestParameterChanges !== false) throw new Error('Protocollo inatteso');
  const lastDate = integrated.lastProcessedDraw ?? integrated.startsAfterDrawDate;
  if (lastDate !== baseline.lastProcessedDraw || history.at(-1)?.date !== lastDate || draw.date <= lastDate) throw new Error('Serie non allineate');
  if (JSON.stringify(integratedPrediction(history)) !== JSON.stringify(integrated.nextPrediction)
    || JSON.stringify(frequency52Prediction(history)) !== JSON.stringify(baseline.nextPrediction)
    || JSON.stringify(baseline.nextPrediction) !== JSON.stringify(integrated.comparators.activeBaseline.nextPrediction)) throw new Error('Previsioni congelate non ricostruibili');
  const random = mulberry32(integrated.comparators.randomBaseline.seed);
  for (let i = 0; i < integrated.processedDraws; i++) sampleSix(random);
  if (JSON.stringify(sampleSix(random)) !== JSON.stringify(integrated.comparators.randomBaseline.nextPrediction)) throw new Error('Sequenza casuale non allineata');
  const result = (prediction, stake) => {
    if (!validTicket(prediction)) throw new Error('Sestina non valida');
    const mainHits = prediction.filter(n => draw.numbers.includes(n)).length;
    return { drawDate: draw.date, contest: draw.contest, prediction: [...prediction], draw: [...draw.numbers],
      jolly: draw.jolly, superstar: draw.superstar, mainHits, category: mainHits === 5 && prediction.includes(draw.jolly) ? '5+1' : String(mainHits),
      stake, grossReturn: mainHits < 2 ? 0 : null, netProfit: mainHits < 2 ? -stake : null,
      payoutStatus: mainHits < 2 ? 'NO_MAIN_PRIZE' : 'PENDING_OFFICIAL_QUOTA', source: draw.source };
  };
  const nextHistory = [...history, draw];
  const nextIntegrated = structuredClone(integrated);
  const nextBaseline = structuredClone(baseline);
  const row = result(integrated.nextPrediction, integrated.stakePerCombination);
  row.comparators = {
    frequency52: result(baseline.nextPrediction, baseline.stakePerCombination),
    random: result(integrated.comparators.randomBaseline.nextPrediction, integrated.stakePerCombination),
  };
  nextIntegrated.results.push(row);
  nextBaseline.results.push(result(baseline.nextPrediction, baseline.stakePerCombination));
  for (const protocol of [nextIntegrated, nextBaseline]) {
    protocol.processedDraws = protocol.results.length;
    protocol.lastProcessedDraw = draw.date;
    protocol.status = protocol.processedDraws >= protocol.targetDraws ? 'COMPLETE' : 'ACTIVE';
  }
  nextIntegrated.nextPrediction = integratedPrediction(nextHistory);
  nextBaseline.nextPrediction = frequency52Prediction(nextHistory);
  nextIntegrated.comparators.activeBaseline.nextPrediction = [...nextBaseline.nextPrediction];
  nextIntegrated.comparators.randomBaseline.nextPrediction = sampleSix(random);
  return { integrated: nextIntegrated, baseline: nextBaseline, alreadyProcessed: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = {
    integrated: 'D:/Super/superenalotto-integrated-forward-test.json',
    baseline: 'C:/Users/simon/Documents/Codex/superenalotto-forward-test.json',
    historical: 'D:/Super/superenalotto-integrated-walk-forward.json',
    draw: 'D:/Super/superenalotto-draw-2026-10-01.json',
  };
  const texts = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, 'utf8')])));
  const data = Object.fromEntries(Object.entries(texts).map(([key, text]) => [key, JSON.parse(text)]));
  const history = data.historical.rows.map(row => ({ date: row.date, numbers: row.actual }));
  for (const row of data.integrated.results) history.push({ date: row.drawDate, numbers: row.draw });
  const update = advance(data.integrated, data.baseline, history, data.draw);
  console.log(JSON.stringify({ paths, before: { integrated: texts.integrated, baseline: texts.baseline }, update }, null, 2));
}
