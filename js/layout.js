/**
 * layout.js — Resumen lateral y vínculo pestañas ↔ vista 3D
 * AQVIS — layout de dos columnas (análisis a la izquierda, 3D + resumen a la derecha)
 *
 * Se carga después de renderer.js. No modifica el motor ni el renderer:
 * lee currentResultData / currentResultInput y envuelve showTab().
 */

'use strict';

const VIEW_CAPTIONS = {
  espacio: 'Espacio',
  vars: 'Parámetros',
  decay: 'Decay · reflexiones',
  modos: 'Modos propios',
  bolt: 'Proporciones (Bolt)',
};

const RT_CHIP_CLASE = { good: 'chip-good', warn: 'chip-warn', bad: 'chip-bad' };

// La insignia y la nota salen de la MISMA cuenta (lecturaEBU, en
// aqengine.js), así que no pueden contradecirse. Antes eran dos escalas
// independientes: una sala de 0.8 s recibía "RT60 adecuado" y debajo "algo
// elevado, considera tratamiento absorbente".
//
// El veredicto ya no sale del promedio T_m sino del CAMPO DE TOLERANCIA
// banda a banda. Un promedio puede estar en el objetivo con dos bandas muy
// fuera que se compensan entre sí, y eso no es una sala correcta: es una
// sala con un problema en graves y otro en agudos. La brecha lo ve.
function rtChip(res) {
  const l = lecturaEBU(res.RT_sabine, res.V, res.L, res.W);
  return { cls: RT_CHIP_CLASE[l.clase], label: l.etiqueta };
}

// La nota, sin la cifra inicial que el resumen ya muestra en grande justo
// encima. Sale directa de lecturaEBU, sin recortar texto.
function notaRT(res) {
  const texto = lecturaEBU(res.RT_sabine, res.V, res.L, res.W).nota;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function renderSummary(res, inp) {
  if (!res) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');

  set('s-rt', fmt(res.RT_avg, 2));
  set('s-vol', fmt(res.V));
  set('s-area', fmt(res.S_total));
  set('s-temp', inp && Number.isFinite(+inp.T) ? (+inp.T).toFixed(0) : '—');

  if (inp) {
    set('s-dims', `${fmt(+inp.L, 2)} × ${fmt(+inp.W, 2)} × ${fmt(+inp.H, 2)} m  (L × A × H)`);
  }

  const chip = document.getElementById('s-chip');
  if (chip && Array.isArray(res.RT_sabine) && typeof lecturaEBU === 'function') {
    const c = rtChip(res);
    chip.className = `chip ${c.cls}`;
    chip.textContent = c.label;
  }

  const note = document.getElementById('s-note');
  if (note && typeof lecturaEBU === 'function' && Array.isArray(res.RT_sabine)) {
    note.innerHTML = notaRT(res);
  }
}

function setViewCaption(name) {
  const el = document.getElementById('view-caption');
  if (el) el.innerHTML = `Vista: <b>${VIEW_CAPTIONS[name] || name}</b>`;
}

// Envolver showTab para que la vista 3D indique qué está mostrando
if (typeof showTab === 'function') {
  const _originalShowTab = showTab;
  // eslint-disable-next-line no-global-assign
  showTab = function (name, button) {
    _originalShowTab(name, button);
    setViewCaption(name);
  };
}

document.addEventListener('DOMContentLoaded', () => {
  // renderer.js rellena currentResultData/Input en su propio DOMContentLoaded,
  // que se registró antes que este; por eso aquí ya están disponibles.
  renderSummary(
    typeof currentResultData !== 'undefined' ? currentResultData : null,
    typeof currentResultInput !== 'undefined' ? currentResultInput : null,
  );
  setViewCaption('espacio');
});
