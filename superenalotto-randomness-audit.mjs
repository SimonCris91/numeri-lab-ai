#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const BASE_SOURCE = 'https://raw.githubusercontent.com/luigimassa/superenalotto-archivio/main/superenalotto.csv';
const SUPPLEMENTAL = 'C:\\Users\\simon\\Documents\\Codex\\superenalotto-supplement-2026.csv';
const OUTPUT = 'D:\\Super\\superenalotto-randomness-audit.json';
const START = '2022-09-27';
const END = '2026-09-29';
const N = 90;
const PICK = 6;
const SIMULATIONS = 20000;
const INDEPENDENT_VERIFICATION_SIMULATIONS = 20000;
const PAIR_SIMULATIONS = 10000;
const SEED = 20260929;

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().replace(/^\uFEFF/, '').split(',');
  return lines.map((line) => {
    const values = line.split(',');
    const row = Object.fromEntries(header.map((key, index) => [key, values[index]]));
    return {
      date: row.data,
      numbers: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((key) => Number(row[key])),
      jolly: Number(row.jolly),
    };
  });
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

function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6D2B79F5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function xorshift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function sampleFloyd(random) {
  const picked = new Set();
  for (let value = N - PICK; value < N; value += 1) {
    const candidate = Math.floor(random() * (value + 1));
    picked.add(picked.has(candidate) ? value : candidate);
  }
  return [...picked].sort((a, b) => a - b);
}

function empiricalTails(sorted, observed) {
  const lowerCount = sorted.filter((value) => value <= observed + 1e-12).length;
  const upperCount = sorted.filter((value) => value >= observed - 1e-12).length;
  const lowerP = (lowerCount + 1) / (sorted.length + 1);
  const upperP = (upperCount + 1) / (sorted.length + 1);
  return { lowerP, upperP, twoSidedP: Math.min(1, 2 * Math.min(lowerP, upperP)) };
}

function quantile(sorted, probability) {
  return sorted[Math.floor((sorted.length - 1) * probability)];
}

function exactBinomialTwoSidedP(successes, trials, probability) {
  const masses = new Array(trials + 1);
  masses[0] = Math.exp(trials * Math.log1p(-probability));
  for (let k = 0; k < trials; k += 1) {
    masses[k + 1] = masses[k] * ((trials - k) / (k + 1)) * (probability / (1 - probability));
  }
  const observedMass = masses[successes];
  return Math.min(1, masses.reduce((sum, mass) => sum + (mass <= observedMass * (1 + 1e-12) ? mass : 0), 0));
}

function holmAdjust(tests) {
  const ordered = [...tests].sort((a, b) => a.rawP - b.rawP);
  let runningMaximum = 0;
  ordered.forEach((test, index) => {
    runningMaximum = Math.max(runningMaximum, Math.min(1, (ordered.length - index) * test.rawP));
    test.holmAdjustedP = runningMaximum;
  });
  return tests;
}

async function main() {
  const response = await fetch(BASE_SOURCE);
  if (!response.ok) throw new Error(`Archivio base HTTP ${response.status}`);
  const base = parseCsv(await response.text());
  const supplement = parseCsv(await readFile(SUPPLEMENTAL, 'utf8'));
  const raw = [...base, ...supplement].filter((draw) => draw.date >= START && draw.date <= END);
  const byDate = new Map();
  const conflictingDuplicateDates = [];
  for (const draw of raw) {
    const prior = byDate.get(draw.date);
    if (prior && (prior.numbers.join(',') !== draw.numbers.join(',') || prior.jolly !== draw.jolly)) {
      conflictingDuplicateDates.push(draw.date);
    }
    byDate.set(draw.date, draw);
  }
  const draws = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (draws.length < 2) throw new Error('Dati insufficienti per il controllo.');

  const invalidRows = draws.filter((draw) => {
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(draw.date) && !Number.isNaN(Date.parse(`${draw.date}T00:00:00Z`));
    const validNumbers = draw.numbers.length === PICK
      && new Set(draw.numbers).size === PICK
      && draw.numbers.every((number) => Number.isInteger(number) && number >= 1 && number <= N);
    const validJolly = Number.isInteger(draw.jolly) && draw.jolly >= 1 && draw.jolly <= N && !draw.numbers.includes(draw.jolly);
    return !validDate || !validNumbers || !validJolly;
  });
  if (invalidRows.length || conflictingDuplicateDates.length) {
    throw new Error(`Audit dati fallito: ${invalidRows.length} righe invalide, ${conflictingDuplicateDates.length} date duplicate in conflitto.`);
  }

  const drawCount = draws.length;
  const expectedPerNumber = (drawCount * PICK) / N;
  const frequencies = new Array(N).fill(0);
  for (const draw of draws) for (const number of draw.numbers) frequencies[number - 1] += 1;
  const maxAbsoluteDeviation = Math.max(...frequencies.map((count) => Math.abs(count - expectedPerNumber)));
  const observedPearsonStatistic = frequencies.reduce((sum, count) => sum + ((count - expectedPerNumber) ** 2 / expectedPerNumber), 0);
  const topNumbers = frequencies
    .map((count, index) => ({ number: index + 1, count, deviationFromMean: count - expectedPerNumber }))
    .sort((a, b) => b.count - a.count || a.number - b.number)
    .slice(0, 10);
  const bottomNumbers = frequencies
    .map((count, index) => ({ number: index + 1, count, deviationFromMean: count - expectedPerNumber }))
    .sort((a, b) => a.count - b.count || a.number - b.number)
    .slice(0, 10);

  const pairCounts = new Uint16Array(N * N);
  for (const draw of draws) {
    const picked = draw.numbers.map((number) => number - 1).sort((a, b) => a - b);
    for (let first = 0; first < PICK; first += 1) {
      for (let second = first + 1; second < PICK; second += 1) {
        pairCounts[picked[first] * N + picked[second]] += 1;
      }
    }
  }
  const observedMaximumPairCount = Math.max(...Array.from({ length: N * N }, (_, index) => {
    const first = Math.floor(index / N);
    const second = index % N;
    return first < second ? pairCounts[index] : 0;
  }));
  const topPairs = [];
  for (let first = 0; first < N; first += 1) {
    for (let second = first + 1; second < N; second += 1) {
      topPairs.push({ pair: [first + 1, second + 1], count: pairCounts[first * N + second] });
    }
  }
  topPairs.sort((a, b) => b.count - a.count || a.pair[0] - b.pair[0] || a.pair[1] - b.pair[1]);

  // Selection-adjusted pair test: compare the observed strongest pair with the
  // strongest pair found in each complete random history, not with one pair.
  const pairRandom = xorshift32((SEED ^ 0x3C3C3C3C) >>> 0);
  const simulatedMaximumPairCounts = new Array(PAIR_SIMULATIONS);
  for (let simulation = 0; simulation < PAIR_SIMULATIONS; simulation += 1) {
    const simulatedPairs = new Uint16Array(N * N);
    for (let drawIndex = 0; drawIndex < drawCount; drawIndex += 1) {
      const picked = sampleFloyd(pairRandom);
      for (let first = 0; first < PICK; first += 1) {
        for (let second = first + 1; second < PICK; second += 1) {
          simulatedPairs[picked[first] * N + picked[second]] += 1;
        }
      }
    }
    let maximum = 0;
    for (let first = 0; first < N; first += 1) {
      for (let second = first + 1; second < N; second += 1) {
        maximum = Math.max(maximum, simulatedPairs[first * N + second]);
      }
    }
    simulatedMaximumPairCounts[simulation] = maximum;
  }
  simulatedMaximumPairCounts.sort((a, b) => a - b);
  const pairExtremeCount = simulatedMaximumPairCounts.filter((value) => value >= observedMaximumPairCount).length;
  const pairMaximumMonteCarloP = (pairExtremeCount + 1) / (PAIR_SIMULATIONS + 1);

  // Simulate full six-number draws under the null. The omnibus Pearson statistic
  // accounts for all 90 counts together, including their within-draw dependence.
  const random = mulberry32(SEED);
  const simulatedPearsonStatistics = new Array(SIMULATIONS);
  const simulatedMaxDeviations = new Array(SIMULATIONS);
  for (let simulation = 0; simulation < SIMULATIONS; simulation += 1) {
    const simulatedCounts = new Uint16Array(N);
    const used = new Uint8Array(N);
    for (let drawIndex = 0; drawIndex < drawCount; drawIndex += 1) {
      const picked = new Uint8Array(PICK);
      for (let index = 0; index < PICK; index += 1) {
        let number = Math.floor(random() * N);
        while (used[number]) number = Math.floor(random() * N);
        used[number] = 1;
        picked[index] = number;
        simulatedCounts[number] += 1;
      }
      for (const number of picked) used[number] = 0;
    }
    let deviation = 0;
    let pearson = 0;
    for (const count of simulatedCounts) {
      deviation = Math.max(deviation, Math.abs(count - expectedPerNumber));
      pearson += ((count - expectedPerNumber) ** 2) / expectedPerNumber;
    }
    simulatedMaxDeviations[simulation] = deviation;
    simulatedPearsonStatistics[simulation] = pearson;
  }
  simulatedMaxDeviations.sort((a, b) => a - b);
  simulatedPearsonStatistics.sort((a, b) => a - b);
  const frequencyTails = empiricalTails(simulatedPearsonStatistics, observedPearsonStatistic);

  // Independent check: a different PRNG and Floyd's uniform subset sampler.
  const verificationRandom = xorshift32(SEED ^ 0xA5A5A5A5);
  const verificationPearson = new Array(INDEPENDENT_VERIFICATION_SIMULATIONS);
  for (let simulation = 0; simulation < INDEPENDENT_VERIFICATION_SIMULATIONS; simulation += 1) {
    const simulatedCounts = new Uint16Array(N);
    for (let drawIndex = 0; drawIndex < drawCount; drawIndex += 1) {
      const picked = new Set();
      for (let value = N - PICK; value < N; value += 1) {
        const candidate = Math.floor(verificationRandom() * (value + 1));
        picked.add(picked.has(candidate) ? value : candidate);
      }
      for (const number of picked) simulatedCounts[number] += 1;
    }
    let pearson = 0;
    for (const count of simulatedCounts) pearson += ((count - expectedPerNumber) ** 2) / expectedPerNumber;
    verificationPearson[simulation] = pearson;
  }
  verificationPearson.sort((a, b) => a - b);
  const verificationTails = empiricalTails(verificationPearson, observedPearsonStatistic);

  // Under independent uniform draws, each adjacent pair overlaps in at least
  // two main numbers with this exact hypergeometric probability.
  const denominator = choose(N, PICK);
  const overlapProbabilityAtLeastTwo = 1 - (choose(N - PICK, PICK) + PICK * choose(N - PICK, PICK - 1)) / denominator;
  let adjacentPairsAtLeastTwo = 0;
  let adjacentOverlapTotal = 0;
  for (let index = 1; index < draws.length; index += 1) {
    const previous = new Set(draws[index - 1].numbers);
    const overlap = draws[index].numbers.reduce((sum, number) => sum + Number(previous.has(number)), 0);
    adjacentOverlapTotal += overlap;
    if (overlap >= 2) adjacentPairsAtLeastTwo += 1;
  }
  const adjacentPairCount = drawCount - 1;
  const serialExactP = exactBinomialTwoSidedP(adjacentPairsAtLeastTwo, adjacentPairCount, overlapProbabilityAtLeastTwo);
  const tests = holmAdjust([
    { name: 'frequenze marginali 1-90 (Pearson omnibus, due code)', rawP: frequencyTails.twoSidedP },
    { name: 'sovrapposizione di almeno 2 numeri tra estrazioni consecutive', rawP: serialExactP },
    { name: 'massima frequenza di una coppia fra tutte le 4005 coppie', rawP: pairMaximumMonteCarloP },
  ]);

  const result = {
    coverage: {
      firstDate: draws[0].date,
      lastDate: draws.at(-1).date,
      draws: drawCount,
      rawRows: raw.length,
      duplicateDateRows: raw.length - byDate.size,
      conflictingDuplicateDates: conflictingDuplicateDates.length,
      invalidDrawRows: invalidRows.length,
    },
    marginalFrequencyTest: {
      statistic: 'Pearson omnibus: somma degli scarti quadratici standardizzati sui 90 numeri',
      expectedCountPerNumber: expectedPerNumber,
      observedPearsonStatistic,
      nullPearsonP05: quantile(simulatedPearsonStatistics, 0.05),
      nullPearsonMedian: quantile(simulatedPearsonStatistics, 0.5),
      nullPearsonP95: quantile(simulatedPearsonStatistics, 0.95),
      monteCarloLowerTailP: frequencyTails.lowerP,
      monteCarloUpperTailP: frequencyTails.upperP,
      monteCarloTwoSidedP: frequencyTails.twoSidedP,
      observedMaxAbsoluteDeviation: maxAbsoluteDeviation,
      observedMinimumFrequency: Math.min(...frequencies),
      observedMaximumFrequency: Math.max(...frequencies),
      null5thPercentileMaxDeviation: quantile(simulatedMaxDeviations, 0.05),
      null95thPercentileMaxDeviation: quantile(simulatedMaxDeviations, 0.95),
      simulations: SIMULATIONS,
      independentVerification: {
        sampler: 'Floyd uniform-subset sampler with independent xorshift32 PRNG',
        simulations: INDEPENDENT_VERIFICATION_SIMULATIONS,
        lowerTailP: verificationTails.lowerP,
        upperTailP: verificationTails.upperP,
        twoSidedP: verificationTails.twoSidedP,
        nullPearsonP05: quantile(verificationPearson, 0.05),
        nullPearsonMedian: quantile(verificationPearson, 0.5),
        nullPearsonP95: quantile(verificationPearson, 0.95),
      },
      topNumbers,
      bottomNumbers,
    },
    serialOverlapTest: {
      adjacentPairs: adjacentPairCount,
      observedAdjacentOverlapTotal: adjacentOverlapTotal,
      observedMeanOverlap: adjacentOverlapTotal / adjacentPairCount,
      nullExpectedMeanOverlap: PICK * PICK / N,
      observedPairsWithAtLeastTwoSharedNumbers: adjacentPairsAtLeastTwo,
      nullProbabilityPerAdjacentPair: overlapProbabilityAtLeastTwo,
      nullExpectedPairsWithAtLeastTwo: adjacentPairCount * overlapProbabilityAtLeastTwo,
      exactTwoSidedP: serialExactP,
    },
    pairCooccurrenceTest: {
      candidatePairs: choose(N, 2),
      totalObservedPairOccurrences: drawCount * choose(PICK, 2),
      expectedOccurrencesPerPair: (drawCount * choose(PICK, 2)) / choose(N, 2),
      observedMaximumPairCount,
      topPairs: topPairs.slice(0, 10),
      nullMaximumPairCountP95: quantile(simulatedMaximumPairCounts, 0.95),
      simulations: PAIR_SIMULATIONS,
      selectionAdjustedMonteCarloP: pairMaximumMonteCarloP,
      method: 'In ogni replica si simula l intera serie e si registra la coppia piu frequente tra tutte le coppie possibili.',
    },
    multiplicity: {
      method: 'Holm correction over the three omnibus test families reported here',
      tests,
    },
    interpretation: 'Controlli omnibus di casualita, non una dimostrazione di capacita predittiva futura. Ogni anomalia richiederebbe replica prospettica indipendente.',
    reproducibility: {
      seed: SEED,
      simulations: SIMULATIONS,
      independentVerificationSeed: (SEED ^ 0xA5A5A5A5) >>> 0,
      independentVerificationSimulations: INDEPENDENT_VERIFICATION_SIMULATIONS,
      pairSimulationSeed: (SEED ^ 0x3C3C3C3C) >>> 0,
      pairSimulations: PAIR_SIMULATIONS,
    },
  };
  await writeFile(OUTPUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
