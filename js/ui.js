/**
 * ui.js — Lógica de interfaz y wizard
 * AQVIS v2.0
 */

'use strict';

// ═══════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════

let currentStep      = 1;
let materialMode     = 'library';
let hasTreatment     = null;
let currentResultInput = null;

const STEP_LABELS = {
  1: 'Espacio',
  2: 'Temperatura',
  3: 'Materiales',
  4: 'Absorción',
  5: 'Tratamiento',
  6: 'Detalle',
};

// ═══════════════════════════════════════
// NAVEGACIÓN
// ═══════════════════════════════════════

function goHome()        { window.location.href = 'index.html'; }
function goToSimulator() { window.location.href = 'simulator.html'; }
function goToResults()   { window.location.href = 'results.html'; }

// ═══════════════════════════════════════
// TIMELINE
// ═══════════════════════════════════════

function getStepSequence() {
  const seq = [1, 2, 3];
  if (materialMode === 'custom') seq.push(4);
  seq.push(5);
  if (hasTreatment === true) seq.push(6);
  return seq;
}

function updateTimeline() {
  const seq = getStepSequence();
  const nav = document.getElementById('timeline');
  if (!nav) return;
  nav.innerHTML = seq.map(s => {
    const idx    = seq.indexOf(s);
    const curIdx = seq.indexOf(currentStep);
    let cls = '';
    if (s === currentStep) cls = 'active';
    else if (idx < curIdx) cls = 'done';
    return `<div class="tl-pill ${cls}">${STEP_LABELS[s]}</div>`;
  }).join('');
}

// ═══════════════════════════════════════
// WIZARD PASOS
// ═══════════════════════════════════════

function goToStep(next) {
  const curEl = document.getElementById('step-' + currentStep);
  const nxtEl = document.getElementById('step-' + next);
  if (!curEl || !nxtEl) return;
  curEl.style.animation = 'fadeOut 0.2s ease forwards';
  setTimeout(() => {
    curEl.classList.remove('active');
    curEl.style.animation = '';
    nxtEl.classList.add('active');
    currentStep = next;
    updateTimeline();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 200);
}

function afterMaterials() {
  if (materialMode === 'custom') goToStep(4);
  else goToStep(5);
}

function afterCustomAbsorption() {
  goToStep(5);
}

// ═══════════════════════════════════════
// MODO MATERIAL
// ═══════════════════════════════════════

function setMaterialMode(mode) {
  materialMode = mode;
  document.querySelectorAll('.mtog-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('mtog-' + mode);
  if (btn) btn.classList.add('active');
  const libRows  = document.getElementById('lib-rows');
  const custNote = document.getElementById('custom-note');
  if (libRows)  libRows.style.display  = mode === 'library' ? 'block' : 'none';
  if (custNote) custNote.style.display = mode === 'custom'  ? 'block' : 'none';
  updateTimeline();
}

// ═══════════════════════════════════════
// TRATAMIENTO YES/NO
// ═══════════════════════════════════════

function selectTreatment(val) {
  hasTreatment = val;
  document.querySelectorAll('.yn-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(val ? 'yn-yes' : 'yn-no');
  if (card) card.classList.add('selected');
  const btn = document.getElementById('treat-continue-btn');
  if (btn) {
    btn.style.display    = 'flex';
    btn.style.opacity    = '0';
    setTimeout(() => { btn.style.opacity = '1'; btn.style.transition = 'opacity 0.3s'; }, 10);
  }
  updateTimeline();
}

function continueTreatment() {
  if (hasTreatment === null) return;
  if (hasTreatment) goToStep(6);
  else runAndRedirect();
}

// ═══════════════════════════════════════
// SLIDERS
// ═══════════════════════════════════════

function syncSlider(input, valId, suffix) {
  const val = parseInt(input.value);
  const pct = ((val - parseInt(input.min)) / (parseInt(input.max) - parseInt(input.min))) * 100;
  input.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--surface3) ${pct}%)`;
  const label = document.getElementById(valId);
  if (label) label.textContent = val + suffix;
}

function initSliders() {
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    const valId  = slider.dataset.valId;
    const suffix = slider.dataset.suffix || '';
    if (valId) syncSlider(slider, valId, suffix);
    slider.addEventListener('input', () => syncSlider(slider, valId, suffix));
  });
}

// ═══════════════════════════════════════
// ALPHA DISPLAY
// ═══════════════════════════════════════

function avgAlpha(alphaArr) {
  return alphaArr.reduce((a, b) => a + b, 0) / alphaArr.length;
}

function updateAlphaDisplay(select, alphaId) {
  const name = select.options[select.selectedIndex]?.text;
  const el   = document.getElementById(alphaId);
  if (!el) return;
  const db = CONSTRUCTION_MATERIALS[name] || TREATMENT_MATERIALS[name];
  if (db) el.textContent = 'ᾱ ' + avgAlpha(db.alpha).toFixed(2);
}

// ═══════════════════════════════════════
// DROPDOWNS FILTRADOS POR SUPERFICIE ✅
// ═══════════════════════════════════════

function buildMaterialDropdowns() {
  const surfIds = ['piso', 'techo', 'pared1', 'pared2', 'pared3', 'pared4'];
  surfIds.forEach(surfId => {
    const sel = document.getElementById('mat-' + surfId);
    if (!sel) return;
    const names = getConstructionForSurface(surfId);
    sel.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
    // Actualizar alpha inicial
    const alphaEl = document.getElementById('alpha-' + surfId);
    if (alphaEl && names.length > 0) {
      const db = CONSTRUCTION_MATERIALS[names[0]];
      if (db) alphaEl.textContent = 'ᾱ ' + avgAlpha(db.alpha).toFixed(2);
    }
  });
}

function buildTreatmentDropdowns() {
  const surfIds = ['piso', 'techo', 'pared1', 'pared2', 'pared3', 'pared4'];
  surfIds.forEach(surfId => {
    const sel = document.getElementById('treat-mat-' + surfId);
    if (!sel) return;
    const names = getTreatmentForSurface(surfId);
    sel.innerHTML = `<option value="">Sin tratamiento</option>` +
      names.map(n => `<option value="${n}">${n}</option>`).join('');
  });
}

// ═══════════════════════════════════════
// VALIDACIÓN M² TRATAMIENTO ✅
// ═══════════════════════════════════════

function getSurfaceArea(surfId, L, W, H) {
  if (surfId === 'piso' || surfId === 'techo') return L * W;
  if (surfId === 'pared1' || surfId === 'pared2') return L * H;
  if (surfId === 'pared3' || surfId === 'pared4') return W * H;
  return Infinity;
}

function initTreatmentValidation() {
  const surfIds = ['piso', 'techo', 'pared1', 'pared2', 'pared3', 'pared4'];
  surfIds.forEach(surfId => {
    const input = document.getElementById('treat-m2-' + surfId);
    if (!input) return;

    input.addEventListener('input', () => {
      const L = parseFloat(document.getElementById('w-largo')?.value) || 6;
      const W = parseFloat(document.getElementById('w-ancho')?.value) || 4.5;
      const H = parseFloat(document.getElementById('w-alto')?.value) || 2.8;
      const maxArea = getSurfaceArea(surfId, L, W, H);
      const val     = parseFloat(input.value);

      // Limpiar feedback anterior
      let feedback = input.parentElement.querySelector('.treat-feedback');
      if (!feedback) {
        feedback = document.createElement('div');
        feedback.className = 'treat-feedback';
        input.parentElement.appendChild(feedback);
      }

      if (val > maxArea) {
        // ❌ Excede área
        input.classList.add('input-error');
        input.value = maxArea.toFixed(1);
        feedback.textContent = `❌ Máx: ${maxArea.toFixed(1)} m²`;
        feedback.style.color = '#FF4444';
      } else if (val > 0) {
        // ✅ Válido
        input.classList.remove('input-error');
        const available = (maxArea - val).toFixed(1);
        feedback.textContent = `✓ Disponible: ${available} m²`;
        feedback.style.color = '#00C2CB';
      } else {
        input.classList.remove('input-error');
        feedback.textContent = `Área superficie: ${maxArea.toFixed(1)} m²`;
        feedback.style.color = 'var(--text3)';
      }
    });

    // Mostrar área disponible al entrar al campo
    input.addEventListener('focus', () => {
      const L = parseFloat(document.getElementById('w-largo')?.value) || 6;
      const W = parseFloat(document.getElementById('w-ancho')?.value) || 4.5;
      const H = parseFloat(document.getElementById('w-alto')?.value) || 2.8;
      const maxArea = getSurfaceArea(surfId, L, W, H);
      input.max = maxArea.toFixed(2);
      let feedback = input.parentElement.querySelector('.treat-feedback');
      if (!feedback) {
        feedback = document.createElement('div');
        feedback.className = 'treat-feedback';
        input.parentElement.appendChild(feedback);
      }
      if (!input.value || parseFloat(input.value) === 0) {
        feedback.textContent = `Área superficie: ${maxArea.toFixed(1)} m²`;
        feedback.style.color = 'var(--text3)';
      }
    });
  });
}

// ═══════════════════════════════════════
// RECOPILAR INPUTS
// ═══════════════════════════════════════

function getInputs() {
  const L = parseFloat(document.getElementById('w-largo')?.value);
  const W = parseFloat(document.getElementById('w-ancho')?.value);
  const H = parseFloat(document.getElementById('w-alto')?.value);
  let T   = parseInt(document.getElementById('w-temp')?.value, 10);

  const safeL = isNaN(L) ? 6.0 : L;
  const safeW = isNaN(W) ? 4.5 : W;
  const safeH = isNaN(H) ? 2.8 : H;
  if (isNaN(T) || T < 10 || T > 30) T = 20;

  const surfDefs = [
    { id: 'piso',   name: 'Piso',    area: safeL * safeW },
    { id: 'techo',  name: 'Techo',   area: safeL * safeW },
    { id: 'pared1', name: 'Pared 1', area: safeL * safeH },
    { id: 'pared2', name: 'Pared 2', area: safeL * safeH },
    { id: 'pared3', name: 'Pared 3', area: safeW * safeH },
    { id: 'pared4', name: 'Pared 4', area: safeW * safeH },
  ];

  const surfaces = surfDefs.map(def => {
    let alpha, materialName;

    if (materialMode === 'custom') {
      alpha = BANDS.map((_, bi) => {
        const val = parseFloat(document.getElementById(`abs-${def.id}-${bi}`)?.value);
        return isNaN(val) ? 0.05 : Math.min(1, Math.max(0, val));
      });
      materialName = 'Custom';
    } else {
      const sel = document.getElementById('mat-' + def.id);
      materialName = sel?.options[sel.selectedIndex]?.value || sel?.options[sel.selectedIndex]?.text;
      alpha = CONSTRUCTION_MATERIALS[materialName]?.alpha || Array(6).fill(0.05);
    }

    let treatment = null;
    if (hasTreatment) {
      const treatSel  = document.getElementById('treat-mat-' + def.id);
      const treatName = treatSel?.options[treatSel.selectedIndex]?.value;
      const treatM2   = parseFloat(document.getElementById('treat-m2-' + def.id)?.value);

      if (treatName && TREATMENT_MATERIALS[treatName] && !isNaN(treatM2) && treatM2 > 0) {
        // Clamp siempre por seguridad
        const safeM2 = Math.min(treatM2, def.area);
        alpha     = combineAlphaByArea(alpha, TREATMENT_MATERIALS[treatName].alpha, def.area, safeM2);
        treatment = { name: treatName, area: safeM2 };
      }
    }

    return { name: def.name, area: def.area, alpha, materialName, treatment };
  });

  return { L: safeL, W: safeW, H: safeH, T, surfaces, hasTreatment: hasTreatment === true };
}

// ═══════════════════════════════════════
// THEME
// ═══════════════════════════════════════

function setTheme(mode) {
  if (mode === 'light') document.body.classList.add('light-mode');
  else document.body.classList.remove('light-mode');
  try { localStorage.setItem('aqvis_theme', mode); } catch (e) {}
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = themeIcon(mode);
    btn.title     = mode === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
  }
}

function themeIcon(mode) {
  const sun  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`;
  const moon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor"/></svg>`;
  return mode === 'light' ? sun : moon;
}

function toggleTheme() {
  const isLight = document.body.classList.contains('light-mode');
  const btn = document.getElementById('theme-toggle');
  if (btn) { btn.classList.add('spin'); setTimeout(() => btn.classList.remove('spin'), 450); }
  setTheme(isLight ? 'dark' : 'light');
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('aqvis_theme'); } catch(e) {}
  if (!saved) saved = (window.matchMedia?.('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  setTheme(saved);
}

// ═══════════════════════════════════════
// RUN SIMULATION
// ═══════════════════════════════════════

function runAndRedirect() {
  const inp = getInputs();
  const res = calculate(inp);

  const clean = JSON.parse(JSON.stringify(res, (_, v) =>
    typeof v === 'number' && !isFinite(v) ? null : v
  ));

  sessionStorage.setItem('aqvis_input',  JSON.stringify(inp));
  sessionStorage.setItem('aqvis_result', JSON.stringify(clean));
  goToResults();
}

// ═══════════════════════════════════════
// RESULTS — DECAY (selector de método + gráfico RT60)
// El resto de paneles de resultados los arma renderer.js
// (renderResults / renderModes / renderBolt); este archivo es dueño
// del panel Decay completo (selector + SVG), reutilizado también
// desde showTab() al abrir la pestaña.
// ═══════════════════════════════════════

const DECAY_METHODS = {
  sabine:     { key: 'RT_sabine',     color: '#FF8C00', label: 'Sabine',     always: true  },
  eyring:     { key: 'RT_eyring',     color: '#3A7BFF', label: 'Eyring',     always: true  },
  fitzroy:    { key: 'RT_fitzroy',    color: '#00CC66', label: 'Fitzroy',    always: false },
  millington: { key: 'RT_millington', color: '#FF4444', label: 'Millington', always: false },
};

let decayMethod = 'sabine';

// ── Selector de método ──────────────────────────────────────────

function renderDecayToggle(res) {
  const wrap = document.getElementById('decay-method-toggle');
  if (!wrap) return;

  const active = DECAY_METHODS[decayMethod];
  if (!active || (!active.always && !res.hasTreatment)) decayMethod = 'sabine';

  const entries = Object.entries(DECAY_METHODS).filter(([, d]) => d.always || res.hasTreatment);

  wrap.innerHTML = entries.map(([key, d]) => {
    const data = res[d.key];
    const mid  = data ? (data[3] ?? data[2]) : null;
    const cls  = (mid !== null && mid !== undefined) ? classifyRT(mid) : null;
    const dot  = cls ? `<span class="decay-status-dot rt-${cls}"></span>` : '';
    return `<button type="button" class="mtog-btn${key === decayMethod ? ' active' : ''}" onclick="setDecayMethod('${key}')">${dot}${d.label}</button>`;
  }).join('');
}

function setDecayMethod(method) {
  if (!DECAY_METHODS[method]) return;
  decayMethod = method;
  const stored = sessionStorage.getItem('aqvis_result');
  if (!stored) return;
  try {
    const res = JSON.parse(stored);
    if (typeof _threeState !== 'undefined' && _threeState?.setDecay) {
      _threeState.setDecay(decayMethod, res);
    }
    renderDecayToggle(res);
    renderRT60Chart(res, decayMethod);
    const label = document.getElementById('decay-3d-label');
    if (label) label.textContent = `Reflexiones 3D: ${DECAY_METHODS[decayMethod].label}`;
  } catch (e) {}
}

// ── RT60 Gráfico 2D SVG — una curva a la vez ────────────────────

function renderRT60Chart(res, method) {
  const container = document.getElementById('rt-chart');
  if (!container) return;

  method = method || decayMethod;
  const def  = DECAY_METHODS[method] || DECAY_METHODS.sabine;
  const data = res[def.key];

  const W = container.clientWidth  || 520;
  const H = container.clientHeight || 260;

  const PAD = { top: 20, right: 20, bottom: 44, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top  - PAD.bottom;

  // Rango Y estable entre métodos, para que cambiar de curva no reescale el eje
  const allValues = [
    ...res.RT_sabine,
    ...res.RT_eyring,
    ...(res.hasTreatment && res.RT_fitzroy    ? res.RT_fitzroy    : []),
    ...(res.hasTreatment && res.RT_millington ? res.RT_millington : []),
  ].filter(v => v !== null && v !== undefined && isFinite(v));

  const yMax = Math.ceil(Math.max(...allValues, 1.0) * 10) / 10 + 0.2;
  const yMin = 0;

  const xPos  = i => PAD.left + (i / (BANDS.length - 1)) * innerW;
  const yPos  = v => PAD.top  + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const toPath = (d) => {
    if (!d) return '';
    return d.map((v, i) =>
      v !== null && v !== undefined && isFinite(v)
        ? `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`
        : ''
    ).filter(Boolean).join(' ');
  };

  const toCircles = (d, color) => {
    if (!d) return '';
    return d.map((v, i) => {
      if (v === null || v === undefined || !isFinite(v)) return '';
      return `<circle cx="${xPos(i).toFixed(1)}" cy="${yPos(v).toFixed(1)}" r="4"
        fill="${color}" stroke="var(--bg)" stroke-width="1.5"
        data-tooltip="${BAND_LABELS[i]}Hz: ${v.toFixed(1)}s"></circle>`;
    }).join('');
  };

  // Líneas de grid Y
  const yGridSteps = 5;
  const yGridLines = Array.from({ length: yGridSteps + 1 }, (_, i) => {
    const v = yMin + (i / yGridSteps) * (yMax - yMin);
    const y = yPos(v);
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${PAD.left + innerW}" y2="${y.toFixed(1)}"
      stroke="var(--border2)" stroke-width="0.5" stroke-dasharray="4,3"/>
      <text x="${(PAD.left - 8).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end"
        font-size="11" fill="var(--text3)" font-family="var(--font-mono)">${v.toFixed(1)}</text>`;
  }).join('');

  // Etiquetas X
  const xLabels = BAND_LABELS.map((lbl, i) =>
    `<text x="${xPos(i).toFixed(1)}" y="${(PAD.top + innerH + 20).toFixed(1)}"
      text-anchor="middle" font-size="11" fill="var(--text3)" font-family="var(--font-mono)">${lbl}</text>`
  ).join('');

  // Líneas verticales
  const xGridLines = BAND_LABELS.map((_, i) =>
    `<line x1="${xPos(i).toFixed(1)}" y1="${PAD.top}" x2="${xPos(i).toFixed(1)}" y2="${(PAD.top + innerH).toFixed(1)}"
      stroke="var(--border2)" stroke-width="0.5" stroke-dasharray="2,4"/>`
  ).join('');

  // Curva única del método seleccionado
  const d = toPath(data);
  const pathEl = d
    ? `<path d="${d}" fill="none" stroke="${def.color}" stroke-width="2.5"
         stroke-linejoin="round" stroke-linecap="round"/>
       ${toCircles(data, def.color)}`
    : `<text x="${(PAD.left + innerW / 2).toFixed(1)}" y="${(PAD.top + innerH / 2).toFixed(1)}"
        text-anchor="middle" font-size="11" fill="var(--text3)" font-family="var(--font-mono)">Sin datos para ${def.label}</text>`;

  // Eje labels
  const yAxisLabel = `<text transform="rotate(-90)" x="${-(PAD.top + innerH / 2)}" y="14"
    text-anchor="middle" font-size="11" fill="var(--text3)" font-family="var(--font-mono)">RT60 (s)</text>`;
  const xAxisLabel = `<text x="${(PAD.left + innerW / 2).toFixed(1)}" y="${(H - 4).toFixed(1)}"
    text-anchor="middle" font-size="11" fill="var(--text3)" font-family="var(--font-mono)">Frecuencia (Hz)</text>`;

  // Etiqueta del método activo (reemplaza la leyenda multi-curva)
  const legendEl = `<g transform="translate(${PAD.left}, ${(PAD.top + innerH + 30).toFixed(1)})">
    <line x1="0" y1="7" x2="18" y2="7" stroke="${def.color}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="9" cy="7" r="3" fill="${def.color}"/>
    <text x="22" y="11" font-size="11" fill="var(--text2)" font-family="var(--font-body)">${def.label}</text>
  </g>`;

  const totalH = H + 30;

  container.innerHTML = `
    <svg width="${W}" height="${totalH}" xmlns="http://www.w3.org/2000/svg"
         style="display:block;overflow:visible">
      ${yGridLines}
      ${xGridLines}
      ${pathEl}
      ${xLabels}
      ${yAxisLabel}
      ${xAxisLabel}
      ${legendEl}
    </svg>`;
}

// renderModes() y renderBolt() viven en renderer.js (dueño único de
// esos paneles en results.html); aquí solo queda el helper de gráfico
// RT60 de más arriba, compartido con showTab().

// ═══════════════════════════════════════
// RESULTS — RECALCULAR
// ═══════════════════════════════════════

function recalculate() {
  const overlay = document.getElementById('recalc-overlay');
  if (overlay) overlay.classList.add('active');

  setTimeout(() => {
    const L = parseFloat(document.getElementById('res-largo')?.value);
    const W = parseFloat(document.getElementById('res-ancho')?.value);
    const H = parseFloat(document.getElementById('res-alto')?.value);
    let T   = parseInt(document.getElementById('res-temp')?.value, 10);

    const safeL = isNaN(L) ? 6.0 : L;
    const safeW = isNaN(W) ? 4.5 : W;
    const safeH = isNaN(H) ? 2.8 : H;
    if (isNaN(T) || T < 10 || T > 30) T = 20;

    const surfDefs = [
      { id: 'piso',   name: 'Piso',    area: safeL * safeW },
      { id: 'techo',  name: 'Techo',   area: safeL * safeW },
      { id: 'pared1', name: 'Pared 1', area: safeL * safeH },
      { id: 'pared2', name: 'Pared 2', area: safeL * safeH },
      { id: 'pared3', name: 'Pared 3', area: safeW * safeH },
      { id: 'pared4', name: 'Pared 4', area: safeW * safeH },
    ];

    const base = currentResultInput ? JSON.parse(JSON.stringify(currentResultInput)) : null;
    const inp  = base || { L: safeL, W: safeW, H: safeH, T, surfaces: [], hasTreatment: false };
    inp.L = safeL; inp.W = safeW; inp.H = safeH; inp.T = T;

    if (!base) {
      inp.surfaces = surfDefs.map(def => ({ name: def.name, area: def.area, alpha: Array(6).fill(0.05), materialName: null, treatment: null }));
    }

    inp.surfaces.forEach((surface, index) => {
      const def = surfDefs[index];
      surface.area = def.area;
      const sel    = document.getElementById('res-mat-' + def.id);
      const sName  = sel?.options[sel.selectedIndex]?.text;
      if (sName && CONSTRUCTION_MATERIALS[sName]) {
        surface.alpha        = [...CONSTRUCTION_MATERIALS[sName].alpha];
        surface.materialName = sName;
      }
      if (surface.treatment?.name && surface.treatment?.area > 0) {
        const t = TREATMENT_MATERIALS[surface.treatment.name];
        if (t) surface.alpha = combineAlphaByArea(surface.alpha, t.alpha, def.area, surface.treatment.area);
      }
    });

    const res = calculate(inp);
    renderResults(res, inp);
    currentResultInput = inp;
    sessionStorage.setItem('aqvis_input',  JSON.stringify(inp));
    sessionStorage.setItem('aqvis_result', JSON.stringify(res));
    if (overlay) overlay.classList.remove('active');
  }, 750);
}

// ═══════════════════════════════════════
// TABS
// ═══════════════════════════════════════

function showTab(name, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('tab-' + name);
  if (pane) pane.classList.add('active');
  if (btn)  btn.classList.add('active');

  if (typeof _threeState !== 'undefined' && _threeState?.setDecayActive) {
    const storedForScene = sessionStorage.getItem('aqvis_result');
    let resultForScene = null;
    try { resultForScene = storedForScene ? JSON.parse(storedForScene) : null; } catch (e) {}
    _threeState.setDecayActive(name === 'decay', decayMethod, resultForScene);
  }

  // Re-renderizar gráfico si se abre tab Decay (para dimensiones correctas)
  if (name === 'decay') {
    const stored = sessionStorage.getItem('aqvis_result');
    if (stored) {
      try {
        const res = JSON.parse(stored);
        renderDecayToggle(res);
        renderRT60Chart(res, decayMethod);
      } catch(e) {}
    }
  }
}

// ═══════════════════════════════════════
// INIT GLOBAL
// ═══════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initSliders();
  initTheme();
  updateTimeline();

  // Preview velocidad del sonido
  const tempSlider = document.getElementById('w-temp');
  const preview    = document.getElementById('vsound-preview');
  if (tempSlider && preview) {
    const update = () => {
      const T = parseInt(tempSlider.value);
      const c = (331.3 + 0.606 * T).toFixed(1);
      preview.textContent = `c = ${c} m/s a ${T}°C`;
    };
    tempSlider.addEventListener('input', update);
    update();
  }

  // Dropdowns filtrados por superficie
  buildMaterialDropdowns();
  buildTreatmentDropdowns();

  // Validación m² tratamiento
  initTreatmentValidation();

  // La carga de resultados en results.html (leer sessionStorage,
  // rellenar inputs, poblar selects de material y llamar a
  // renderResults) la hace por completo el DOMContentLoaded de
  // renderer.js — evita duplicar el render acá.
});
