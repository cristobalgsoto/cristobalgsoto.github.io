const DECAY_METHODS = {
  sabine: { key: 'RT_sabine', color: '#FF8C00', label: 'Sabine', always: true },
  eyring: { key: 'RT_eyring', color: '#3A7BFF', label: 'Eyring', always: true },
  fitzroy: { key: 'RT_fitzroy', color: '#00CC66', label: 'Fitzroy', always: false },
  millington: { key: 'RT_millington', color: '#FF4444', label: 'Millington', always: false },
};

let decayMethod = 'sabine';
let currentResultInput = null;

function renderDecayToggle(res) {
  const wrap = document.getElementById('decay-method-toggle');
  if (!wrap) return;

  if (!DECAY_METHODS[decayMethod]?.always && !res.hasTreatment) decayMethod = 'sabine';
  const entries = Object.entries(DECAY_METHODS).filter(([, method]) => method.always || res.hasTreatment);
  wrap.innerHTML = entries.map(([key, method]) => {
    const values = res[method.key];
    const middle = values ? (values[3] ?? values[2]) : null;
    const status = middle === null || middle === undefined ? '' : `<span class="decay-status-dot rt-${classifyRT(middle)}"></span>`;
    return `<button type="button" class="mtog-btn${key === decayMethod ? ' active' : ''}" onclick="setDecayMethod('${key}')">${status}${method.label}</button>`;
  }).join('');
}

function setDecayMethod(method) {
  if (!DECAY_METHODS[method]) return;
  decayMethod = method;
  const raw = sessionStorage.getItem('aqvis_result');
  if (!raw) return;

  try {
    const result = JSON.parse(raw);
    renderDecayToggle(result);
    renderRT60Chart(result, decayMethod);
    const label = document.getElementById('decay-3d-label');
    if (label) label.textContent = `Reflexiones 3D: ${DECAY_METHODS[decayMethod].label}`;
    if (typeof _threeState !== 'undefined' && _threeState?.setDecay) {
      _threeState.setDecay(decayMethod, result);
    }
  } catch (error) {
    console.error('No se pudo actualizar el método RT60.', error);
  }
}

function renderRT60Chart(res, method) {
  const container = document.getElementById('rt-chart');
  if (!container) return;

  const width = container.clientWidth;
  if (width <= 0) return;

  const config = DECAY_METHODS[method || decayMethod] || DECAY_METHODS.sabine;
  const data = res[config.key];
  const height = container.clientHeight || 260;
  const pad = { top: 20, right: 20, bottom: 44, left: 48 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const allValues = [
    ...res.RT_sabine,
    ...res.RT_eyring,
    ...(res.hasTreatment ? (res.RT_fitzroy || []) : []),
    ...(res.hasTreatment ? (res.RT_millington || []) : []),
  ].filter((value) => value !== null && value !== undefined && Number.isFinite(value));
  const maxY = Math.ceil(Math.max(...allValues, 1) * 10) / 10 + 0.2;
  const x = (index) => pad.left + (index / (BANDS.length - 1)) * innerWidth;
  const y = (value) => pad.top + innerHeight - (value / maxY) * innerHeight;

  const path = (data || []).map((value, index) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '';
    return `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)},${y(value).toFixed(1)}`;
  }).filter(Boolean).join(' ');

  const circles = (data || []).map((value, index) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '';
    return `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="4" fill="${config.color}" stroke="var(--bg)" stroke-width="1.5"><title>${BAND_LABELS[index]} Hz: ${value.toFixed(1)} s</title></circle>`;
  }).join('');

  const yGrid = Array.from({ length: 6 }, (_, index) => {
    const value = (index / 5) * maxY;
    const yPos = y(value);
    return `<line x1="${pad.left}" y1="${yPos.toFixed(1)}" x2="${(pad.left + innerWidth).toFixed(1)}" y2="${yPos.toFixed(1)}" stroke="var(--border2)" stroke-width="0.5" stroke-dasharray="4,3"/><text x="${pad.left - 8}" y="${(yPos + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text3)" font-family="var(--font-mono)">${value.toFixed(1)}</text>`;
  }).join('');
  const xGrid = BAND_LABELS.map((label, index) => `<line x1="${x(index).toFixed(1)}" y1="${pad.top}" x2="${x(index).toFixed(1)}" y2="${(pad.top + innerHeight).toFixed(1)}" stroke="var(--border2)" stroke-width="0.5" stroke-dasharray="2,4"/><text x="${x(index).toFixed(1)}" y="${(pad.top + innerHeight + 20).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--text3)" font-family="var(--font-mono)">${label}</text>`).join('');
  const pathMarkup = path
    ? `<path d="${path}" fill="none" stroke="${config.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${circles}`
    : `<text x="${(pad.left + innerWidth / 2).toFixed(1)}" y="${(pad.top + innerHeight / 2).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--text3)" font-family="var(--font-mono)">Sin datos para ${config.label}</text>`;
  const legend = `<g transform="translate(${pad.left}, ${pad.top + innerHeight + 30})"><line x1="0" y1="7" x2="18" y2="7" stroke="${config.color}" stroke-width="2.5"/><circle cx="9" cy="7" r="3" fill="${config.color}"/><text x="22" y="11" font-size="10" fill="var(--text2)" font-family="var(--font-body)">${config.label}</text></g>`;
  const yAxis = `<text transform="rotate(-90)" x="${-(pad.top + innerHeight / 2)}" y="14" text-anchor="middle" font-size="10" fill="var(--text3)" font-family="var(--font-mono)">RT60 (s)</text>`;
  const xAxis = `<text x="${(pad.left + innerWidth / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" font-size="10" fill="var(--text3)" font-family="var(--font-mono)">Frecuencia (Hz)</text>`;

  container.innerHTML = `<svg width="${width}" height="${height + 30}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">${yGrid}${xGrid}${pathMarkup}${yAxis}${xAxis}${legend}</svg>`;
}

function showTab(name, button) {
  document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((tab) => tab.classList.remove('active'));
  document.getElementById(`tab-${name}`)?.classList.add('active');
  button?.classList.add('active');

  const raw = sessionStorage.getItem('aqvis_result');
  let result = null;
  try { result = raw ? JSON.parse(raw) : null; } catch (error) {}

  if (typeof _threeState !== 'undefined' && _threeState?.setDecayActive) {
    _threeState.setDecayActive(name === 'decay', decayMethod, result);
  }

  if (name === 'decay' && result) {
    renderDecayToggle(result);
    requestAnimationFrame(() => renderRT60Chart(result, decayMethod));
  }
}

function recalculate() {
  window.location.href = 'simulator.html';
}

document.addEventListener('DOMContentLoaded', () => {
  const surfaceIds = ['piso', 'techo', 'pared1', 'pared2', 'pared3', 'pared4'];
  surfaceIds.forEach((surfaceId) => {
    const select = document.getElementById(`res-mat-${surfaceId}`);
    if (!select) return;
    const materials = getConstructionForSurface(surfaceId);
    select.innerHTML = materials.map((name) => `<option value="${name}">${name}</option>`).join('');
  });

  const temperature = document.getElementById('res-temp');
  if (temperature) {
    temperature.addEventListener('input', () => syncSlider(temperature, 'res-temp-val', '°C'));
  }
});