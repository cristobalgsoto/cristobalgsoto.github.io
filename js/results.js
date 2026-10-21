const DECAY_METHODS = {
  sabine: { key: 'RT_sabine', color: '#FF8C00', label: 'Sabine', always: true },
  eyring: { key: 'RT_eyring', color: '#3A7BFF', label: 'Eyring', always: true },
  fitzroy: { key: 'RT_fitzroy', color: '#00CC66', label: 'Fitzroy', always: false },
  millington: { key: 'RT_millington', color: '#FF4444', label: 'Millington', always: false },
};

let decayMethod = 'sabine';
let currentResultInput = null;
let currentResultData = null;

function renderDecayToggle(res) {
  const wrap = document.getElementById('decay-method-toggle');
  if (!wrap) return;

  if (!DECAY_METHODS[decayMethod]?.always && !res.hasTreatment) decayMethod = 'sabine';
  const entries = Object.entries(DECAY_METHODS).filter(([, method]) => method.always || res.hasTreatment);
  wrap.innerHTML = entries.map(([key, method]) => {
    const values = res[method.key];
    // El punto de estado de cada método se juzga con el MISMO criterio que
    // la insignia del resumen: T_m de 250 Hz a 4 kHz contra el objetivo de
    // EBU/ITU para el volumen de la sala. Antes miraba sólo 1 kHz, y después
    // la media de las seis bandas, que no es la del criterio.
    const tm = tmCriterio(values);
    const status = Number.isFinite(tm) ? `<span class="decay-status-dot rt-${claseRT(tm, res.V)}"></span>` : '';
    return `<button type="button" class="mtog-btn${key === decayMethod ? ' active' : ''}" onclick="setDecayMethod('${key}')">${status}${method.label}</button>`;
  }).join('');
}

function setDecayMethod(method) {
  if (!DECAY_METHODS[method]) return;
  decayMethod = method;

  try {
    const raw = sessionStorage.getItem('aqvis_result');
    const result = raw ? JSON.parse(raw) : currentResultData;
    if (!result) return;
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
  // El eje Y se dividía en 5 tramos de un máximo arbitrario (…*10)/10 + 0.2,
  // así que las marcas caían en 0.18 / 0.36 / 0.54 y se mostraban redondeadas
  // a un decimal: 0.2 / 0.4 / 0.5, con saltos desiguales. Como las etiquetas
  // llevan un decimal, basta con que el propio tramo tenga un decimal para
  // que las seis marcas salgan exactas y equidistantes.
  // La brecha entra en el cálculo del techo: si el objetivo queda por
  // encima de la curva —sala demasiado absorbente— el campo de tolerancia
  // se saldría del gráfico y el usuario no vería contra qué se le juzga.
  const lm = (typeof lecturaEBU === 'function' && Number.isFinite(res.V))
    ? lecturaEBU(res.RT_sabine, res.V, res.L, res.W)
    : null;
  const limites = lm ? lm.brecha.flatMap((m) => [m.min, m.max]) : [];
  const techo = Math.max(...allValues, ...limites, 0.1) * 1.05;
  const paso = Math.ceil((techo / 5) * 10) / 10;
  const maxY = paso * 5;
  const x = (index) => pad.left + (index / (BANDS.length - 1)) * innerWidth;
  const y = (value) => pad.top + innerHeight - (value / maxY) * innerHeight;

  const path = (data || []).map((value, index) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '';
    return `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)},${y(value).toFixed(1)}`;
  }).filter(Boolean).join(' ');

  // La banda que se sale del campo se marca con un ANILLO, no cambiándole
  // el color: Millington ya es #FF4444 y un punto rojo se leería como un
  // cambio de método en vez de como un aviso. La insignia dice CUÁNTAS
  // bandas fallan; el gráfico dice CUÁLES.
  const FUERA = '#f05050';
  const circles = (data || []).map((value, index) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '';
    const est = lm ? lm.estado[index] : 'dentro';
    const fuera = est === 'alta' || est === 'baja';
    const m = lm ? lm.brecha[index] : null;
    const tip = m
      ? `${BAND_LABELS[index]} Hz: ${value.toFixed(2)} s — brecha ${m.min.toFixed(2)} a ${m.max.toFixed(2)} s`
      : `${BAND_LABELS[index]} Hz: ${value.toFixed(1)} s`;
    const anillo = fuera
      ? `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="7.5" fill="none" stroke="${FUERA}" stroke-width="1.5"/>`
      : '';
    return anillo + `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="4" fill="${config.color}" stroke="var(--bg)" stroke-width="1.5" data-tooltip="${tip}"></circle>`;
  }).join('');

  // ── El campo de tolerancia de EBU, dibujado ───────────────────
  // El borde superior se quiebra en 125 Hz porque la tolerancia se
  // ensancha hacia graves; el inferior es plano en -0.05 s.
  let brechaMarkup = '';
  if (lm) {
    const arriba = lm.brecha.map((m, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)},${y(m.max).toFixed(1)}`).join(' ');
    const abajo = lm.brecha.map((m, i) => `L ${x(lm.brecha.length - 1 - i).toFixed(1)},${y(lm.brecha[lm.brecha.length - 1 - i].min).toFixed(1)}`).join(' ');
    const centro = y(lm.tm).toFixed(1);
    brechaMarkup =
      `<path d="${arriba} ${abajo} Z" fill="rgba(240,240,240,0.055)" stroke="none" data-tooltip="Brecha de tolerancia de EBU Tech 3276 alrededor de T_m = ${lm.tm.toFixed(2)} s"/>` +
      `<path d="${arriba}" fill="none" stroke="var(--text3)" stroke-width="1" stroke-dasharray="5,4" opacity="0.7"/>` +
      `<line x1="${x(0).toFixed(1)}" y1="${y(lm.brecha[0].min).toFixed(1)}" x2="${x(lm.brecha.length - 1).toFixed(1)}" y2="${y(lm.brecha[0].min).toFixed(1)}" stroke="var(--text3)" stroke-width="1" stroke-dasharray="5,4" opacity="0.7"/>` +
      `<line x1="${x(0).toFixed(1)}" y1="${centro}" x2="${x(lm.brecha.length - 1).toFixed(1)}" y2="${centro}" stroke="var(--text3)" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"/>`;
  }

  const yGrid = Array.from({ length: 6 }, (_, index) => {
    const value = (index / 5) * maxY;
    const yPos = y(value);
    return `<line x1="${pad.left}" y1="${yPos.toFixed(1)}" x2="${(pad.left + innerWidth).toFixed(1)}" y2="${yPos.toFixed(1)}" stroke="var(--border2)" stroke-width="0.5" stroke-dasharray="4,3"/><text x="${pad.left - 8}" y="${(yPos + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--text3)" font-family="var(--font-mono)">${value.toFixed(1)}</text>`;
  }).join('');
  const xGrid = BAND_LABELS.map((label, index) => `<line x1="${x(index).toFixed(1)}" y1="${pad.top}" x2="${x(index).toFixed(1)}" y2="${(pad.top + innerHeight).toFixed(1)}" stroke="var(--border2)" stroke-width="0.5" stroke-dasharray="2,4"/><text x="${x(index).toFixed(1)}" y="${(pad.top + innerHeight + 20).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--text3)" font-family="var(--font-mono)">${label}</text>`).join('');
  const pathMarkup = path
    ? `<path d="${path}" fill="none" stroke="${config.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${circles}`
    : `<text x="${(pad.left + innerWidth / 2).toFixed(1)}" y="${(pad.top + innerHeight / 2).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--text3)" font-family="var(--font-mono)">Sin datos para ${config.label}</text>`;
  const anchoEtiqueta = 22 + config.label.length * 6.2 + 26;
  const legend = `<g transform="translate(${pad.left}, ${pad.top + innerHeight + 30})"><line x1="0" y1="7" x2="18" y2="7" stroke="${config.color}" stroke-width="2.5"/><circle cx="9" cy="7" r="3" fill="${config.color}"/><text x="22" y="11" font-size="11" fill="var(--text2)" font-family="var(--font-body)">${config.label}</text>${lm ? `<rect x="${anchoEtiqueta.toFixed(1)}" y="1" width="18" height="12" fill="rgba(240,240,240,0.055)" stroke="var(--text3)" stroke-width="1" stroke-dasharray="3,2" opacity="0.8"/><text x="${(anchoEtiqueta + 24).toFixed(1)}" y="11" font-size="11" fill="var(--text2)" font-family="var(--font-body)">Brecha de tolerancia · T_m ${lm.tm.toFixed(2)} s</text>` : ''}</g>`;
  const yAxis = `<text transform="rotate(-90)" x="${-(pad.top + innerHeight / 2)}" y="14" text-anchor="middle" font-size="11" fill="var(--text3)" font-family="var(--font-mono)">RT60 (s)</text>`;
  const xAxis = `<text x="${(pad.left + innerWidth / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" font-size="11" fill="var(--text3)" font-family="var(--font-mono)">Frecuencia (Hz)</text>`;

  container.innerHTML = `<svg width="${width}" height="${height + 30}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">${yGrid}${xGrid}${brechaMarkup}${pathMarkup}${yAxis}${xAxis}${legend}</svg>`;
}

function showTab(name, button) {
  document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((tab) => tab.classList.remove('active'));
  document.getElementById(`tab-${name}`)?.classList.add('active');
  button?.classList.add('active');

  const raw = sessionStorage.getItem('aqvis_result');
  let result = null;
  try { result = raw ? JSON.parse(raw) : null; } catch (error) {}
  result = result || currentResultData;

  if (typeof _threeState !== 'undefined' && _threeState?.setDecayActive) {
    _threeState.setDecayActive(name === 'decay', decayMethod, result);
  }
  if (typeof _threeState !== 'undefined' && _threeState?.setModeViewActive) {
    _threeState.setModeViewActive(name === 'modos');
  }

  if (name === 'modos' && result && typeof renderModesDensity === 'function') {
    renderModesDensity(result);
  }

  if (name === 'decay' && result) {
    renderDecayToggle(result);
    requestAnimationFrame(() => renderRT60Chart(result, decayMethod));
  }

  // Lo mismo que decay, que faltaba. El SVG de Bolt se genera en el
  // renderizado inicial, cuando .tab-pane sigue en display:none y
  // container.clientWidth vale 0: caia al `|| 400` y el grafico se dibujaba
  // a 400x400 dentro de una caja de 380, desbordandola, y no se volvia a
  // dibujar nunca. Se veia porque la caja lleva overflow:visible.
  if (name === 'bolt' && result && typeof renderBoltChart === 'function') {
    requestAnimationFrame(() => renderBoltChart(result));
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