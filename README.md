# AQVIS — Acoustic Visual Simulation Engine

Simulador de acústica de recintos para la web: define las dimensiones de una
sala rectangular, su temperatura, los materiales de cada superficie y un
tratamiento acústico opcional, y AQVIS calcula el tiempo de reverberación
(RT60), los modos normales, la frecuencia de Schroeder, la distancia crítica
y la proporción de la sala según el diagrama de Bolt (1946) — con
visualización 3D interactiva hecha con [Three.js](https://threejs.org/).

Sitio en vivo (GitHub Pages): **https://cristobalgsoto.github.io/**

## Qué hace

1. **Espacio** — largo, ancho y alto del recinto.
2. **Temperatura** — afecta la velocidad del sonido (`c = 331.3 + 0.606·T`).
3. **Materiales** — asigna un material de construcción a cada una de las 6
   superficies (piso, techo, 4 paredes), desde una biblioteca con
   coeficientes de absorción por banda de octava, o definiéndolos a mano.
4. **Tratamiento acústico** (opcional) — paneles, espuma, alfombra, cortinas,
   etc., combinados por área con el material base de cada superficie.
5. **Resultados** — RT60 por banda (125 Hz–4 kHz) con 4 métodos de cálculo,
   modos normales clasificados (axial/tangencial/oblicuo), frecuencia de
   Schroeder, distancia crítica, y un visor 3D de la sala.

## Métodos de cálculo de RT60

| Método | Cuándo se calcula | Fuente |
|---|---|---|
| Sabine | Siempre | Sabine (1900) |
| Eyring | Siempre | Eyring (1930) |
| Fitzroy | Solo si hay tratamiento acústico | Fitzroy (1959) / Bies & Hansen (6ª ed., 2024) |
| Millington-Sette | Solo si hay tratamiento acústico | Millington (1932), Sette (1933) |

Las 4 fórmulas incluyen el término de absorción del aire (`4mV`) en el
denominador. El diagrama de proporciones usa la región de Bolt (1946) sobre
las 3 dimensiones ordenadas de menor a mayor. El detalle de cada fórmula y
sus referencias está documentado directamente en los comentarios de
[`js/aqengine.js`](js/aqengine.js).

## Stack técnico

Sitio 100% estático, sin build ni dependencias de npm:

- HTML / CSS / JavaScript vanilla (sin framework).
- [Three.js](https://threejs.org/) (vendorizado en `js/three.min.js`) +
  `OrbitControls` para la visualización 3D.
- Pensado para servirse directo desde GitHub Pages.

## Estructura del proyecto

```
index.html          Landing / hero animado
simulator.html       Wizard de configuración de la sala (pasos 1–6)
results.html         Panel de resultados + visor 3D + gráficos

js/
  aqengine.js         Motor de cálculo acústico (puro, sin DOM)
  wizard.js            Lógica del wizard de simulator.html
  results.js           Lógica de resultados (gráficos RT60, pestañas)
  renderer.js          Render 3D de resultados (sala + reflexiones + modos)
  simulator-renderer.js  Render 3D del cubo de previsualización del wizard
  app.js               Tema (claro/oscuro), tooltips, utilidades compartidas
  three.min.js          Three.js vendorizado
  OrbitControls.js       Controles de órbita de cámara vendorizados

css/global.css        Estilos y tokens de diseño (`:root` custom properties)
tests/                 Suite de verificación del motor (ver abajo)
```

`aqengine.js` no toca el DOM: recibe un objeto `input` plano y devuelve un
objeto `result` plano. Eso es lo que permite probarlo de forma aislada con
Node y es el mismo contrato que se guarda en `sessionStorage` entre
`simulator.html` y `results.html`.

## Cómo correrlo localmente

No requiere build. Basta con servir la carpeta como estático, por ejemplo:

```bash
npx serve .
# o
python -m http.server 8000
```

Abrir `index.html` directamente con `file://` también funciona para
navegar, aunque algunos navegadores restringen ciertas APIs en ese modo —
se recomienda un servidor local simple.

## Tests

El motor de cálculo (`js/aqengine.js`) tiene una suite de verificación en
`tests/`, sin dependencias externas — usa el test runner que trae Node de
fábrica (Node 18+):

```bash
node --test
```

La suite no solo fija números de regresión: verifica **propiedades físicas**
que las fórmulas deben cumplir siempre (por ejemplo, que Fitzroy y
Millington-Sette colapsan algebraicamente al mismo resultado que Eyring
cuando el α es uniforme en las 6 superficies, o que Eyring converge a Sabine
para α pequeño). Si un futuro cambio introduce un signo o un índice
equivocado en una de las fórmulas, el resultado puede seguir "pareciendo"
un RT60 razonable — estas pruebas están pensadas para romperse en ese caso
aunque el número en sí luzca plausible.

También cubre la validación del orden de `surfaces[]` que `calculate()`
exige para Fitzroy (ver siguiente sección).

## Nota de diseño: orden de `surfaces[]`

`calculate()` necesita que `input.surfaces` llegue siempre como
`[piso, techo, pared1, pared2, pared3, pared4]`, en ese orden exacto, porque
Fitzroy agrupa pares de superficies opuestas por índice fijo. Cada superficie
puede incluir un campo `id` (`'piso'`, `'techo'`, `'pared1'`...); si está
presente, `calculate()` valida el orden y lanza un error explícito en vez de
devolver un RT60 Fitzroy incorrecto en silencio. El campo `id` es opcional
por compatibilidad hacia atrás, pero `wizard.js` siempre lo envía.

## Licencia

MIT — ver [LICENSE](LICENSE).

## Autor

Cristóbal Gerardo Contreras Soto
