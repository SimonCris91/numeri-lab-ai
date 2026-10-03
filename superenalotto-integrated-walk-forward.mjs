#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const BASE_SOURCE = 'https://raw.githubusercontent.com/luigimassa/superenalotto-archivio/main/superenalotto.csv';
const SUPPLEMENTAL = 'C:\\Users\\simon\\Documents\\Codex\\superenalotto-supplement-2026.csv';
const PRIOR_AUDIT = 'D:\\Super\\superenalotto-randomness-audit.json';
const OUTPUT = 'D:\\Super\\superenalotto-integrated-walk-forward.json';
const FORWARD_TEST = 'D:\\Super\\superenalotto-integrated-forward-test.json';
const BASELINE_FORWARD_TEST = 'C:\\Users\\simon\\Documents\\Codex\\superenalotto-forward-test.json';
const RERUN_OUTPUT = 'D:\\Super\\superenalotto-integrated-rerun.json';
const START = '2022-09-27';
const END = '2026-09-29';
const N = 90;
const PICK = 6;
const WINDOWS = [12, 52, 104, 208];
const DECADE_CAP = 3;
const RANDOM_SEED = 20260929;
const FORWARD_RANDOM_SEED = 20260930;
const RANDOM_EXPECTED_HITS_PER_DRAW = (PICK * PICK) / N;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseCsv(text, source) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift()?.replace(/^\uFEFF/, '').split(',');
  const required = ['data', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'jolly'];
  if (!header || required.some((key) => !header.includes(key))) {
    throw new Error(`Schema CSV inatteso: ${source}`);
  }
  return lines.map((line, lineIndex) => {
    const values = line.split(',');
    if (values.length !== header.length) throw new Error(`Riga CSV malformata: ${source}:${lineIndex + 2}`);
    const row = Object.fromEntries(header.map((key, index) => [key, values[index]]));
    return {
      date: row.data,
      numbers: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((key) => Number(row[key])),
      jolly: Number(row.jolly),
    };
  });
}

function validateDraw(draw) {
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(draw.date)
    && !Number.isNaN(Date.parse(`${draw.date}T00:00:00Z`))
    && new Date(`${draw.date}T00:00:00Z`).toISOString().slice(0, 10) === draw.date;
  const numbersValid = draw.numbers.length === PICK
    && new Set(draw.numbers).size === PICK
    && draw.numbers.every((number) => Number.isInteger(number) && number >= 1 && number <= N);
  const jollyValid = Number.isInteger(draw.jolly)
    && draw.jolly >= 1 && draw.jolly <= N
    && !draw.numbers.includes(draw.jolly);
  return dateValid && numbersValid && jollyValid;
}

function sameDraw(first, second) {
  return first.numbers.join(',') === second.numbers.join(',') && first.jolly === second.jolly;
}

export function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6D2B79F5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleSix(random) {
  const selected = new Set();
  for (let value = N - PICK; value < N; value += 1) {
    const candidate = Math.floor(random() * (value + 1));
    selected.add(selected.has(candidate) ? value : candidate);
  }
  return [...selected].map((number) => number + 1).sort((a, b) => a - b);
}

function horizonZ(count, drawsInWindow) {
  const p = PICK / N;
  const expected = drawsInWindow * p;
  const standardDeviation = Math.sqrt(drawsInWindow * p * (1 - p));
  return (count - expected) / standardDeviation;
}

function numberScores(history) {
  if (history.length < WINDOWS.at(-1)) throw new Error('Warm-up insufficiente per il modello integrato.');
  const scores = new Array(N).fill(0);
  for (const window of WINDOWS) {
    const counts = new Uint16Array(N);
    for (const draw of history.slice(-window)) {
      for (const number of draw.numbers) counts[number - 1] += 1;
    }
    for (let index = 0; index < N; index += 1) scores[index] += horizonZ(counts[index], window) / WINDOWS.length;
  }
  return scores;
}

function optimizeWithDecadeCap(scores) {
  const ranked = Array.from({ length: N }, (_, index) => ({ number: index + 1, score: scores[index] }))
    .sort((a, b) => b.score - a.score || a.number - b.number);
  const decadeCounts = new Uint8Array(9);
  const chosen = [];
  for (const candidate of ranked) {
    const decade = Math.floor((candidate.number - 1) / 10);
    if (decadeCounts[decade] >= DECADE_CAP) continue;
    chosen.push(candidate.number);
    decadeCounts[decade] += 1;
    if (chosen.length === PICK) break;
  }
  if (chosen.length !== PICK) throw new Error('Ottimizzazione combinatoria senza soluzione.');
  return chosen.sort((a, b) => a - b);
}

export function integratedPrediction(history) {
  return optimizeWithDecadeCap(numberScores(history));
}

export function frequency52Prediction(history) {
  const counts = new Uint16Array(N);
  for (const draw of history.slice(-52)) for (const number of draw.numbers) counts[number - 1] += 1;
  return optimizeWithDecadeCap(Array.from(counts));
}

function hits(prediction, actual) {
  const actualSet = new Set(actual);
  return prediction.filter((number) => actualSet.has(number)).length;
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  const reduced = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= reduced; index += 1) {
    result = (result * (n - reduced + index)) / index;
  }
  return result;
}

function exactNullDistribution(drawCount) {
  const denominator = choose(N, PICK);
  const oneDraw = Array.from({ length: PICK + 1 }, (_, overlap) => (
    choose(PICK, overlap) * choose(N - PICK, PICK - overlap) / denominator
  ));
  let total = [1];
  for (let draw = 0; draw < drawCount; draw += 1) {
    const next = new Array(total.length + PICK).fill(0);
    for (let accumulated = 0; accumulated < total.length; accumulated += 1) {
      for (let overlap = 0; overlap <= PICK; overlap += 1) {
        next[accumulated + overlap] += total[accumulated] * oneDraw[overlap];
      }
    }
    total = next;
  }
  return total;
}

function exactPValues(distribution, observed) {
  const lowerTail = distribution.reduce((sum, probability, count) => sum + (count <= observed ? probability : 0), 0);
  const upperTail = distribution.reduce((sum, probability, count) => sum + (count >= observed ? probability : 0), 0);
  return {
    lowerTailP: lowerTail,
    upperTailP: upperTail,
    twoSidedConservativeP: Math.min(1, 2 * Math.min(lowerTail, upperTail)),
  };
}

function holmUpperTail(items) {
  const ordered = [...items].sort((a, b) => a.rawP - b.rawP);
  let runningMaximum = 0;
  ordered.forEach((item, index) => {
    runningMaximum = Math.max(runningMaximum, Math.min(1, (ordered.length - index) * item.rawP));
    item.holmAdjustedP = runningMaximum;
  });
  return items;
}

async function readSnapshot(path) {
  try {
    const text = await readFile(path, 'utf8');
    return { path, text, hash: sha256(text), data: JSON.parse(text) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function assertSnapshotUnchanged(snapshot) {
  if (!snapshot) return;
  const current = await readFile(snapshot.path, 'utf8');
  if (sha256(current) !== snapshot.hash) {
    throw new Error(`Il file è cambiato durante il calcolo: ${snapshot.path}`);
  }
}

export async function saveExperiment(evaluation, forwardTest, paths = {
  evaluation: OUTPUT,
  forward: FORWARD_TEST,
  baselineForward: BASELINE_FORWARD_TEST,
  rerun: RERUN_OUTPUT,
}, snapshots) {
  const previous = snapshots ?? {
    evaluation: await readSnapshot(paths.evaluation),
    forward: await readSnapshot(paths.forward),
    baselineForward: await readSnapshot(paths.baselineForward),
  };
  const existingForward = previous.forward?.data;
  if (existingForward) {
    const sameModel = JSON.stringify(existingForward.model) === JSON.stringify(forwardTest.model);
    if (!sameModel || existingForward.startsAfterDrawDate !== forwardTest.startsAfterDrawDate) {
      throw new Error('Il modello non coincide con il protocollo congelato; nessun file è stato modificato.');
    }
    if (existingForward.processedDraws === 0
      && JSON.stringify(existingForward.nextPrediction) !== JSON.stringify(forwardTest.nextPrediction)) {
      throw new Error('La previsione ricostruita non coincide con quella iniziale congelata; verificare i dati sorgente.');
    }
  }
  for (const snapshot of Object.values(previous)) await assertSnapshotUnchanged(snapshot);

  const historicalResultsMatch = previous.evaluation
    ? ['coverage', 'evaluation', 'model', 'methods', 'nextPrediction', 'rows']
      .every((key) => JSON.stringify(previous.evaluation.data[key]) === JSON.stringify(evaluation[key]))
    : null;

  if (!previous.evaluation) {
    await writeFile(paths.evaluation, `${JSON.stringify(evaluation, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  }
  if (!previous.forward) {
    await writeFile(paths.forward, `${JSON.stringify(forwardTest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  }
  for (const snapshot of Object.values(previous)) await assertSnapshotUnchanged(snapshot);

  const preservation = {
    integratedProtocol: previous.forward ? 'preserved' : 'initialized',
    baselineProtocol: previous.baselineForward ? 'preserved' : 'not_present',
    historicalResultsMatch,
    fileHashes: Object.values(previous).filter(Boolean)
      .map((snapshot) => ({ path: snapshot.path, sha256Before: snapshot.hash, sha256After: snapshot.hash })),
  };
  if (previous.evaluation || previous.forward) {
    await writeFile(paths.rerun, `${JSON.stringify({ ...evaluation, preservation }, null, 2)}\n`, 'utf8');
  }
  return { output: previous.evaluation || previous.forward ? paths.rerun : paths.evaluation, ...preservation };
}

async function loadDraws() {
  const response = await fetch(BASE_SOURCE);
  if (!response.ok) throw new Error(`Archivio storico HTTP ${response.status}`);
  const baseText = await response.text();
  const supplementText = await readFile(SUPPLEMENTAL, 'utf8');
  const raw = [
    ...parseCsv(baseText, BASE_SOURCE),
    ...parseCsv(supplementText, SUPPLEMENTAL),
  ].filter((draw) => draw.date >= START && draw.date <= END);

  const byDate = new Map();
  let duplicateDateRows = 0;
  for (const draw of raw) {
    if (!validateDraw(draw)) throw new Error(`Estrazione non valida nel dataset: ${draw.date}`);
    const previous = byDate.get(draw.date);
    if (previous) {
      duplicateDateRows += 1;
      if (!sameDraw(previous, draw)) throw new Error(`Fonti in conflitto per la data ${draw.date}`);
    } else {
      byDate.set(draw.date, draw);
    }
  }
  const draws = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (draws[0]?.date !== START || draws.at(-1)?.date !== END) {
    throw new Error(`Copertura inattesa: ${draws[0]?.date}–${draws.at(-1)?.date}`);
  }

  const priorAudit = JSON.parse(await readFile(PRIOR_AUDIT, 'utf8'));
  const priorCoverage = priorAudit.coverage;
  if (draws.length !== priorCoverage.draws
    || draws[0].date !== priorCoverage.firstDate
    || draws.at(-1).date !== priorCoverage.lastDate
    || duplicateDateRows !== priorCoverage.duplicateDateRows) {
    throw new Error('La copertura non coincide con l’audit sorgente già validato; esperimento interrotto.');
  }

  return {
    draws,
    duplicateDateRows,
    source: {
      archiveUrl: BASE_SOURCE,
      archiveSha256: sha256(baseText),
      supplementPath: SUPPLEMENTAL,
      supplementSha256: sha256(supplementText),
      priorAuditPath: PRIOR_AUDIT,
    },
  };
}

async function main() {
  const snapshots = {
    evaluation: await readSnapshot(OUTPUT),
    forward: await readSnapshot(FORWARD_TEST),
    baselineForward: await readSnapshot(BASELINE_FORWARD_TEST),
  };
  const { draws, duplicateDateRows, source } = await loadDraws();
  const random = mulberry32(RANDOM_SEED);
  const rows = [];

  for (let index = WINDOWS.at(-1); index < draws.length; index += 1) {
    const history = draws.slice(0, index);
    const actual = draws[index];
    const integrated = integratedPrediction(history);
    const baseline = frequency52Prediction(history);
    const randomTicket = sampleSix(random);
    rows.push({
      date: actual.date,
      prediction: integrated,
      hits: hits(integrated, actual.numbers),
      frequency52Prediction: baseline,
      frequency52Hits: hits(baseline, actual.numbers),
      randomTicket,
      randomHits: hits(randomTicket, actual.numbers),
      actual: actual.numbers,
    });
  }

  const nullDistribution = exactNullDistribution(rows.length);
  const methods = [
    { key: 'hits', name: 'integrated_12_52_104_208_z_decade_cap_3' },
    { key: 'frequency52Hits', name: 'frequency_52_decade_cap_3' },
    { key: 'randomHits', name: 'uniform_random_ticket' },
  ].map(({ key, name }) => {
    const totalHits = rows.reduce((sum, row) => sum + row[key], 0);
    return {
      name,
      totalHits,
      meanHits: totalHits / rows.length,
      expectedHitsUnderNull: rows.length * RANDOM_EXPECTED_HITS_PER_DRAW,
      exactNull: exactPValues(nullDistribution, totalHits),
    };
  });
  const correctedUpperTails = holmUpperTail(methods.map((method) => ({
    name: method.name,
    rawP: method.exactNull.upperTailP,
  })));
  for (const method of methods) {
    method.holmAdjustedUpperTailP = correctedUpperTails.find((item) => item.name === method.name).holmAdjustedP;
  }

  const currentHistory = draws;
  const nextPrediction = integratedPrediction(currentHistory);
  const baselineNextPrediction = frequency52Prediction(currentHistory);
  const forwardRandomPrediction = sampleSix(mulberry32(FORWARD_RANDOM_SEED));
  const config = {
    name: 'integrated_12_52_104_208_z_decade_cap_3',
    windows: WINDOWS,
    scoring: 'Per ogni numero, media non pesata dei quattro z-score di frequenza; p nulla per estrazione = 6/90; varianza binomiale per numero = W*p*(1-p).',
    optimizer: 'Selezione esatta del massimo punteggio additivo con massimo 3 numeri per decade; greedy ottimo perché l’unico vincolo è un limite superiore per gruppo.',
    pairFeatures: 'Nessun bonus di co-occorrenza: nel precedente audit omnibus la massima coppia non ha superato il nullo corretto per selezione.',
    lookAhead: false,
    midTestParameterChanges: false,
    tieBreak: 'punteggio decrescente, poi numero crescente',
  };

  const evaluation = {
    generatedAt: new Date().toISOString(),
    scope: 'sviluppo storico esplorativo; ogni previsione usa esclusivamente estrazioni precedenti alla data valutata',
    coverage: {
      firstDate: draws[0].date,
      lastDate: draws.at(-1).date,
      draws: draws.length,
      duplicateDateRows,
      invalidRows: 0,
    },
    evaluation: {
      warmupDraws: WINDOWS.at(-1),
      testedDraws: rows.length,
      firstTestDate: rows[0].date,
      lastTestDate: rows.at(-1).date,
      stakeComparison: 'un biglietto virtuale da 6 numeri per metodo e per estrazione; costo uguale',
      expectedMeanHitsUnderRandomNull: RANDOM_EXPECTED_HITS_PER_DRAW,
      randomTicketSeed: RANDOM_SEED,
      exactNull: 'convoluzione esatta di 588 (o N) variabili ipergeometriche Hypergeom(90,6,6); valida per previsioni no-lookahead sotto estrazioni indipendenti uniformi',
      familyCorrection: 'Holm su tre confronti descrittivi di coda superiore; non corregge la ricerca storica svolta prima di questo esperimento',
    },
    model: config,
    methods,
    nextPrediction,
    source,
    limitations: [
      'Le estrazioni storiche sono già state esplorate in analisi precedenti: p-value e confronto storico sono esplorativi, non una conferma indipendente.',
      'I risultati misurano hit principali per sestina, non rendimento monetario: non sono stati modellati prezzi ufficiali, categorie di premio, quote condivise o jackpot.',
      'Il confronto casuale è una singola sequenza deterministica di ticket uniformi, riportata come controllo descrittivo; il riferimento inferenziale è la distribuzione nulla ipergeometrica esatta.',
      'La ricerca è classica: nessun hardware quantistico è stato usato. Il vincolo combinatorio è risolto esattamente con ordinamento e vincoli per decade.',
    ],
    rows,
  };

  const forwardTest = {
    status: 'READY',
    createdAt: new Date().toISOString(),
    startsAfterDrawDate: END,
    protocolRevision: 1,
    targetDraws: 100,
    processedDraws: 0,
    stakePerCombination: 1,
    stakeIsSimulated: true,
    model: config,
    comparators: {
      activeBaseline: {
        name: 'frequency_52_decade_cap_3',
        existingProtocolPath: 'C:\\Users\\simon\\Documents\\Codex\\superenalotto-forward-test.json',
        nextPrediction: baselineNextPrediction,
      },
      randomBaseline: {
        name: 'uniform_random_ticket',
        generator: 'Mulberry32 + Floyd uniform-subset sampler; six PRNG outputs consumed per draw',
        seed: FORWARD_RANDOM_SEED,
        nextPrediction: forwardRandomPrediction,
      },
      multiplicity: 'Confronto prospettico delle due strategie predittive sulla stessa serie; correzione Holm se si seleziona la migliore.',
    },
    nextPrediction,
    results: [],
    acceptanceCriteria: {
      referenceMeanHitsPerCombination: RANDOM_EXPECTED_HITS_PER_DRAW,
      equalBudget: 'una sestina integrata e un riferimento casuale per ciascuna estrazione',
      noMidTestParameterChanges: true,
      pairedComparison: 'Registrare gli hit delle due strategie sulla stessa estrazione e correggere per confronti multipli.',
      interpretation: 'test prospettico esplorativo; non attribuire vantaggio predittivo o profitto senza evidenza sufficiente e replicazione',
    },
  };

  const saved = await saveExperiment(evaluation, forwardTest, undefined, snapshots);
  console.log(JSON.stringify({
    ...saved,
    forwardTest: FORWARD_TEST,
    coverage: evaluation.coverage,
    evaluation: evaluation.evaluation,
    methods,
    nextPrediction,
    note: saved.integratedProtocol === 'preserved'
      ? 'Esperimento rieseguito; i due protocolli prospettici esistenti sono stati preservati byte per byte.'
      : 'Il protocollo prospettico separato è stato inizializzato senza modificare quello già attivo.',
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
