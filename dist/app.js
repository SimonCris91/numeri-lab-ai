const $ = (selector) => document.querySelector(selector);
const euro = (value) => Number(value).toLocaleString('it-IT', { maximumFractionDigits: 0 });
const modelLabels = { moon_phase_8: 'Fase lunare', sun_sector_12: 'Settore del Sole', inner_planets_12: 'Pianeti interni', outer_planets_12: 'Pianeti esterni', mercury_venus_aspect: 'Aspetto Mercurio–Venere' };
let lotto;

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
}

async function init() {
  try {
    const [lottoData, forward] = await Promise.all([readJson('lotto-astronomy-results.json'), readJson('superenalotto-integrated-forward-test.json')]);
    lotto = lottoData;
    $('#data-status').textContent = 'Dati verificati';
    $('#draw-count').textContent = lotto.coverage.draws;
    $('#se-progress').textContent = `${forward.processedDraws}/${forward.targetDraws}`;
    const best = [...lotto.methods].sort((a, b) => b.totalHits - a.totalHits)[0];
    $('#best-hit').textContent = modelLabels[best.name] || best.name;
    $('#best-hit-note').textContent = `${best.totalHits.toLocaleString('it-IT')} hit su ${lotto.coverage.testedWheelDraws.toLocaleString('it-IT')} test ruota-data`;
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
