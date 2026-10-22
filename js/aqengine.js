/**
 * aqengine.js — Motor de cálculo acústico v2.0
 * AQVIS — Acoustic Visual Simulation Engine
 * Autor: Cristóbal Gerardo Contreras Soto
 *
 * v2.1:
 * ✅ Sabine + Eyring (siempre)
 * ✅ Fitzroy CORREGIDO: 3 pares de superficies por eje (Fitzroy 1959 / Bies & Hansen)
 * ✅ Millington CORREGIDO: Σᵢ Sᵢ×(-ln(1-αᵢ)) por superficie individual (Millington-Sette 1932)
 * ✅ Ambos solo si hasTreatment = true
 * ✅ Schroeder frequency
 * ✅ Modos normales con color-coding (Critical/Warning/OK)
 * ✅ RT60 con 1 decimal
 * ✅ Validación m² tratamiento vs área superficie
 * ✅ Temperatura 10–30°C
 * ✅ Filtrado de materiales por tipo de superficie
 * ✅ Absorción del aire (término 4mV) en las 4 fórmulas de RT60
 * ❌ C50/C80 eliminados
 *
 * Fuentes: FADU-UdelaR (2012), Bies & Hansen (6ª ed., 2024)
 * Sabine (1900), Eyring (1930), Fitzroy (1959), Millington (1932), Bolt (1946)
 */

'use strict';

// ════════════════════════════════════════════════════════════════
// CONSTANTES GLOBALES
// ════════════════════════════════════════════════════════════════

const BANDS       = [125, 250, 500, 1000, 2000, 4000];
const BAND_LABELS = ['125', '250', '500', '1k', '2k', '4k'];

// Versión del esquema de los objetos input/result que wizard.js guarda en
// sessionStorage y que results.html/renderer.js vuelve a leer. Sube este
// número solo cuando cambies la FORMA de esos objetos (campos agregados con
// valor opcional no cuentan); el lado que lee puede entonces detectar datos
// de una versión anterior y descartarlos en vez de asumir una forma que ya
// no es cierta.
const AQVIS_SCHEMA_VERSION = 2;  // 2: RT_avg (Sabine, 125 Hz-4 kHz) sustituye a RT_mid como valor del resumen

// Orden canónico que calculate() asume en input.surfaces[] — lo necesita
// Fitzroy para agrupar pares de superficies opuestas por índice fijo (ver
// comentario junto a RT_fitzroy). Si quien arma el input (wizard.js) deja de
// enviar las superficies en este orden, validateSurfaceOrder() lo detecta y
// falla con un error explícito en vez de devolver un RT60 Fitzroy incorrecto
// en silencio.
const SURFACE_ORDER = ['piso', 'techo', 'pared1', 'pared2', 'pared3', 'pared4'];

function validateSurfaceOrder(surfaces) {
  if (!Array.isArray(surfaces) || surfaces.length !== SURFACE_ORDER.length) {
    throw new Error(
      `calculate(): se esperaban ${SURFACE_ORDER.length} superficies (${SURFACE_ORDER.join(', ')}), ` +
      `se recibieron ${surfaces?.length ?? 0}.`
    );
  }
  surfaces.forEach((sf, i) => {
    if (sf.id && sf.id !== SURFACE_ORDER[i]) {
      throw new Error(
        `calculate(): orden de superficies inválido en el índice ${i} — se esperaba "${SURFACE_ORDER[i]}" ` +
        `y se recibió "${sf.id}". El cálculo de Fitzroy asume este orden exacto (ver RT_fitzroy en calculate()).`
      );
    }
  });
}

// ── Región de Bolt (1946) ──────────────────────────────────────
// Los ejes del diagrama original NO son L/H y W/H directamente: son
// las 3 dimensiones de la sala ORDENADAS de menor a mayor, expresadas
// como proporción respecto a la menor:
//   x = dimensión intermedia / dimensión menor
//   y = dimensión mayor      / dimensión menor
// La región preferida no es un rectángulo — es un área estrecha, alargada
// e inclinada sobre la diagonal, con un escalón en el flanco derecho.
//
// El polígono se DIGITALIZÓ el 21/10/2026 píxel a píxel desde una
// reproducción del gráfico original: se extraen los píxeles del trazo
// dentro del recuadro, se descartan los discos de los puntos de
// referencia, sus letras y el rótulo "Height = 1", se recorre el contorno
// por sectores angulares con filtro de mediana y se simplifica con
// Douglas-Peucker. Verificado por superposición sobre la figura original.
//
// El trazado anterior se había hecho a ojo y su punta inferior quedaba en
// (1.40, 1.50) en vez de (1.23, 1.43): faltaba un tercio del área, y por
// eso Sepmeyer B y Boner —dos proporciones óptimas publicadas— recibían
// "fuera de la región".
//
// PRECISIÓN ESTIMADA ±0.02. Por eso hay banda de tolerancia: afirmar un
// veredicto binario sobre una curva dibujada a mano en 1946 y redigitalizada
// desde una reproducción sería falsa exactitud.
const BOLT_POLYGON = [
  [1.227, 1.425], [1.290, 1.463], [1.469, 1.700], [1.505, 1.735],
  [1.732, 2.173], [1.731, 2.227], [1.633, 2.291], [1.540, 2.441],
  [1.508, 2.477], [1.472, 2.494], [1.433, 2.482], [1.399, 2.442],
  [1.374, 2.379], [1.361, 2.301], [1.353, 2.087], [1.323, 1.920],
  [1.179, 1.549], [1.183, 1.451],
];

// Tolerancia del veredicto, en unidades de proporción. Es CONVENCIÓN DE
// AQVIS, no de Bolt: cubre el grosor del trazo original y el error de la
// digitalización. Dentro de ella el veredicto es "en el borde", no un
// suspenso.
const BOLT_TOLERANCIA = 0.05;

function claseBolt(dentro, margen) {
  if (dentro) return 'good';
  return margen <= BOLT_TOLERANCIA ? 'warn' : 'bad';
}

// Proporciones "óptimas" puntuales citadas en la literatura de acústica
// de recintos, en el mismo espacio (media/menor, mayor/menor). Verificar
// decimales contra la fuente si se citan con precisión en un informe.
// Los ocho del diagrama original. OJO: no todos caen dentro de la región
// de Bolt, y no es un error — Louden y Sepmeyer llegan a sus proporciones
// por otro criterio (separación modal), no por el área de Bolt. Sepmeyer A
// queda claramente fuera. Sepmeyer C, Louden B y Volkmann NO estan ni
// dentro ni fuera: caen encima de la linea, a 0.004, 0.015 y 0.017, por
// debajo del +-0.02 de precision del trazo. Para eso esta BOLT_TOLERANCIA.
const BOLT_REFERENCE_RATIOS = [
  { name: 'Sepmeyer A (1965)', x: 1.14, y: 1.39 },
  { name: 'Sepmeyer B (1965)', x: 1.28, y: 1.54 },
  { name: 'Sepmeyer C (1965)', x: 1.60, y: 2.33 },
  { name: 'Louden A (1971)',   x: 1.40, y: 1.90 },
  { name: 'Louden B (1971)',   x: 1.30, y: 1.90 },
  { name: 'Louden C (1971)',   x: 1.50, y: 2.10 },
  { name: 'Volkmann 2:3:5',    x: 1.50, y: 2.50 },
  { name: 'Boner 1:∛2:∛4',     x: 1.26, y: 1.59 },
];

// Ray casting estándar — ¿el punto (x,y) cae dentro del polígono?
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq > 0 ? (apx * abx + apy * aby) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + abx * t, y: ay + aby * t };
}

// Punto del borde del polígono más cercano a (x,y) + distancia.
function nearestPointOnPolygon(x, y, poly) {
  let best = { x: poly[0][0], y: poly[0][1], dist: Infinity };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const p = closestPointOnSegment(x, y, a[0], a[1], b[0], b[1]);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < best.dist) best = { x: p.x, y: p.y, dist: d };
  }
  return best;
}

// Coeficiente de absorción del aire "m" (m⁻¹) por banda de octava,
// a 20°C / 50% RH — valores típicos de tablas de referencia (orden de
// magnitud de Bies & Hansen / ISO 9613-1). Se usa como término 4mV
// sumado al denominador de RT60 (Sabine/Eyring/Fitzroy/Millington),
// tal como lo definen Sabine y Eyring en su forma completa.
// ⚠️ Simplificado: fijo a 20°C/50%RH (no depende de la temperatura T
// que sí varía en la UI, ni de humedad, que no es un input del motor).
// Si necesitas citar valores exactos en el informe, verifícalos contra
// la tabla de tu edición de Bies & Hansen.
const AIR_ABS_COEFF = [0.0001, 0.0002, 0.0005, 0.0011, 0.0025, 0.0080]; // [125,250,500,1k,2k,4k] Hz

// ════════════════════════════════════════════════════════════════
// BASE DE DATOS DE MATERIALES
// Coeficientes: [125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz]
// surfaces: tipos de superficie donde aplica ('piso','techo','pared')
// ════════════════════════════════════════════════════════════════

const CONSTRUCTION_MATERIALS = {
  'Hormigón liso':   { alpha: [0.01, 0.01, 0.02, 0.02, 0.02, 0.05], surfaces: ['piso','techo','pared'] },
  'Hormigón rugoso': { alpha: [0.02, 0.03, 0.03, 0.03, 0.04, 0.07], surfaces: ['piso','techo','pared'] },
  'Ladrillo':        { alpha: [0.03, 0.03, 0.04, 0.05, 0.07, 0.09], surfaces: ['techo','pared'] },
  'Yeso liso':       { alpha: [0.02, 0.02, 0.03, 0.04, 0.04, 0.03], surfaces: ['techo','pared'] },
  'Madera':          { alpha: [0.15, 0.11, 0.10, 0.07, 0.06, 0.07], surfaces: ['piso','techo','pared'] },
  'Cerámica':        { alpha: [0.01, 0.01, 0.02, 0.02, 0.02, 0.02], surfaces: ['piso','pared'] },
  'Mármol / piedra': { alpha: [0.01, 0.01, 0.01, 0.02, 0.02, 0.02], surfaces: ['piso','pared'] },
};

const TREATMENT_MATERIALS = {
  'Panel acústico 5cm':  { alpha: [0.20, 0.45, 0.70, 0.80, 0.85, 0.80], surfaces: ['techo','pared'] },
  'Espuma acústica 5cm': { alpha: [0.10, 0.30, 0.65, 0.85, 0.90, 0.85], surfaces: ['techo','pared'] },
  'Alfombra delgada':    { alpha: [0.05, 0.10, 0.20, 0.30, 0.35, 0.40], surfaces: ['piso'] },
  'Alfombra gruesa':     { alpha: [0.10, 0.25, 0.55, 0.70, 0.75, 0.80], surfaces: ['piso'] },
  'Cortina liviana':     { alpha: [0.03, 0.04, 0.11, 0.17, 0.24, 0.35], surfaces: ['pared'] },
  'Cortina pesada':      { alpha: [0.07, 0.31, 0.49, 0.75, 0.70, 0.60], surfaces: ['pared'] },
  'Techo falso':         { alpha: [0.25, 0.45, 0.75, 0.85, 0.80, 0.70], surfaces: ['techo'] },
  'Lana de vidrio 5cm':  { alpha: [0.20, 0.55, 0.85, 0.95, 0.90, 0.85], surfaces: ['techo','pared'] },
};

// ════════════════════════════════════════════════════════════════
// FILTRADO DE MATERIALES POR SUPERFICIE
// ════════════════════════════════════════════════════════════════

/**
 * Retorna nombres de materiales de construcción aplicables a una superficie
 * @param {string} surfId - 'piso' | 'techo' | 'pared1' | 'pared2' | etc.
 */
function getConstructionForSurface(surfId) {
  const type = surfId.startsWith('pared') ? 'pared' : surfId;
  return Object.entries(CONSTRUCTION_MATERIALS)
    .filter(([, m]) => m.surfaces.includes(type))
    .map(([name]) => name);
}

/**
 * Retorna nombres de tratamientos aplicables a una superficie
 * @param {string} surfId - 'piso' | 'techo' | 'pared1' | 'pared2' | etc.
 */
function getTreatmentForSurface(surfId) {
  const type = surfId.startsWith('pared') ? 'pared' : surfId;
  return Object.entries(TREATMENT_MATERIALS)
    .filter(([, m]) => m.surfaces.includes(type))
    .map(([name]) => name);
}

// ════════════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES
// ════════════════════════════════════════════════════════════════

function speedOfSound(T) {
  return 331.3 + 0.606 * T;
}

/**
 * Combina alpha base + tratamiento ponderado por área
 * Incluye clamp para que treatArea nunca exceda surfaceArea
 */
function combineAlphaByArea(baseAlpha, treatAlpha, surfaceArea, treatArea) {
  const ta       = Math.min(treatArea, surfaceArea);
  const freeArea = surfaceArea - ta;
  return baseAlpha.map((b, i) =>
    Math.max(0, Math.min(1, (b * freeArea + treatAlpha[i] * ta) / surfaceArea))
  );
}

// Reciben el valor que se presenta como resumen (RT_avg: Sabine, media de
// 125 Hz a 4 kHz), no el T_mid de medias frecuencias. Los umbrales son de
// lectura general, no de una norma.
// ════════════════════════════════════════════════════════════════
// CRITERIO DE REVERBERACIÓN  —  EBU Tech 3276, 2ª edición (mayo 1998)
//
// ✅ VERIFICADO CONTRA EL DOCUMENTO. El 21/10/2026 se descargó el PDF
// oficial (tech.ebu.ch/docs/tech/tech3276.pdf) y se contrastó palabra por
// palabra. Lo que había aquí antes estaba sacado de fuentes de segunda
// mano y tenía TRES errores de fondo, los tres corregidos abajo.
//
// ── Lo que dice el documento, §2.3 ──────────────────────────────
//
//   "Reverberation time is frequency-dependent. The nominal value, T_m,
//    is the average of the measured reverberation times in the 1/3-octave
//    bands from 200 Hz to 4 kHz."
//
//   "The nominal reverberation time, T_m, should lie in the range:
//        0.2 < T_m < 0.4  s"
//
//   "To ensure that the acoustic environment remains 'natural', the value
//    of T_m should increase with the size of the room. The following
//    formula is given as a guide:
//        T_m = 0.25 (V/V0)^(1/3)  s      V0 = 100 m³"
//
//   "The reverberation time T, measured in 1/3-octave bands over the
//    frequency range from 63 Hz to 8 kHz, should conform to the tolerance
//    mask shown in Fig. 1."
//
// La Fig. 1 tiene por ordenada la DIFERENCIA (T − T_m), no T. El límite
// superior vale +0.3 s en 63 Hz, baja hasta +0.05 s en 200 Hz y se queda
// plano hasta 8 kHz; el inferior es −0.05 s en todo el rango.
//
// ── Los tres errores que había aquí ─────────────────────────────
//
// 1. **La tolerancia de ±0.05 s sobre T_m no existe.** El documento no
//    pone una tolerancia alrededor del valor de la fórmula: pone un RANGO
//    ABSOLUTO, 0.2 a 0.4 s, y llama a la fórmula "a guide". Con ±0.05 s
//    se estaba exigiendo algo que la norma no pide, y bastante más duro.
//
// 2. **La brecha va alrededor de T_m MEDIDO, no del valor de la
//    fórmula.** Es una brecha de PLANITUD: mide si la sala responde
//    igual en todas las bandas, no si acierta un objetivo absoluto. Las
//    dos cosas se comprueban por separado, y así se hace aquí.
//
// 3. **Los rangos de volumen eran inventados.** Aquí ponía "20–60 m³
//    para ITU-R BS.1116 y 100–300 m³ para EBU Tech 3276", y de ahí salía
//    el famoso hueco entre 60 y 100 m³. **Ese hueco nunca existió.** Lo
//    que dice el documento (§2 del anexo de dimensiones) es:
//
//      · superficie de planta MÍNIMA: 40 m² para una sala de escucha de
//        referencia, 30 m² para una sala de control de alta calidad;
//      · "in any case, the volume should not exceed 300 m³".
//
//    El 100 que estaba de límite inferior era V0, el volumen de
//    REFERENCIA de la fórmula, confundido con un límite de aplicación.
//
//
// ── Cómo se llama esto en AQVIS ────────────────────────────────
//
// El documento la llama "tolerance mask" y la traducción literal es
// MÁSCARA de tolerancia. En la interfaz de AQVIS se llama BRECHA de
// tolerancia, por decisión del autor: "máscara" se lee como algo que
// tapa, y lo que esto describe es el hueco dentro del que la curva
// tiene permitido moverse.
//
// En la memoria conviene nombrar las dos, una sola vez, para que quien
// vaya al documento original reconozca de qué se está hablando.
// ── En qué se aparta AQVIS, que sigue habiendo cosas ────────────
//
//   · **Bandas de octava, no de tercio.** La norma mide en 1/3 de octava
//     de 200 Hz a 4 kHz (T_m) y de 63 Hz a 8 kHz (la brecha). AQVIS
//     tiene seis bandas de OCTAVA, de 125 Hz a 4 kHz. T_m se toma de 250
//     Hz a 4 kHz porque la de 125 Hz (88–177 Hz) cae entera por debajo de
//     los 200 Hz, y la brecha se evalúa en las seis. Es una lectura más
//     gruesa, no una lectura distinta.
//
//   · **El reparto en bueno / límite / malo es convención de AQVIS.** La
//     norma no gradúa: cumple o no cumple.
//
//   · **T_m no es la cifra grande del resumen**, que promedia las seis
//     bandas desde 125 Hz. Aquélla caracteriza el recinto; ésta lo juzga.
// ════════════════════════════════════════════════════════════════

const EBU_V0 = 100;               // m³, volumen de referencia de la fórmula
const EBU_TM_MIN = 0.20;          // s, §2.3: 0.2 < T_m < 0.4
const EBU_TM_MAX = 0.40;          // s
const EBU_V_MAX = 300;            // m³, "should not exceed"
const EBU_AREA_MIN_REF = 40;      // m² de planta, sala de escucha de referencia
const EBU_AREA_MIN_CTRL = 30;     // m² de planta, sala de control

// Brecha de la Fig. 1, sobre la diferencia (T − T_m).
const EBU_TOL_INF = -0.05;        // s, plano en todo el rango
const EBU_TOL_SUP = 0.05;         // s, de 200 Hz hasta 8 kHz
const EBU_F_PLANA = 200;          // Hz
const EBU_F_GRAVE = 63;           // Hz
const EBU_TOL_SUP_GRAVE = 0.30;   // s, en 63 Hz

// Compatibilidad: algún consumidor todavía lee esta constante.
const EBU_TOLERANCIA = 0.05;

/**
 * Valor orientativo de T_m para un volumen, en segundos. El documento lo
 * llama "a guide", no un objetivo: sirve para situar la sala dentro del
 * rango 0.2–0.4 s, no para exigirle una cifra.
 */
function tNominalRT(V) {
  if (!(V > 0)) return NaN;
  return 0.25 * Math.pow(V / EBU_V0, 1 / 3);
}

/**
 * T_m: media de las bandas de 250 Hz a 4 kHz, que son las de AQVIS que
 * caen dentro del rango de 200 Hz a 4 kHz de la norma.
 */
function tmCriterio(bandas) {
  const dentro = (bandas || []).slice(1).filter((v) => Number.isFinite(v));
  if (!dentro.length) return NaN;
  return dentro.reduce((a, b) => a + b, 0) / dentro.length;
}

/**
 * Si la sala cae dentro del ámbito de aplicación de EBU Tech 3276.
 * Devuelve los motivos por los que NO, para poder decírselos al usuario.
 */
function ambitoEBU(V, L, W) {
  const motivos = [];
  if (Number.isFinite(V) && V > EBU_V_MAX) {
    motivos.push(`el volumen pasa de ${EBU_V_MAX} m³`);
  }
  if (Number.isFinite(L) && Number.isFinite(W) && L * W < EBU_AREA_MIN_CTRL) {
    motivos.push(`la planta no llega a ${EBU_AREA_MIN_CTRL} m²`);
  }
  return { dentro: motivos.length === 0, motivos };
}

/** Tolerancia superior de la brecha en una frecuencia, en segundos. */
function toleranciaSuperior(f) {
  if (!(f > 0)) return NaN;
  if (f >= EBU_F_PLANA) return EBU_TOL_SUP;
  if (f <= EBU_F_GRAVE) return EBU_TOL_SUP_GRAVE;
  const t = Math.log(f / EBU_F_GRAVE) / Math.log(EBU_F_PLANA / EBU_F_GRAVE);
  return EBU_TOL_SUP_GRAVE + (EBU_TOL_SUP - EBU_TOL_SUP_GRAVE) * t;
}

/**
 * Límites de la brecha para cada banda de AQVIS, en segundos ABSOLUTOS.
 * Van alrededor de T_m, que es como los dibuja la Fig. 1.
 */
function brechaRT(tm) {
  if (!Number.isFinite(tm)) return BANDS.map((f) => ({ f, min: NaN, max: NaN }));
  return BANDS.map((f) => ({
    f,
    min: tm + EBU_TOL_INF,
    max: tm + toleranciaSuperior(f),
  }));
}

/** Veredicto del rango absoluto de T_m: 0.2 < T_m < 0.4 s. */
function claseRT(tm) {
  if (!Number.isFinite(tm)) return 'warn';
  if (tm >= EBU_TM_MIN && tm <= EBU_TM_MAX) return 'good';
  // La banda "límite" es convención de AQVIS: al doble de ancha que el
  // rango de la norma por cada lado. Sin ella no habría más que aprobado
  // y suspenso, y casi ninguna sala real caería en 0.2–0.4 s.
  if (tm >= EBU_TM_MIN / 2 && tm <= EBU_TM_MAX * 1.5) return 'warn';
  return 'bad';
}

function mayus(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

/** "125 Hz", "125 Hz y 250 Hz", "125 Hz, 250 Hz y 4 kHz". */
function unidadBanda(etiqueta) {
  return etiqueta.endsWith('k') ? `${etiqueta.slice(0, -1)} kHz` : `${etiqueta} Hz`;
}

function listar(etiquetas) {
  const con = etiquetas.map(unidadBanda);
  if (con.length <= 1) return con[0] || '';
  return `${con.slice(0, -1).join(', ')} y ${con[con.length - 1]}`;
}

/**
 * Lectura completa del criterio de EBU: el rango de T_m y la brecha de
 * planitud, las dos de la misma cuenta, para que la insignia y la nota no
 * puedan contradecirse.
 *
 * El orden importa y es el del documento: primero T_m tiene que caer en
 * 0.2–0.4 s, y sólo entonces tiene sentido mirar si la curva es plana.
 * Una sala de 1.2 s perfectamente plana cumple la brecha y no sirve.
 */
function lecturaEBU(bandas, V, L, W) {
  const tm = tmCriterio(bandas);
  const guia = tNominalRT(V);
  const brecha = brechaRT(tm);
  const ambito = ambitoEBU(V, L, W);

  const estado = brecha.map((m, i) => {
    const rt = (bandas || [])[i];
    if (!Number.isFinite(rt) || !Number.isFinite(m.min)) return 'sin-dato';
    if (rt < m.min) return 'baja';
    if (rt > m.max) return 'alta';
    return 'dentro';
  });

  const total = brecha.length;
  const dentro = estado.filter((e) => e === 'dentro').length;
  const claseBrecha = dentro === total ? 'good' : dentro >= total - 2 ? 'warn' : 'bad';
  const claseTm = claseRT(tm);

  const PESO = { good: 0, warn: 1, bad: 2 };
  const clase = PESO[claseTm] >= PESO[claseBrecha] ? claseTm : claseBrecha;

  const etiqueta = claseTm === 'good'
    ? `${dentro}/${total} bandas en brecha`
    : `RT60 fuera de ${EBU_TM_MIN.toFixed(1)}–${EBU_TM_MAX.toFixed(1)} s`;

  // ── La nota ──────────────────────────────────────────────────
  const altas = BAND_LABELS.filter((_, i) => estado[i] === 'alta');
  const bajas = BAND_LABELS.filter((_, i) => estado[i] === 'baja');

  // La nota se escribe para que la entienda quien no conoce la norma:
  // primero QUÉ pasa con la sala, en una frase, y después la cifra que
  // lo sostiene. Antes empezaba por "T_m de 0.50 s, por encima del rango
  // de 0.2 a 0.4 s", que sólo dice algo a quien ya sabe qué es T_m.
  let nota;
  if (claseTm !== 'good') {
    nota = tm > EBU_TM_MAX
      ? `<b>La sala reverbera más de lo que pide la norma.</b> El tiempo medio ` +
        `entre 250 Hz y 4 kHz es de ${tm.toFixed(2)} s, y EBU Tech 3276 lo quiere ` +
        `entre ${EBU_TM_MIN.toFixed(1)} y ${EBU_TM_MAX.toFixed(1)} s; para los ` +
        `${V.toFixed(0)} m³ de esta sala, lo deseable rondaría ${guia.toFixed(2)} s. ` +
        `Para bajarlo hay que añadir material absorbente.`
      : `<b>La sala está más apagada de lo que pide la norma.</b> El tiempo medio ` +
        `entre 250 Hz y 4 kHz es de ${tm.toFixed(2)} s, y EBU Tech 3276 lo quiere ` +
        `entre ${EBU_TM_MIN.toFixed(1)} y ${EBU_TM_MAX.toFixed(1)} s; para los ` +
        `${V.toFixed(0)} m³ de esta sala, lo deseable rondaría ${guia.toFixed(2)} s. ` +
        `Con tan poca reverberación la sala puede sonar seca y sin cuerpo.`;
  } else if (dentro === total) {
    nota = `<b>La sala cumple la norma.</b> El tiempo medio es de ${tm.toFixed(2)} s, ` +
           `dentro de lo que pide EBU Tech 3276, y las seis bandas caen dentro de la ` +
           `franja de tolerancia: la reverberación dura casi lo mismo en graves que ` +
           `en agudos, que es lo que se busca.`;
  } else {
    const trozos = [];
    if (altas.length) trozos.push(`${listar(altas)} por encima`);
    if (bajas.length) trozos.push(`${listar(bajas)} por debajo`);
    nota = `<b>El tiempo medio cumple, pero la curva no es plana.</b> ` +
           `Con ${tm.toFixed(2)} s de media la sala está en rango, aunque ` +
           `${trozos.join('; ')} de la franja de tolerancia. Eso se oye como un ` +
           `desequilibrio de timbre entre unas frecuencias y otras.`;
  }

  if (!ambito.dentro) {
    nota += ` <i>Ojo: ${ambito.motivos.join(' y ')}, y la norma está escrita para ` +
            `salas mayores, así que esto vale como orientación y no como veredicto.</i>`;
  }

  return {
    clase, etiqueta, nota, estado, dentro, total, brecha,
    tm, guia, claseTm, claseBrecha, ambito,
  };
}

/**
 * Proporciones de sala de EBU Tech 3276, anexo de dimensiones:
 *
 *     1.1 (w/h)  ≤  l/h  ≤  4.5 (w/h) − 4
 *     l < 3h ,  w < 3h
 *
 * con l = la mayor dimensión de la planta, w = la menor, h = la altura.
 * Y además: "ratios of l, w and h which are within ±5% of integer values
 * should also be avoided".
 *
 * ⚠️ IMPLEMENTADO Y PROBADO, PERO TODAVÍA SIN PANTALLA. Es un criterio de
 * proporciones distinto del de Bolt y sale de la MISMA norma de la que
 * sale el criterio de RT60, así que es el candidato natural para
 * acompañar a Bolt en su pestaña.
 */
function proporcionesEBU(L, W, H) {
  if (!(L > 0 && W > 0 && H > 0)) return null;
  const l = Math.max(L, W), w = Math.min(L, W), h = H;
  const rl = l / h, rw = w / h;

  const banda = rl >= 1.1 * rw && rl <= 4.5 * rw - 4;
  const topes = l < 3 * h && w < 3 * h;

  // Los tres cocientes entre dimensiones, que no deben acercarse a un entero.
  const cocientes = [
    { nombre: 'largo/alto', v: l / h },
    { nombre: 'ancho/alto', v: w / h },
    { nombre: 'largo/ancho', v: l / w },
  ];
  const enteros = cocientes.filter((c) => {
    const n = Math.round(c.v);
    return n >= 1 && Math.abs(c.v - n) <= 0.05 * n;
  });

  const motivos = [];
  if (!banda) motivos.push('las proporciones caen fuera de la banda 1.1·(w/h) ≤ l/h ≤ 4.5·(w/h) − 4');
  if (!topes) motivos.push('el largo o el ancho pasan de tres veces la altura');

  const clase = motivos.length ? 'bad' : enteros.length ? 'warn' : 'good';

  // La pantalla necesita las tres comprobaciones por separado, con sus
  // cifras, no sólo el veredicto: el valor de un criterio de proporciones
  // está en ver POR QUÉ falla, que es lo que te dice qué dimensión mover.
  return {
    clase, cumple: motivos.length === 0, motivos, enteros,
    l, w, h, rl, rw,
    banda, topes,
    bandaMin: 1.1 * rw,
    bandaMax: 4.5 * rw - 4,
    cocientes,
  };
}

// ── Compatibilidad con las llamadas antiguas ────────────────────
// lecturaRT seguía siendo la fuente de la insignia hasta que la brecha
// la sustituyó. Se mantiene porque interpretRT la usa, pero ya no decide
// nada: el veredicto sale de lecturaEBU.
function lecturaRT(tm, V) {
  const clase = claseRT(tm);
  const guia = tNominalRT(V);
  const nota = clase === 'good'
    ? `T_m de ${tm.toFixed(2)} s, dentro del rango de ${EBU_TM_MIN.toFixed(1)} a ${EBU_TM_MAX.toFixed(1)} s.`
    : `T_m de ${tm.toFixed(2)} s, fuera del rango de ${EBU_TM_MIN.toFixed(1)} a ${EBU_TM_MAX.toFixed(1)} s (la fórmula da ${guia.toFixed(2)} s para ${V.toFixed(0)} m³).`;
  const etiqueta = clase === 'good' ? 'RT60 en rango' : (tm > EBU_TM_MAX ? 'RT60 alto' : 'RT60 bajo');
  return { clase, etiqueta, nota, nominal: guia, delta: tm - guia };
}

function classifyRT(tm) {
  return claseRT(tm);
}

function interpretRT(tm, V) {
  return `RT60 de <strong>${tm.toFixed(1)} s</strong> — ${lecturaRT(tm, V).nota}`;
}

// ════════════════════════════════════════════════════════════════
// MOTOR PRINCIPAL
// ════════════════════════════════════════════════════════════════

/**
 * Ejecuta la simulación acústica completa.
 * @param {Object} input
 * @param {number}   input.L
 * @param {number}   input.W
 * @param {number}   input.H
 * @param {number}   input.T             - Temperatura °C (10–30)
 * @param {Array}    input.surfaces      - [{ name, area, alpha[] }]
 * @param {boolean}  input.hasTreatment  - ¿Tiene tratamiento acústico?
 */
function calculate(input) {
  const { L, W, H, T, surfaces, hasTreatment = false } = input;
  validateSurfaceOrder(surfaces);

  // ── Geometría ───────────────────────────────────────────────
  const V       = L * W * H;
  const S_total = surfaces.reduce((s, sf) => s + sf.area, 0);
  const c       = speedOfSound(T);
  const fmp     = (4 * V) / S_total;

  const areasBySurface = surfaces.map(sf => ({ name: sf.name, area: sf.area }));

  // ── Absorción ────────────────────────────────────────────────
  const A_bands = BANDS.map((_, bi) =>
    surfaces.reduce((sum, sf) => sum + sf.alpha[bi] * sf.area, 0)
  );
  const alpha_avg_bands = A_bands.map(A => A / S_total);
  const alpha_avg       = alpha_avg_bands.reduce((a, b) => a + b, 0) / 6;

  // ── RT60 Sabine — siempre ────────────────────────────────────
  // Forma completa con absorción de aire: T = 0.161V / (Sα + 4mV)
  const RT_sabine = A_bands.map((A, bi) => {
    const denom = A + 4 * AIR_ABS_COEFF[bi] * V;
    return denom > 0 ? parseFloat(((0.161 * V) / denom).toFixed(1)) : null;
  });

  // ── RT60 Eyring — siempre ────────────────────────────────────
  // Forma completa con absorción de aire: T = 0.161V / (-S·ln(1-α) + 4mV)
  const RT_eyring = alpha_avg_bands.map((ab, bi) => {
    if (ab >= 1) return 0;
    const denom = -S_total * Math.log(1 - ab) + 4 * AIR_ABS_COEFF[bi] * V;
    return parseFloat(((0.161 * V) / denom).toFixed(1));
  });

  // ── Los dos tiempos de reverberación representativos ─────────
  //
  // RT_avg — VALOR PRINCIPAL, el que se muestra en el resumen.
  //   Media aritmética de las seis bandas de octava de 125 Hz a 4 kHz,
  //   calculadas por SABINE.
  //
  //   Por qué Sabine y no Eyring: los coeficientes de absorción tabulados
  //   que alimentan este motor se miden en cámara reverberante por el
  //   propio método de Sabine, así que usarlos en su ecuación es
  //   autoconsistente. Eyring es más exacto cuando la absorción media es
  //   alta (Sabine no tiende a cero cuando α→1), y por eso se mantiene
  //   calculado y a la vista en la pestaña Decay, pero el valor que se
  //   presenta como resumen es el de Sabine.
  //
  //   Por qué las seis bandas: el resultado se presenta como una
  //   caracterización global del recinto para uso general, no como el
  //   T_mid de la norma. ATENCIÓN al interpretarlo: la banda de 125 Hz
  //   suele quedar POR DEBAJO de la frecuencia de Schroeder de la sala,
  //   donde el modelo estadístico de campo difuso que sustenta a Sabine
  //   y a Eyring deja de ser válido. En salas pequeñas con tratamiento
  //   esa banda es además la de mayor RT, así que tira del promedio
  //   hacia arriba. La curva por bandas de la pestaña Decay es la
  //   lectura fiel; este promedio es un resumen.
  //
  // RT_mid — tiempo de reverberación de MEDIAS FRECUENCIAS: media de las
  //   bandas de 500 Hz y 1 kHz (índices 2 y 3), el T_mid habitual. No se
  //   muestra como titular, pero es el que alimenta la frecuencia de
  //   Schroeder, porque la expresión f_s = 2000·√(T/V) se formula sobre
  //   el tiempo de reverberación de medias frecuencias.
  const media = (bandas) => bandas.reduce((a, b) => a + (b || 0), 0) / bandas.length;
  const RT_avg = media(RT_sabine);
  // T_m del criterio de EBU/ITU: 250 Hz a 4 kHz, no las seis bandas.
  const RT_ebu = tmCriterio(RT_sabine);
  const RT_mid = (RT_sabine[2] + RT_sabine[3]) / 2;

  // ── RT60 Fitzroy — solo si hasTreatment ─────────────────────
  // Fórmula correcta: Fitzroy (1959) / Bies & Hansen (6ª ed., 2024)
  // La sala se divide en 3 pares de superficies paralelas por eje:
  //   Eje X: pared3 + pared4 (área W×H, normal en X)
  //   Eje Y: pared1 + pared2 (área L×H, normal en Y)
  //   Eje Z: piso  + techo   (área L×W, normal en Z)
  // T = (0.161×V/S) / Σₖ(Sₖ/S × (-ln(1-αₖ)))
  let RT_fitzroy = null;
  if (hasTreatment) {
    // Orden esperado de surfaces[]: piso(0), techo(1), pared1(2), pared2(3), pared3(4), pared4(5)
    const pares = [
      [surfaces[4], surfaces[5]],  // Eje X: pared3 + pared4
      [surfaces[2], surfaces[3]],  // Eje Y: pared1 + pared2
      [surfaces[0], surfaces[1]],  // Eje Z: piso  + techo
    ];

    RT_fitzroy = BANDS.map((_, bi) => {
      let denom = 0;
      for (const par of pares) {
        const S_par   = par.reduce((s, sf) => s + sf.area, 0);
        const alpha_par = par.reduce((s, sf) => s + sf.alpha[bi] * sf.area, 0) / S_par;
        if (alpha_par <= 0 || alpha_par >= 1) continue;
        denom += (S_par / S_total) * (-Math.log(1 - alpha_par));
      }
      if (denom <= 0) return null;
      // denom×S_total equivale a la absorción total "tipo Sabine"; se le
      // suma el término de aire 4mV antes de dividir, igual que en Sabine/Eyring.
      const A_equiv = denom * S_total + 4 * AIR_ABS_COEFF[bi] * V;
      return parseFloat(((0.161 * V) / A_equiv).toFixed(1));
    });
  }

  // ── RT60 Millington-Sette — solo si hasTreatment ────────────
  // Fórmula correcta: Millington (1932), Sette (1933)
  // T = 0.161×V / Σᵢ(Sᵢ × (-ln(1 - αᵢ)))
  // Sumatoria por cada superficie individual (no alpha promedio global)
  // Siempre positivo: αᵢ < 1 → (1-αᵢ) < 1 → ln < 0 → -ln > 0
  let RT_millington = null;
  if (hasTreatment) {
    RT_millington = BANDS.map((_, bi) => {
      let sumA = 0;
      for (const sf of surfaces) {
        const ai = sf.alpha[bi];
        if (ai <= 0)  continue;
        if (ai >= 1)  { sumA += sf.area * 20; continue; } // saturación
        sumA += sf.area * (-Math.log(1 - ai));
      }
      if (sumA <= 0) return null;
      const A_equiv = sumA + 4 * AIR_ABS_COEFF[bi] * V;
      return parseFloat(((0.161 * V) / A_equiv).toFixed(1));
    });
  }

  // ── Parámetros derivados ─────────────────────────────────────
  const R  = alpha_avg >= 1 ? 9999 : (S_total * alpha_avg) / (1 - alpha_avg);
  const dc = 0.057 * Math.sqrt(R);

  // ── Schroeder ────────────────────────────────────────────────
  const schroeder = RT_mid > 0 ? Math.round(2000 * Math.sqrt(RT_mid / V)) : 0;

  // ── Bolt ─────────────────────────────────────────────────────
  // L/H y W/H se conservan como referencia informativa (ligadas a las
  // dimensiones que configuraste), pero el criterio real de Bolt usa
  // las 3 dimensiones ORDENADAS de menor a mayor — ver comentario junto
  // a BOLT_POLYGON.
  const LH = L / H;
  const WH = W / H;

  const dimsSorted = [
    { key: 'L', label: 'Largo',  val: L },
    { key: 'W', label: 'Ancho',  val: W },
    { key: 'H', label: 'Altura', val: H },
  ].sort((a, b) => a.val - b.val);
  const [dimSmall, dimMid, dimLarge] = dimsSorted;

  const boltX = dimMid.val / dimSmall.val;   // intermedia / menor
  const boltY = dimLarge.val / dimSmall.val; // mayor / menor
  const inBolt = pointInPolygon(boltX, boltY, BOLT_POLYGON);
  const nearestBoltPoint = nearestPointOnPolygon(boltX, boltY, BOLT_POLYGON);
  const boltMargin = inBolt ? 0 : nearestBoltPoint.dist;

  // ── Modos normales ───────────────────────────────────────────
  const modes = computeModes(L, W, H, c, schroeder);

  return {
    L, W, H, T, V, S_total, fmp, c,
    areasBySurface,
    alpha_avg, A_bands, alpha_avg_bands,
    RT_sabine, RT_eyring, RT_fitzroy, RT_millington,
    RT_avg, RT_ebu, RT_mid, hasTreatment,
    R, dc, schroeder,
    LH, WH, inBolt, boltMargin, boltClase: claseBolt(inBolt, boltMargin),
    boltX, boltY, nearestBoltPoint,
    boltSmallestDim: dimSmall.key, boltMidDim: dimMid.key, boltLargestDim: dimLarge.key,
    boltSmallestLabel: dimSmall.label, boltMidLabel: dimMid.label, boltLargestLabel: dimLarge.label,
    modes,
    surfaces,
  };
}

// ════════════════════════════════════════════════════════════════
// MODOS NORMALES CON COLOR-CODING
// ════════════════════════════════════════════════════════════════

function computeModes(L, W, H, c, schroeder) {
  const modes   = [];
  const maxFreq = schroeder * 1.15;

  // Límite de índices por eje derivado de maxFreq (antes era un tope fijo
  // n<=4, que para salas chicas/Schroeder altos cortaba modos reales antes
  // de llegar a maxFreq — un modo axial puro en el eje más corto ya podía
  // superar ese límite sin que el eje alcanzara la frecuencia límite real).
  const nxMax = Math.max(4, Math.ceil((maxFreq * 2 * L) / c));
  const nyMax = Math.max(4, Math.ceil((maxFreq * 2 * W) / c));
  const nzMax = Math.max(4, Math.ceil((maxFreq * 2 * H) / c));

  for (let nx = 0; nx <= nxMax; nx++) {
    for (let ny = 0; ny <= nyMax; ny++) {
      for (let nz = 0; nz <= nzMax; nz++) {
        if (nx === 0 && ny === 0 && nz === 0) continue;

        const f = (c / 2) * Math.sqrt(
          Math.pow(nx / L, 2) +
          Math.pow(ny / W, 2) +
          Math.pow(nz / H, 2)
        );

        if (f < 20 || f > maxFreq) continue;

        const nonZero = (nx > 0 ? 1 : 0) + (ny > 0 ? 1 : 0) + (nz > 0 ? 1 : 0);
        let type, label;

        if (nonZero === 1) {
          type  = 'axial';
          const axis = nx > 0 ? `X (${L}m)` : ny > 0 ? `Y (${W}m)` : `Z (${H}m)`;
          label = `Axial ${axis}`;
        } else if (nonZero === 2) {
          type  = 'tangencial';
          label = `Tang. (${nx},${ny},${nz})`;
        } else {
          type  = 'oblicuo';
          label = `Obl. (${nx},${ny},${nz})`;
        }

        modes.push({
          f: Math.round(f * 10) / 10,
          type,
          label,
          nx,
          ny,
          nz,
        });
      }
    }
  }

  modes.sort((a, b) => a.f - b.f);
  return modes; // lista completa; la UI decide cómo agregarla/curarla
}

// ════════════════════════════════════════════════════════════════
// EXPORTS (solo Node/tests — en el navegador `module` no existe y
// este bloque no se ejecuta, así que no cambia nada del sitio en vivo)
// ════════════════════════════════════════════════════════════════
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculate, speedOfSound, combineAlphaByArea, classifyRT, interpretRT,
    lecturaRT, claseRT, tNominalRT, tmCriterio,
    brechaRT, lecturaEBU, toleranciaSuperior, ambitoEBU, proporcionesEBU,
    unidadBanda,
    EBU_TM_MIN, EBU_TM_MAX, EBU_V_MAX, EBU_AREA_MIN_REF, EBU_AREA_MIN_CTRL,
    getConstructionForSurface, getTreatmentForSurface, pointInPolygon, computeModes,
    CONSTRUCTION_MATERIALS, TREATMENT_MATERIALS, BANDS, BAND_LABELS,
    AIR_ABS_COEFF, AQVIS_SCHEMA_VERSION,
    BOLT_POLYGON, BOLT_REFERENCE_RATIOS, claseBolt, BOLT_TOLERANCIA,
  };
}
