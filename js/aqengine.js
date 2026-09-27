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

// ── Región de Bolt (1946) ──────────────────────────────────────
// Los ejes del diagrama original NO son L/H y W/H directamente: son
// las 3 dimensiones de la sala ORDENADAS de menor a mayor, expresadas
// como proporción respecto a la menor:
//   x = dimensión intermedia / dimensión menor
//   y = dimensión mayor      / dimensión menor
// La región preferida no es un rectángulo — es un área irregular e
// inclinada. El polígono de abajo se trazó a partir de una reproducción
// del gráfico original de Bolt (1946); si necesitas citar coordenadas
// exactas en un informe, verifícalas contra tu fuente.
const BOLT_POLYGON = [
  [1.45, 1.45], [1.55, 1.55], [1.65, 1.75], [1.75, 1.95], [1.83, 2.10],
  [1.87, 2.20], [1.83, 2.30], [1.72, 2.42], [1.60, 2.50], [1.50, 2.55],
  [1.42, 2.45], [1.35, 2.25], [1.30, 2.05], [1.28, 1.88], [1.30, 1.70],
  [1.35, 1.58], [1.40, 1.50],
];

// Proporciones "óptimas" puntuales citadas en la literatura de acústica
// de recintos, en el mismo espacio (media/menor, mayor/menor). Verificar
// decimales contra la fuente si se citan con precisión en un informe.
const BOLT_REFERENCE_RATIOS = [
  { name: 'Louden (1971)',     x: 1.40, y: 1.90 },
  { name: 'Sepmeyer A (1965)', x: 1.14, y: 1.39 },
  { name: 'Sepmeyer B (1965)', x: 1.28, y: 1.54 },
  { name: 'Sepmeyer C (1965)', x: 1.60, y: 2.33 },
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

function classifyRT(rt) {
  if (rt >= 0.4 && rt <= 0.9) return 'good';
  if (rt >= 0.3 && rt <= 1.3) return 'warn';
  return 'bad';
}

function interpretRT(RT_mid) {
  const rt = RT_mid.toFixed(1);
  if (RT_mid < 0.3)  return `RT60 de <strong>${rt} s</strong> — sala muy absorbente. Puede sonar apagada.`;
  if (RT_mid <= 0.7) return `RT60 de <strong>${rt} s</strong> — rango adecuado para uso general.`;
  if (RT_mid <= 1.2) return `RT60 de <strong>${rt} s</strong> — algo elevado. Considera tratamiento absorbente.`;
  if (RT_mid <= 2.0) return `RT60 de <strong>${rt} s</strong> — sala reverberante. Adecuado para música.`;
  return `RT60 de <strong>${rt} s</strong> — muy reverberante. Se recomienda tratamiento acústico.`;
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

  // RT60 mid: promedio 500Hz + 1kHz (índices 2 y 3)
  const RT_mid = (RT_eyring[2] + RT_eyring[3]) / 2;

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
    RT_mid, hasTreatment,
    R, dc, schroeder,
    LH, WH, inBolt, boltMargin,
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
