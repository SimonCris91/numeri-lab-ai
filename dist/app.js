const $ = (selector) => document.querySelector(selector);
const euro = (value) => Number(value).toLocaleString('it-IT', { maximumFractionDigits: 0 });
const modelLabels = { moon_phase_8: 'Fase lunare', sun_sector_12: 'Settore del Sole', inner_planets_12: 'Pianeti interni', outer_planets_12: 'Pianeti esterni', mercury_venus_aspect: 'Aspetto Mercurio–Venere' };
let lotto;
let superHistory;
let superForward;

async function readJson(path) { const response = await fetch(path); if (!response.ok) throw new Error(path); return response.json(); }

function renderModels() {
  const sorted = [...lotto.methods].sort((a, b) => b.totalHits - a.totalHits);
  const leader = sorted[0];
  const expected = leader.expectedHits;
  $('#leading-model').textContent = modelLabels[leader.name] || leader.name;
  $('#leading-score').textContent = `+${(leader.totalHits - expected).toFixed(0)}`;
  $('#leading-hits').textContent = euro(leader.totalHits);
  $('#leading-expected').textContent = euro(expected);
  $('#leading-p').textContent = Number(leader.tests[0]?.holmP ?? 1).toFixed(3);
  $('#leading-bar').style.width = `${Math.min(100, (leader.totalHits / (expected * 1.08)) * 100)}%`;
  $('#model-list').innerHTML = sorted.map((model) => {
    const delta = model.totalHits - model.expectedHits;
    return `<div class="model-row"><div><strong>${modelLabels[model.name] || model.name}</strong><small>${delta >= 0 ? '+' : ''}${delta.toFixed(0)} rispetto al caso</small></div><div class="right">${euro(model.totalHits)}<em>p ${Number(model.tests[0]?.holmP ?? 1).toFixed(3)}</em></div></div>`;
  }).join('');
}

function renderPicks() {
  const wheel = $('#wheel').value || lotto.next[0].wheel;
  const item = lotto.next.find((row) => row.wheel === wheel);
  $('#selected-wheel').textContent = wheel;
  const numbers = item?.predictions?.inner_planets_12 || [];
  $('#picks').innerHTML = numbers.map((number) => `<span class="pick">${String(number).padStart(2, '0')}</span>`).join('');
  renderHistoryChecks(wheel, numbers);
  renderMovement(wheel);
  renderStats(wheel);
}

function checkNumbers(rows, numbers, getActual, label) {
  const recentRows = rows.slice(-12);
  return numbers.map((number) => {
    const matches = rows.filter((row) => getActual(row).includes(number));
    const recent = recentRows.filter((row) => getActual(row).includes(number)).length;
    return `<div class="number-check ${recent ? 'recent' : ''}"><strong>${String(number).padStart(2, '0')}</strong><span>${matches.length} volte</span><small>${matches.at(-1)?.date || '—'}${recent ? ` · ${recent} recenti` : ''}</small></div>`;
  }).join('');
}

function renderHistoryChecks(wheel, lottoNumbers) {
  const rowsPerModel = Math.floor(lotto.rows.length / lotto.methods.length);
  const innerRows = lotto.rows.slice(rowsPerModel * 2, rowsPerModel * 3);
  $('#verify-wheel').textContent = wheel;
  $('#verify-window').textContent = `${lotto.coverage.firstDate} → ${lotto.coverage.lastDate}`;
  $('#number-checks').innerHTML = checkNumbers(innerRows, lottoNumbers, (row) => row.actual, wheel);
  if (superHistory && superForward) {
    const numbers = superForward.nextPrediction || [];
    $('#se-number-checks').innerHTML = checkNumbers(superHistory.rows, numbers, (row) => row.actual, 'SuperEnalotto');
  }
}

function lottoInnerRows() {
  const rowsPerModel = Math.floor(lotto.rows.length / lotto.methods.length);
  return lotto.rows.slice(rowsPerModel * 2, rowsPerModel * 3);
}

function frequencyRows(rows, windowSize, limit) {
  const recentRows = rows.slice(-windowSize);
  const counts = Array.from({ length: 90 }, (_, index) => ({ number: index + 1, count: 0 }));
  recentRows.forEach((row) => row.actual.forEach((number) => { counts[number - 1].count += 1; }));
  const ranked = counts.filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.number - b.number)
    .slice(0, limit);
  const maxCount = ranked[0]?.count || 1;
  return ranked.map((item) => `<div class="frequency-row"><strong>${String(item.number).padStart(2, '0')}</strong><i style="width:${Math.round((item.count / maxCount) * 100)}%"></i><span>${item.count}</span></div>`).join('');
}

function renderMovement(wheel) {
  const rows = lottoInnerRows().filter((row) => row.wheel === wheel);
  const latest = rows.at(-1);
  if (!latest) return;
  $('#latest-wheel').textContent = wheel;
  $('#latest-date').textContent = latest.date || '—';
  $('#latest-numbers').innerHTML = latest.actual.map((number) => `<span>${String(number).padStart(2, '0')}</span>`).join('');
  $('#recent-12').innerHTML = frequencyRows(rows, 12, 8);
  $('#recent-52').innerHTML = frequencyRows(rows, 52, 10);
}

function normalTail(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? p : 1 - p;
}

function renderStats(wheel) {
  const rows = lottoInnerRows().filter((row) => row.wheel === wheel);
  if (!rows.length) return;
  const recent = rows.slice(-52);
  const values = recent.flatMap((row) => row.actual);
  const sumMean = values.reduce((total, value) => total + value, 0) / recent.length;
  const evenMean = values.filter((value) => value % 2 === 0).length / recent.length;
  const distinct = new Set(values).size;
  let overlaps = 0;
  for (let index = 1; index < recent.length; index += 1) {
    overlaps += recent[index].actual.filter((number) => recent[index - 1].actual.includes(number)).length;
  }
  const overlapMean = overlaps / Math.max(1, recent.length - 1);
  const expectedSum = 5 * 91 / 2;
  const counts = Array.from({ length: 90 }, () => 0);
  rows.forEach((row) => row.actual.forEach((number) => { counts[number - 1] += 1; }));
  const expected = (rows.length * 5) / 90;
  const chiSquare = counts.reduce((total, count) => total + ((count - expected) ** 2) / expected, 0);
  const degrees = 89;
  const z = ((chiSquare / degrees) ** (1 / 3) - (1 - 2 / (9 * degrees))) / Math.sqrt(2 / (9 * degrees));
  const pApprox = Math.max(0, Math.min(1, normalTail(z)));
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  $('#stats-sample').textContent = `${rows.length} estrazioni`;
  $('#stats-cards').innerHTML = [
    ['Copertura recente', `${distinct}/90`, 'numeri distinti nelle ultime 52'],
    ['Somma media', sumMean.toFixed(1), `atteso teorico ${expectedSum.toFixed(1)}`],
    ['Pari medi', evenMean.toFixed(2), 'atteso teorico 2,50 per estrazione'],
    ['Sovrapposizione', overlapMean.toFixed(2), 'numeri ripetuti tra estrazioni consecutive'],
  ].map(([label, value, note]) => `<article class="stats-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
  $('#stats-uniformity').innerHTML = `<strong>χ² = ${chiSquare.toFixed(1)}</strong> su ${degrees} gradi di libertà; p approssimato ${pApprox.toFixed(3)}. Frequenze osservate: da ${min} a ${max} uscite per numero.`;
  $('#stats-overlap').innerHTML = `<strong>Baseline di sovrapposizione:</strong> con due cinquine casuali su 90 numeri l'atteso è circa 0,28; il campione recente della ruota mostra ${overlapMean.toFixed(2)}.`;
}

async function init() {
  try {
    const [lottoData, forward, history] = await Promise.all([readJson('lotto-astronomy-results.json'), readJson('superenalotto-integrated-forward-test.json'), readJson('superenalotto-integrated-walk-forward.json')]);
    lotto = lottoData;
    superForward = forward;
    superHistory = history;
    $('#data-status').textContent = 'Dati verificati';
    $('#draw-count').textContent = lotto.coverage.draws;
    $('#se-progress').textContent = `${forward.processedDraws}/${forward.targetDraws}`;
    const best = [...lotto.methods].sort((a, b) => b.totalHits - a.totalHits)[0];
    $('#best-hit').textContent = modelLabels[best.name] || best.name;
    $('#best-hit-note').textContent = `${best.totalHits.toLocaleString('it-IT')} numeri centrati nello storico`;
    $('#wheel').innerHTML = lotto.next.map((row) => `<option>${row.wheel}</option>`).join('');
    $('#wheel').addEventListener('change', renderPicks);
    renderModels(); renderPicks();
  } catch (error) {
    $('#data-status').textContent = 'Dati non disponibili';
    document.querySelectorAll('.stat-card strong').forEach((node) => { if (node.textContent === '—') node.textContent = '—'; });
    console.error(error);
  }
}

init();
