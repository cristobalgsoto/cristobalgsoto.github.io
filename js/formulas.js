// ════════════════════════════════════════════════════════════════
// COMPOSITOR DE FÓRMULAS
//
// Escribe una fórmula como la escribiría el editor de ecuaciones de Word:
// las variables en cursiva, los números y los operadores en redonda, las
// fracciones apiladas con su raya en medio y los subíndices donde toca.
//
// NO usa LaTeX ni MathJax ni KaTeX a propósito. La misma pantalla tiene
// que existir en Unity con TextMeshPro, que no entiende LaTeX, y el
// compromiso del proyecto es que las dos versiones se parezcan píxel a
// píxel. Lo que sí se puede reproducir en Unity son CAJAS: una fila
// horizontal, una columna apilada y una raya. Así que una fórmula aquí es
// un árbol de cajas, y el mismo árbol se monta allá con LayoutGroups.
//
// ── La notación ──────────────────────────────────────────────────
//
//   *V*        variable, en cursiva         →  V
//   _{60}      subíndice de lo anterior     →  T₆₀
//   {a | b}    fracción apilada             →  a sobre b
//   todo lo demás va tal cual, en redonda: números, = ( ) · − + Σ ln
//
// Ejemplo:  "*T* = {0,161·*V* | *A* + 4*mV*}"
//
// La misma cadena la lee el compositor de Unity, así que una fórmula se
// escribe UNA vez y las dos versiones no pueden discrepar.
// ════════════════════════════════════════════════════════════════

/**
 * Compone una fórmula y devuelve su HTML.
 *
 * @param {string} src   la fórmula en la notación de arriba
 * @param {string} clase clase extra para el contenedor (p. ej. 'fx-lg')
 */
function fx(src, clase) {
  return `<span class="fx${clase ? ' ' + clase : ''}">${fxTrozos(src)}</span>`;
}

/** Compone el contenido de una fórmula, sin el contenedor. */
function fxTrozos(src) {
  let html = '';
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    // ── Fracción: {numerador | denominador} ──────────────────────
    if (c === '{') {
      const cierre = fxPareja(src, i);
      html += fxGrupo(src.slice(i + 1, cierre));
      i = cierre + 1;
      continue;
    }

    // ── Variable en cursiva: *V* ─────────────────────────────────
    if (c === '*') {
      const fin = src.indexOf('*', i + 1);
      if (fin > i) {
        html += `<i>${fxEscapar(src.slice(i + 1, fin))}</i>`;
        i = fin + 1;
        continue;
      }
    }

    // ── Raíz: √{...} ─────────────────────────────────────────────
    // El signo y, encima del contenido, la línea que lo cubre (el
    // vínculo). Es un borde superior, igual que la raya de la fracción,
    // para que en Unity sea otra vez una caja con una raya.
    if (c === '√') {
      if (src[i + 1] === '{') {
        const cierre = fxPareja(src, i + 1);
        html += '<span class="fx-raiz">√</span>'
              + `<span class="fx-radicando">${fxGrupo(src.slice(i + 2, cierre))}</span>`;
        i = cierre + 1;
        continue;
      }
    }

    // ── Exponente: ^{1/3} o ^2 ───────────────────────────────────
    if (c === '^') {
      if (src[i + 1] === '{') {
        const cierre = fxPareja(src, i + 1);
        html += `<span class="fx-sup">${fxTrozos(src.slice(i + 2, cierre))}</span>`;
        i = cierre + 1;
      } else if (src[i + 1]) {
        html += `<span class="fx-sup">${fxEscapar(src[i + 1])}</span>`;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    // ── Subíndice: _{60} o _k ────────────────────────────────────
    if (c === '_') {
      if (src[i + 1] === '{') {
        const cierre = fxPareja(src, i + 1);
        html += `<span class="fx-sub">${fxTrozos(src.slice(i + 2, cierre))}</span>`;
        i = cierre + 1;
      } else if (src[i + 1]) {
        html += `<span class="fx-sub">${fxEscapar(src[i + 1])}</span>`;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    // ── Operador suelto: se le da aire a los lados ───────────────
    // Sólo los binarios. El menos de "−ln" va pegado, así que se mira
    // que haya un espacio delante en la cadena original.
    if ('=+−<>≤≥'.includes(c) || (c === '·' && false)) {
      const sueltoIzq = i > 0 && src[i - 1] === ' ';
      html += sueltoIzq
        ? `<span class="fx-op">${fxEscapar(c)}</span>`
        : fxEscapar(c);
      i += 1;
      continue;
    }

    // ── Espacio: el que separa un operador ya lo pone el operador ─
    if (c === ' ') {
      const sig = src[i + 1];
      const ant = src[i - 1];
      if ('=+−<>≤≥'.includes(sig) || '=+−<>≤≥'.includes(ant)) { i += 1; continue; }
      html += '<span class="fx-esp"></span>';
      i += 1;
      continue;
    }

    html += fxEscapar(c);
    i += 1;
  }

  return html;
}

/**
 * El contenido de un grupo `{...}`. Si lleva una barra de fracción de
 * primer nivel se apila; si no, es sólo un paréntesis invisible que
 * agrupa —lo que necesitan la raíz y el exponente para saber hasta
 * dónde llegan.
 */
function fxGrupo(dentro) {
  const barra = fxBarra(dentro);
  if (barra < 0) return fxTrozos(dentro);
  return '<span class="fx-frac">'
       + `<span class="fx-num">${fxTrozos(dentro.slice(0, barra).trim())}</span>`
       + `<span class="fx-den">${fxTrozos(dentro.slice(barra + 1).trim())}</span>`
       + '</span>';
}

/** Índice de la llave que cierra la que empieza en `abre`. */
function fxPareja(src, abre) {
  let nivel = 0;
  for (let i = abre; i < src.length; i++) {
    if (src[i] === '{') nivel++;
    else if (src[i] === '}') { nivel--; if (nivel === 0) return i; }
  }
  return src.length;
}

/** Índice de la barra de fracción de primer nivel, o −1 si no hay. */
function fxBarra(src) {
  let nivel = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') nivel++;
    else if (src[i] === '}') nivel--;
    else if (src[i] === '|' && nivel === 0) return i;
  }
  return -1;
}

function fxEscapar(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Lo mismo pero para PROSA: un texto corriente donde sólo algún símbolo
 * suelto va compuesto. Se usa en la leyenda de la tarjeta de Decay, donde
 * la explicación de cada letra menciona otras letras.
 *
 *   "*S*_i la de cada cara"  →  S con subíndice i, y el resto en redonda.
 */
function fxTexto(src) {
  let html = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '*') {
      const fin = src.indexOf('*', i + 1);
      if (fin > i) {
        html += `<i class="fx-en-texto">${fxEscapar(src.slice(i + 1, fin))}</i>`;
        i = fin + 1;
        continue;
      }
    }
    if (c === '_' && src[i + 1] && src[i + 1] !== ' ') {
      html += `<sub>${fxEscapar(src[i + 1])}</sub>`;
      i += 2;
      continue;
    }
    html += fxEscapar(c);
    i += 1;
  }
  return html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fx, fxTexto, fxTrozos, fxGrupo, fxBarra, fxPareja };
}
