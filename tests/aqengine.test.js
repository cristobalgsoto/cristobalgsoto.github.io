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
  calculate, speedOfSound, combineAlphaByArea, classifyRT, tNominalRT,
  lecturaRT, claseRT, tmCriterio,
  getConstructionForSurface, getTreatmentForSurface,
  pointInPolygon, BANDS, AIR_ABS_COEFF,
  brechaRT, lecturaEBU, toleranciaSuperior, ambitoEBU, proporcionesEBU,
  EBU_TM_MIN, EBU_TM_MAX, EBU_V_MAX, EBU_AREA_MIN_CTRL,
  BOLT_POLYGON, BOLT_REFERENCE_RATIOS, claseBolt, BOLT_TOLERANCIA,
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

test('tNominalRT: 0.25 s en el volumen de referencia y escala con la raiz cubica', () => {
  // T = 0.25 (V/V0)^(1/3), V0 = 100 m3 — EBU Tech 3276 / ITU-R BS.1116
  assert.ok(Math.abs(tNominalRT(100) - 0.25) < 1e-9);
  // Ocho veces el volumen, el doble de tiempo
  assert.ok(Math.abs(tNominalRT(800) - 0.5) < 1e-9);
});

test('tmCriterio: promedia de 250 Hz a 4 kHz, dejando fuera la banda de 125', () => {
  // La de 125 Hz (88-177 Hz) cae entera por debajo de los 200 Hz del
  // rango de la norma, asi que un valor disparatado ahi no debe influir.
  assert.ok(Math.abs(tmCriterio([99, 1, 1, 1, 1, 1]) - 1) < 1e-9);
});

// Estos tres tests fijaban el criterio EQUIVOCADO —una tolerancia de
// +-0.05 s alrededor del valor de la formula, y unos rangos de volumen
// inventados— y pasaban en verde. Verificado el documento el 21/10/2026,
// se reescriben contra lo que dice de verdad. Queda como recordatorio de
// que un test verde solo garantiza que el codigo hace lo que alguien
// escribio, no que lo escrito sea cierto.

test('claseRT: el rango de T_m es absoluto, no una tolerancia sobre la formula', () => {
  assert.equal(classifyRT(0.25), 'good');
  assert.equal(classifyRT(0.29), 'good');
  assert.equal(classifyRT(0.33), 'good');   // antes daba 'warn'; la norma lo admite
  assert.equal(classifyRT(0.80), 'bad');
});

test('lecturaRT: la insignia y la nota no pueden contradecirse', () => {
  // Salen las dos de la misma llamada, que es justo el punto.
  const l = lecturaRT(0.26, 100);
  assert.equal(l.clase, 'good');
  assert.ok(l.etiqueta.includes('rango'), l.etiqueta);
  assert.ok(l.nota.includes('rango'), l.nota);
});

test('pointInPolygon: distingue un punto dentro de uno fuera de un polígono simple', () => {
  const square = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.equal(pointInPolygon(1, 1, square), true);
  assert.equal(pointInPolygon(5, 5, square), false);
});

// ── Región de Bolt ────────────────────────────────────────────────
//
// El polígono anterior se había trazado a ojo y su punta inferior quedaba
// en (1.40, 1.50) en vez de (1.23, 1.43). Faltaba un tercio del área, y
// con ella caían fuera dos proporciones óptimas PUBLICADAS. Es el fallo
// que este test impide repetir.

test('Bolt: las proporciones de Sepmeyer B y Boner caen dentro de la región', () => {
  const dentro = (x, y) => pointInPolygon(x, y, BOLT_POLYGON);
  assert.equal(dentro(1.28, 1.54), true, 'Sepmeyer B (1:1.28:1.54)');
  assert.equal(dentro(1.26, 1.59), true, 'Boner (1:cbrt2:cbrt4)');
  assert.equal(dentro(1.40, 1.90), true, 'Louden A (1:1.40:1.90)');
  assert.equal(dentro(1.50, 2.10), true, 'Louden C (1:1.50:2.10)');
});

test('Bolt: la punta inferior llega a la zona de proporciones pequeñas', () => {
  const minX = Math.min(...BOLT_POLYGON.map(p => p[0]));
  const minY = Math.min(...BOLT_POLYGON.map(p => p[1]));
  // Con el trazado viejo estos minimos eran 1.28 y 1.45.
  assert.ok(minX < 1.20, `la punta no baja de x=1.20 (es ${minX})`);
  assert.ok(minY < 1.45, `la punta no baja de y=1.45 (es ${minY})`);
});

test('Bolt: los ocho puntos de referencia del diagrama original estan todos', () => {
  assert.equal(BOLT_REFERENCE_RATIOS.length, 8);
  const nombres = BOLT_REFERENCE_RATIOS.map(r => r.name).join(' ');
  for (const quien of ['Sepmeyer A', 'Sepmeyer B', 'Sepmeyer C',
                       'Louden A', 'Louden B', 'Louden C',
                       'Volkmann', 'Boner']) {
    assert.ok(nombres.includes(quien), `falta ${quien}`);
  }
});

test('Bolt: la banda de tolerancia evita el suspenso por un borde dibujado a mano', () => {
  assert.equal(claseBolt(true, 0), 'good');
  // Justo fuera, dentro de la precision con que se lee el grafico original.
  assert.equal(claseBolt(false, BOLT_TOLERANCIA - 0.01), 'warn');
  assert.equal(claseBolt(false, BOLT_TOLERANCIA + 0.01), 'bad');
});


// ── EBU Tech 3276, 2ª edición, verificada contra el PDF ───────────
//
// El 21/10/2026 se contrastó el documento oficial y resultó que lo que
// había implementado tenía tres errores: la tolerancia de ±0.05 s sobre
// T_m no existe (la norma pide 0.2 < T_m < 0.4 s y llama "a guide" a la
// fórmula), la brecha va alrededor de T_m MEDIDO y no del valor de la
// fórmula, y los rangos de volumen eran inventados. Estos tests fijan lo
// que el documento dice de verdad.

test('EBU: el rango de T_m es absoluto, 0.2 a 0.4 s, no una tolerancia', () => {
  assert.equal(EBU_TM_MIN, 0.20);
  assert.equal(EBU_TM_MAX, 0.40);
  assert.equal(claseRT(0.20), 'good');
  assert.equal(claseRT(0.30), 'good');
  assert.equal(claseRT(0.40), 'good');
  assert.equal(claseRT(0.45), 'warn');
  assert.equal(claseRT(1.00), 'bad');
  // Lo que fallaba antes: con la tolerancia inventada de ±0.05 s sobre
  // 0.25, una sala de 0.35 s en 100 m³ suspendía. La norma la aprueba.
  assert.equal(claseRT(0.35), 'good');
});

test('EBU: la fórmula es orientativa y no define el veredicto', () => {
  assert.ok(Math.abs(tNominalRT(100) - 0.25) < 1e-9);
  assert.ok(Math.abs(tNominalRT(800) - 0.50) < 1e-9);   // 2x el lado -> 8x V
  // Una sala de 800 m³ tendría una "guía" de 0.50 s, FUERA del rango que
  // la propia norma exige. No es contradicción: la norma acota el volumen
  // a 300 m³, y ahí la guía vale 0.36 s.
  assert.ok(tNominalRT(EBU_V_MAX) < EBU_TM_MAX, 'la guía se sale del rango dentro del ámbito');
});

test('EBU: la tolerancia superior es plana de 200 Hz hacia arriba', () => {
  for (const f of [200, 250, 500, 1000, 2000, 4000, 8000]) {
    assert.equal(toleranciaSuperior(f), 0.05, `${f} Hz`);
  }
});

test('EBU: la tolerancia superior se ensancha hacia graves, en log f', () => {
  assert.equal(toleranciaSuperior(63), 0.30);
  // t = ln(125/63)/ln(200/63) = 0.5934 -> 0.30 + (0.05-0.30)*0.5934
  assert.ok(Math.abs(toleranciaSuperior(125) - 0.1516) < 0.001,
    `125 Hz da ${toleranciaSuperior(125)}`);
  let ant = Infinity;
  for (let f = 50; f <= 500; f += 5) {
    const t = toleranciaSuperior(f);
    assert.ok(t <= ant + 1e-12, `sube en ${f} Hz`);
    ant = t;
  }
});

test('EBU: la brecha va alrededor de T_m medido, no del valor de la fórmula', () => {
  // Sala plana en 0.30 s. T_m = 0.30; la fórmula para 100 m³ daría 0.25.
  const bandas = [0.30, 0.30, 0.30, 0.30, 0.30, 0.30];
  const m = brechaRT(tmCriterio(bandas));
  for (const b of m) assert.ok(Math.abs(b.min - 0.25) < 1e-9, 'el suelo no sigue a T_m');
  assert.ok(m[0].max > m[1].max, '125 Hz no tiene más margen que 250 Hz');
  for (let i = 1; i < m.length; i++) {
    assert.ok(Math.abs(m[i].max - 0.35) < 1e-9, `${BANDS[i]} Hz`);
  }
  const l = lecturaEBU(bandas, 100, 6, 5);
  assert.equal(l.dentro, 6);
  assert.equal(l.clase, 'good');
  assert.equal(l.etiqueta, '6/6 bandas en brecha');
});

test('EBU: la brecha mide PLANITUD; el rango de T_m mide nivel', () => {
  // Sala plana pero muy reverberante: pasa la brecha y suspende por T_m.
  const l = lecturaEBU([1.2, 1.2, 1.2, 1.2, 1.2, 1.2], 100, 6, 5);
  assert.equal(l.dentro, 6, 'una curva plana cumple la brecha, dice la norma');
  assert.equal(l.claseBrecha, 'good');
  assert.equal(l.claseTm, 'bad');
  assert.equal(l.clase, 'bad', 'el veredicto es el peor de los dos');
  assert.ok(l.etiqueta.includes('fuera de'), l.etiqueta);
  // Se comprueba QUÉ dice la nota, no cómo lo dice: la cifra juzgada,
  // los dos topes de la norma y la salida que se le propone a quien lee.
  assert.ok(l.nota.includes('1.20'), 'la nota trae el T_m que se ha juzgado');
  assert.ok(l.nota.includes('0.2') && l.nota.includes('0.4'), 'y los dos topes');
  assert.ok(/absorbente/.test(l.nota), 'y dice qué hacer con la sala');
});

test('EBU: con T_m en rango, el veredicto cuenta bandas y las nombra', () => {
  // T_m (250 Hz a 4 kHz) = 0.30; 125 Hz se dispara a 0.60.
  const l = lecturaEBU([0.60, 0.30, 0.30, 0.30, 0.30, 0.30], 100, 6, 5);
  assert.equal(l.claseTm, 'good');
  assert.equal(l.estado[0], 'alta', '0.60 pasa del +0.15 que admite 125 Hz');
  assert.equal(l.dentro, 5);
  assert.equal(l.etiqueta, '5/6 bandas en brecha');
  assert.ok(l.nota.includes('125 Hz'), l.nota);
});

test('EBU: 125 Hz admite +0.15 s sobre T_m y 250 Hz sólo +0.05', () => {
  const base = [0.30, 0.30, 0.30, 0.30, 0.30, 0.30];
  const grave = lecturaEBU([0.44, ...base.slice(1)], 100, 6, 5);
  assert.equal(grave.estado[0], 'dentro', '125 Hz a +0.14 deberia entrar');
  const pasado = lecturaEBU([0.46, ...base.slice(1)], 100, 6, 5);
  assert.equal(pasado.estado[0], 'alta', '125 Hz a +0.16 deberia salirse');
});

test('EBU: el ámbito es planta mínima y volumen máximo, sin hueco ninguno', () => {
  // El "hueco entre 60 y 100 m³" venía de inventarse los rangos: el 100
  // era V0, el volumen de REFERENCIA de la fórmula.
  assert.equal(ambitoEBU(75.6, 6, 4.5).dentro, false, 'planta de 27 m² < 30');
  assert.equal(ambitoEBU(200, 10, 8).dentro, true);
  assert.equal(ambitoEBU(400, 12, 10).dentro, false, 'pasa de 300 m³');
  assert.equal(EBU_V_MAX, 300);
  assert.equal(EBU_AREA_MIN_CTRL, 30);
  // Ningun volumen entre 60 y 100 queda fuera por serlo.
  for (let V = 60; V <= 100; V += 5) {
    assert.equal(ambitoEBU(V, 8, 5).dentro, true, `${V} m³ con planta de 40 m²`);
  }
});

test('EBU: la insignia y la nota salen de la misma cuenta', () => {
  for (const bandas of [[0.30, 0.30, 0.30, 0.30, 0.30, 0.30],
                        [1.2, 1.2, 1.2, 1.2, 1.2, 1.2],
                        [0.60, 0.30, 0.30, 0.30, 0.30, 0.22]]) {
    const l = lecturaEBU(bandas, 150, 8, 6);
    if (l.claseTm === 'good') {
      assert.equal(l.etiqueta, `${l.dentro}/6 bandas en brecha`);
    } else {
      assert.ok(l.etiqueta.includes('fuera de'), l.etiqueta);
      // La nota y la insignia salen de la MISMA cuenta: si la insignia
      // dice que esta fuera, la nota tiene que traer ese mismo T_m.
      assert.ok(l.nota.includes(l.tm.toFixed(2)), l.nota);
    }
  }
});

// ── Proporciones de EBU Tech 3276 (sin pantalla todavía) ─────────

test('EBU: las proporciones de la norma son 1.1(w/h) <= l/h <= 4.5(w/h) - 4', () => {
  // Con w/h = 1.6 la banda va de 1.76 a 3.2, pero el tope l < 3h la
  // recorta en 3: de los dos limites manda el que caiga antes.
  const h = 2.5, w = 4.0;
  assert.equal(proporcionesEBU(h * 1.8, w, h).cumple, true, 'dentro, cerca del borde bajo');
  assert.equal(proporcionesEBU(h * 2.9, w, h).cumple, true, 'dentro, cerca del tope');
  assert.equal(proporcionesEBU(h * 1.5, w, h).cumple, false, 'por debajo del borde bajo');
  // Con w/h = 1.2 la banda es estrecha: de 1.32 a 1.4.
  const w2 = h * 1.2;
  assert.equal(proporcionesEBU(h * 1.35, w2, h).cumple, true, 'dentro de la banda estrecha');
  assert.equal(proporcionesEBU(h * 1.60, w2, h).cumple, false, 'pasa el borde alto');
});

test('EBU: ni el largo ni el ancho pueden pasar de tres veces la altura', () => {
  const r = proporcionesEBU(9.0, 8.4, 2.8);   // l = 3.21h
  assert.equal(r.cumple, false);
  assert.ok(r.motivos.join(' ').includes('tres veces'), r.motivos.join(' '));
});

test('EBU: los cocientes cerca de un entero se avisan, no se suspenden', () => {
  // 5.0 / 2.5 = 2.00 exacto -> largo/alto entero.
  const r = proporcionesEBU(5.0, 4.0, 2.5);
  assert.equal(r.cumple, true, 'la banda se cumple');
  assert.equal(r.clase, 'warn');
  assert.ok(r.enteros.some((e) => e.nombre === 'largo/alto'), JSON.stringify(r.enteros));
});
