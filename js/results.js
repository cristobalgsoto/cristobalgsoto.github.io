// ════════════════════════════════════════════════════════════════
// LOS CUATRO MODELOS DE RT60
//
// Cada uno trae, además de lo que necesita el gráfico, el texto que se
// enseña en la tarjeta de origen bajo la curva: de dónde salió la
// fórmula, qué supone y cuándo deja de valer.
//
// Las cuatro fórmulas estan escritas CONTRA EL CÓDIGO de aqengine.js, no
// contra el libro: todas llevan el término de aire 4mV porque el motor lo
// calcula, y las cuatro comparten la misma T para que se vea que lo único
// que cambia de un modelo a otro es cómo se cuenta la absorción A.
// ════════════════════════════════════════════════════════════════

// La fórmula del tiempo es la misma en los cuatro. Lo que cambia es A.
const FX_TIEMPO = '*T* = {0.161·*V* | *A* + 4*mV*}';

const DECAY_METHODS = {
  sabine: {
    key: 'RT_sabine', color: '#FF8C00', label: 'Sabine', always: true,
    anio: 1898,
    titulo: 'Sabine · 1898',
    tip: 'El modelo original y el más usado. Reparte la absorción por igual por toda la sala y da el tiempo que tarda el sonido en caer 60 dB.',
    historia:
      'En 1895 la sala de conferencias del museo Fogg, en Harvard, era inservible: una palabra seguía sonando cuando el orador ya llevaba cinco más. El encargo le cayó a Wallace Clement Sabine, un profesor ayudante de física de veintisiete años. Trabajó de noche, cuando el edificio callaba, arrastrando los cojines de los bancos del Sanders Theatre de un lado a otro para ir cambiando la absorción de la sala, y midiendo con un tubo de órgano y un cronómetro cuánto tardaba el sonido en dejar de oírse. De ahí salió la primera ley de la acústica de salas: el tiempo de caída sube con el volumen y baja con la absorción. Y de ahí salió, en 1900, el Boston Symphony Hall, la primera sala de conciertos del mundo calculada antes de levantarla. Sigue siendo una de las mejores.',
    cuando:
      'Es el modelo de referencia, y el que usa AQVIS para el resumen: los coeficientes de absorción tabulados se miden en cámara reverberante por el método del propio Sabine, así que devolverlos a su ecuación es lo coherente. Se queda largo cuando la sala absorbe mucho, porque su fórmula nunca llega a cero aunque las paredes se lo traguen todo.',
    fxA: '*A* = Σ *S*_i·*α*_i',
  },

  eyring: {
    key: 'RT_eyring', color: '#3A7BFF', label: 'Eyring', always: true,
    anio: 1930,
    titulo: 'Eyring · 1930',
    tip: 'Corrige a Sabine en salas muy absorbentes. Cuenta el sonido por rebotes en vez de como algo continuo, así que si todo se absorbe el tiempo sí llega a cero.',
    historia:
      'Treinta años después, el cine sonoro necesitaba salas «muertas» donde grabar, y en los Bell Telephone Laboratories las estaban construyendo. En esas salas la fórmula de Sabine daba siempre más tiempo del que se medía. Carl F. Eyring publicó en 1930 el porqué: Sabine trata la absorción como algo continuo, y el sonido en realidad se va a saltos, un rebote cada vez, y en cada rebote se queda la fracción que no se absorbió. Contarlo así cambia una proporción por un logaritmo, y el resultado hace lo que tiene que hacer: si las paredes se lo tragan todo, el sonido se acaba en el primer rebote.',
    cuando:
      'Gana a Sabine cuando la absorción media pasa de 0.2 más o menos. Por debajo de ahí las dos dicen lo mismo, porque para valores pequeños −ln(1−α) y α son casi el mismo número.',
    fxA: '*A* = −*S*·ln(1 − *α*)',
  },

  fitzroy: {
    key: 'RT_fitzroy', color: '#00CC66', label: 'Fitzroy', always: false,
    anio: 1959,
    titulo: 'Fitzroy · 1959',
    tip: 'Para salas con la absorción mal repartida: alfombra en el suelo y techo y paredes duros. Calcula cada eje por separado y promedia.',
    historia:
      'Los tres modelos anteriores suponen que el sonido llega a todas partes por igual. Daniel Fitzroy publicó en 1959 que eso se rompe en cuanto la absorción está mal repartida, que es el caso de casi cualquier sala real: alfombra en el suelo, y techo y paredes duros. Ahí el sonido no decae igual en las tres direcciones — muere rápido entre suelo y techo y sigue rebotando entre las paredes — y una sola cifra media no describe nada. Su idea fue calcular el tiempo de cada eje por separado, con el par de planos paralelos de ese eje, y promediar los tres pesando cada uno por la superficie que ocupa.',
    cuando:
      'Úsalo cuando el tratamiento esté concentrado en unas pocas superficies. Si la absorción está bien repartida los tres ejes coinciden y Fitzroy devuelve prácticamente lo mismo que Eyring. Necesita tratamiento definido, por eso no aparece sin él.',
    fxA: '*A* = *S*·Σ_k {*S*_k | *S*}·(−ln(1 − *α*_k))',
  },

  millington: {
    key: 'RT_millington', color: '#FF4444', label: 'Millington', always: false,
    anio: 1932,
    titulo: 'Millington · 1932',
    tip: 'Aplica la cuenta de Eyring superficie por superficie en vez de sobre el α medio. Es la más fina sobre el papel y la que da el tiempo más corto.',
    historia:
      'Eyring arregla lo del rebote, pero sigue usando un solo α medio para toda la sala. G. Millington señaló en 1932 — y W. J. Sette casi a la vez, por eso a veces se la llama Millington-Sette — que eso no es lo mismo que promediar bien: el logaritmo de la media no es la media de los logaritmos. Su propuesta es hacer la cuenta de Eyring superficie por superficie y sumar después, que sobre el papel es lo correcto.',
    cuando:
      'Es la más exacta en teoría y la más frágil en la práctica: basta con que una sola superficie absorba del todo para que su logaritmo se dispare y la fórmula dé cero, por pequeña que sea esa superficie. Castiga mucho los materiales muy absorbentes, así que casi siempre da el RT60 más corto de los cuatro. Necesita tratamiento definido.',
    fxA: '*A* = Σ *S*_i·(−ln(1 − *α*_i))',
  },
};

// La leyenda de símbolos, común a las cuatro. Va al pie de la tarjeta
// porque una fórmula sin saber qué es cada letra no explica nada.
const FX_LEYENDA = [
  ['*T*', 'tiempo de reverberación, en segundos'],
  ['*V*', 'volumen de la sala (m³)'],
  ['*S*', 'superficie total; *S*_i la de cada cara y *S*_k la de cada par de caras paralelas'],
  ['*α*', 'coeficiente de absorción, de 0 a 1; sin subíndice, el medio ponderado por área'],
  ['4*mV*', 'lo que absorbe el propio aire, que sólo pesa en las bandas agudas'],
];

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
    const status = Number.isFinite(tm) ? `<span class="decay-status-dot rt-${claseRT(tm)}"></span>` : '';
    // El tooltip dice lo que el nombre no puede: qué supone cada fórmula.
    // Y, si hay cifra, con qué T_m se ha encendido el punto de estado.
    const tip = Number.isFinite(tm)
      ? `${method.tip} · T_m = ${tm.toFixed(2)} s`
      : method.tip;
    return `<button type="button" class="mtog-btn${key === decayMethod ? ' active' : ''}" onclick="setDecayMethod('${key}')" data-tooltip-title="${method.titulo}" data-tooltip="${tip}">${status}${method.label}</button>`;
  }).join('');
}

/**
 * La tarjeta de origen bajo la curva: de dónde salió el modelo que está
 * seleccionado, su fórmula compuesta y cuándo deja de valer.
 *
 * Ocupa el hueco que el rediseño dejó bajo el gráfico — la columna
 * derecha es alta y fija, así que la de análisis se estiraba para
 * acompañarla y la pestaña de Decay se quedaba medio vacía.
 */
function renderDecayOrigen(clave) {
  // Envuelta a propósito: esta tarjeta es informativa, y si algo falla
  // dentro NO puede llevarse por delante el gráfico. Ya pasó — una
  // expresión regular mal escrita aquí dejó la curva de RT60 en blanco,
  // porque la llamada que la dibuja venía justo detrás.
  try {
    pintarDecayOrigen(clave);
  } catch (error) {
    console.error('No se pudo pintar la tarjeta de origen del modelo.', error);
  }
}

function pintarDecayOrigen(clave) {
  const m = DECAY_METHODS[clave];
  const card = document.getElementById('decay-origen');
  if (!m || !card) return;

  const pon = (id, texto) => {
    const el = document.getElementById(id);
    if (el) el.textContent = texto;
  };
  pon('decay-origen-title', m.titulo);
  pon('decay-origen-body', m.historia);
  pon('decay-origen-when', m.cuando);

  const eqs = document.getElementById('decay-origen-eqs');
  if (eqs) {
    eqs.innerHTML =
      `<div class="fx-row">${fx(FX_TIEMPO, 'fx-lg')}</div>` +
      `<div class="fx-where">donde la absorción equivalente vale</div>` +
      `<div class="fx-row">${fx(m.fxA, 'fx-lg')}</div>`;
  }

  const ley = document.getElementById('decay-origen-legend');
  if (ley) {
    ley.innerHTML = FX_LEYENDA
      .map(([simbolo, que]) => `<div class="fx-leg-item">${fx(simbolo, 'fx-sm')}<span>${fxTexto(que)}</span></div>`)
      .join('');
  }
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
    renderDecayOrigen(decayMethod);
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
      ? `${unidadBanda(BAND_LABELS[index])}: ${value.toFixed(2)} s — brecha ${m.min.toFixed(2)} a ${m.max.toFixed(2)} s`
      : `${unidadBanda(BAND_LABELS[index])}: ${value.toFixed(1)} s`;
    const anillo = fuera
      ? `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="7.5" fill="none" stroke="${FUERA}" stroke-width="1.5"/>`
      : '';
    return anillo + `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="4" fill="${config.color}" stroke="var(--bg)" stroke-width="1.5" data-tooltip="${tip}"></circle>`;
  }).join('');

  // ── La frecuencia de Schroeder ────────────────────────────────
  // El eje X son las seis bandas de OCTAVA colocadas por índice, así que
  // una frecuencia cualquiera cae en log2(f/125): 353 Hz -> 1.50, justo
  // entre 250 y 500. Sólo se dibuja si entra en el eje; por debajo de
  // 125 Hz o por encima de 4 kHz no hay dónde ponerla.
  //
  // Es la línea que separa las dos mitades del gráfico: a su izquierda
  // mandan los modos individuales y el campo NO es difuso, así que ahí
  // Sabine y Eyring —y con ellos todo lo que se dibuja— valen menos.
  let schroederMarkup = '';
  if (Number.isFinite(res.schroeder) && res.schroeder > 0) {
    const idx = Math.log2(res.schroeder / BANDS[0]);
    if (idx >= 0 && idx <= BANDS.length - 1) {
      const sx = pad.left + (idx / (BANDS.length - 1)) * innerWidth;
      schroederMarkup =
        `<line x1="${sx.toFixed(1)}" y1="${pad.top}" x2="${sx.toFixed(1)}" y2="${(pad.top + innerHeight).toFixed(1)}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5,3" data-tooltip-title="Frecuencia de Schroeder" data-tooltip="Está en ${Math.round(res.schroeder)} Hz. A su izquierda la sala suena por resonancias sueltas y el campo no es parejo, así que todo lo que se dibuja en esa zona vale menos."/>` +
        `<text x="${sx.toFixed(1)}" y="${(pad.top - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--accent)" font-family="var(--font-mono)">Schroeder</text>`;
    }
  }

  // ── El campo de tolerancia de EBU, dibujado ───────────────────
  // El borde superior se quiebra en 125 Hz porque la tolerancia se
  // ensancha hacia graves; el inferior es plano en -0.05 s.
  let brechaMarkup = '';
  if (lm) {
    const arriba = lm.brecha.map((m, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)},${y(m.max).toFixed(1)}`).join(' ');
    const abajo = lm.brecha.map((m, i) => `L ${x(lm.brecha.length - 1 - i).toFixed(1)},${y(lm.brecha[lm.brecha.length - 1 - i].min).toFixed(1)}`).join(' ');
    const centro = y(lm.tm).toFixed(1);
    brechaMarkup =
      `<path d="${arriba} ${abajo} Z" fill="rgba(240,240,240,0.055)" stroke="none" data-tooltip-title="Franja de tolerancia" data-tooltip="Lo que EBU Tech 3276 da por bueno alrededor del tiempo medio de esta sala, ${lm.tm.toFixed(2)} s. Se ensancha hacia los graves porque allí se admite más reverberación."/>` +
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

  container.innerHTML = `<svg width="${width}" height="${height + 30}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">${yGrid}${xGrid}${brechaMarkup}${schroederMarkup}${pathMarkup}${yAxis}${xAxis}${legend}</svg>`;
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
    renderDecayOrigen(decayMethod);
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