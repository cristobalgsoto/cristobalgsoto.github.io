/**
 * tests/aqengine.test.js — Suite de verificación del motor acústico.
 *
 * No depende de ningún paquete externo: usa el test runner y el módulo
 * assert que trae Node de fábrica (Node 18+). Se ejecuta con:
 *   node --test
 *
 * El objetivo no es solo fijar números "porque sí" (regresión ciega), sino
 * verificar PROPIEDADES FÍSICAS que las fórmulas deben cumplir siempre —
 * p.ej. que Fitzroy y Millington-Sette colapsan algebraicamente a Eyring
 * cuando el α es uniforme en las 6 superficies. Si alguien mete un signo o
 * un índice equivocado en una de esas fórmulas, el resultado sigue
 * "pareciendo" un RT60 razonable, pero esta igualdad se rompe — que es
 * exactamente el tipo de bug silencioso que este motor puede producir.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  calculate, speedOfSound, combineAlphaByArea, classifyRT,
  getConstructionForSurface, getTreatmentForSurface,
  pointInPolygon, BANDS, AIR_ABS_COEFF,
} = require('../js/aqengine.js');

// ─── Helper: sala rectangular con el mismo α en las 6 superficies ──────
function uniformRoom(L, W, H, alphaPerBand, T = 20) {
  const defs = [
    { id: 'piso' }, { id: 'techo' },
    { id: 'pared1' }, { id: 'pared2' },
    { id: 'pared3' }, { id: 'pared4' },
  ];
  const areaFor = (id) => (id === 'piso' || id === 'techo') ? L * W
    : (id === 'pared1' || id === 'pared2') ? L * H
    : W * H;
  const surfaces = defs.map((d) => ({ id: d.id, name: d.id, area: areaFor(d.id), alpha: alphaPerBand }));
  return { L, W, H, T, surfaces, hasTreatment: true };
}

// ════════════════════════════════════════════════════════════════
// Física básica
// ════════════════════════════════════════════════════════════════

test('speedOfSound: c = 331.3 + 0.606·T', () => {
  assert.equal(speedOfSound(0), 331.3);
  assert.ok(Math.abs(speedOfSound(20) - 343.42) < 1e-9);
});

test('RT60 Sabine coincide con 0.161·V / (S·α + 4mV) calculado de forma independiente', () => {
  const L = 6, W = 4, H = 3, T = 20;
  const alpha = Array(6).fill(0.10);
  const room = uniformRoom(L, W, H, alpha, T);
  const res = calculate(room);

  const V = L * W * H;
  const S_total = room.surfaces.reduce((s, sf) => s + sf.area, 0);

  BANDS.forEach((f, bi) => {
    const A = S_total * alpha[bi];
    const expected = Math.round(((0.161 * V) / (A + 4 * AIR_ABS_COEFF[bi] * V)) * 10) / 10;
    assert.equal(res.RT_sabine[bi], expected, `banda ${f}Hz`);
  });
});

test('RT60 Eyring converge a Sabine cuando α es pequeño (propiedad conocida: -ln(1-α) ≈ α)', () => {
  const room = uniformRoom(6, 4, 3, Array(6).fill(0.04));
  const res = calculate(room);
  // Tolerancia de 0.15s: ambos valores ya vienen redondeados a 1 decimal
  // (ver toFixed(1) en calculate()), así que una diferencia real pequeña
  // puede aparecer amplificada por el redondeo independiente de cada uno.
  res.RT_sabine.forEach((sabine, bi) => {
    assert.ok(Math.abs(sabine - res.RT_eyring[bi]) < 0.15,
      `banda ${BANDS[bi]}Hz: Sabine=${sabine} Eyring=${res.RT_eyring[bi]}`);
  });
});

test('RT60 Fitzroy y Millington-Sette colapsan a Eyring cuando el α es uniforme en las 6 superficies', () => {
  const room = uniformRoom(5, 4.2, 2.8, [0.08, 0.15, 0.25, 0.30, 0.35, 0.40]);
  const res = calculate(room);
  BANDS.forEach((f, bi) => {
    assert.equal(res.RT_fitzroy[bi], res.RT_eyring[bi], `Fitzroy vs Eyring @ ${f}Hz`);
    assert.equal(res.RT_millington[bi], res.RT_eyring[bi], `Millington vs Eyring @ ${f}Hz`);
  });
});

test('Frecuencia de Schroeder: coincide con 2000·√(RT_mid / V)', () => {
  const room = uniformRoom(6, 4, 3, Array(6).fill(0.12));
  const res = calculate(room);
  const expected = Math.round(2000 * Math.sqrt(res.RT_mid / res.V));
  assert.equal(res.schroeder, expected);
});

test('computeModes: incluye el modo axial fundamental del eje X (c / 2L)', () => {
  const L = 6, W = 4, H = 3, T = 20;
  const c = speedOfSound(T);
  const res = calculate(uniformRoom(L, W, H, Array(6).fill(0.12), T));
  const expectedF = c / (2 * L);
  const found = res.modes.find((m) => m.type === 'axial' && m.nx === 1 && m.ny === 0 && m.nz === 0);
  assert.ok(found, 'no se encontró el modo axial (1,0,0)');
  assert.ok(Math.abs(found.f - expectedF) < 0.2, `esperado ≈${expectedF.toFixed(1)}Hz, obtenido ${found.f}Hz`);
});

test('Diagrama de Bolt: una sala cúbica (L=W=H) cae fuera de la región preferida', () => {
  // Es un hecho conocido de acústica de recintos: proporciones 1:1:1
  // distribuyen muy mal los modos propios y Bolt (1946) las excluye.
  const res = calculate(uniformRoom(4, 4, 4, Array(6).fill(0.1)));
  assert.equal(res.inBolt, false);
});

// ════════════════════════════════════════════════════════════════
// combineAlphaByArea — mezcla de material base + tratamiento
// ════════════════════════════════════════════════════════════════

test('combineAlphaByArea: sin tratamiento (área 0) devuelve el α base sin cambios', () => {
  const base = [0.02, 0.02, 0.03, 0.04, 0.04, 0.03];
  const treat = Array(6).fill(0.8);
  assert.deepEqual(combineAlphaByArea(base, treat, 20, 0), base);
});

test('combineAlphaByArea: cobertura total (área tratada = área superficie) devuelve el α de tratamiento', () => {
  const base = [0.02, 0.02, 0.03, 0.04, 0.04, 0.03];
  const treat = Array(6).fill(0.8);
  const result = combineAlphaByArea(base, treat, 20, 20);
  result.forEach((v, i) => assert.ok(Math.abs(v - treat[i]) < 1e-9));
});

test('combineAlphaByArea: un área de tratamiento mayor a la superficie se recorta (nunca "sobre-cubre")', () => {
  const base = [0.02, 0.02, 0.03, 0.04, 0.04, 0.03];
  const treat = Array(6).fill(0.8);
  assert.deepEqual(combineAlphaByArea(base, treat, 10, 999), combineAlphaByArea(base, treat, 10, 10));
});

// ════════════════════════════════════════════════════════════════
// validateSurfaceOrder (vía calculate) — ver comentario junto a RT_fitzroy
// en aqengine.js: el orden de surfaces[] no es solo documentación, ahora
// se verifica en tiempo de ejecución.
// ════════════════════════════════════════════════════════════════

test('calculate(): rechaza un arreglo de superficies con longitud distinta de 6', () => {
  const room = uniformRoom(6, 4, 3, Array(6).fill(0.05));
  room.surfaces = room.surfaces.slice(0, 5);
  assert.throws(() => calculate(room), /se esperaban 6 superficies/);
});

test('calculate(): rechaza ids fuera del orden canónico que Fitzroy necesita', () => {
  const room = uniformRoom(6, 4, 3, Array(6).fill(0.05));
  [room.surfaces[0], room.surfaces[1]] = [room.surfaces[1], room.surfaces[0]]; // piso/techo invertidos
  assert.throws(() => calculate(room), /orden de superficies inválido/);
});

test('calculate(): superficies sin campo id (compatibilidad hacia atrás) no se rechazan', () => {
  const room = uniformRoom(6, 4, 3, Array(6).fill(0.05));
  room.surfaces = room.surfaces.map(({ id, ...rest }) => rest);
  assert.doesNotThrow(() => calculate(room));
});

// ════════════════════════════════════════════════════════════════
// Filtrado de materiales por superficie
// ════════════════════════════════════════════════════════════════

test('getTreatmentForSurface: una alfombra solo aplica a piso, no a techo', () => {
  assert.ok(getTreatmentForSurface('piso').includes('Alfombra gruesa'));
  assert.ok(!getTreatmentForSurface('techo').includes('Alfombra gruesa'));
});

test('getConstructionForSurface: "paredN" se normaliza al tipo genérico "pared"', () => {
  const paredes = getConstructionForSurface('pared3');
  assert.ok(paredes.includes('Ladrillo'));
  assert.ok(!getConstructionForSurface('piso').includes('Ladrillo')); // Ladrillo no es válido para piso
});

// ════════════════════════════════════════════════════════════════
// Utilidades
// ════════════════════════════════════════════════════════════════

test('classifyRT: respeta los umbrales documentados (good/warn/bad)', () => {
  assert.equal(classifyRT(0.6), 'good');
  assert.equal(classifyRT(0.35), 'warn');
  assert.equal(classifyRT(2.0), 'bad');
});

test('pointInPolygon: distingue un punto dentro de uno fuera de un polígono simple', () => {
  const square = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.equal(pointInPolygon(1, 1, square), true);
  assert.equal(pointInPolygon(5, 5, square), false);
});
