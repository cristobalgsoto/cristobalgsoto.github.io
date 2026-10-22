document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAqvisTooltips();

  const startBtn = document.getElementById('start-sim-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      window.location.href = 'simulator.html';
    });
  }

  const homeButtons = document.querySelectorAll('#btn-home');
  homeButtons.forEach(button => {
    button.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  });

  const newSimButtons = document.querySelectorAll('#btn-new-sim');
  newSimButtons.forEach(button => {
    button.addEventListener('click', () => {
      window.location.href = 'simulator.html';
    });
  });
});

function initAqvisTooltips() {
  const tooltip = document.createElement('div');
  tooltip.className = 'aq-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltip);
  let activeTarget = null;

  const moveTooltip = (event) => {
    const offset = 14;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = Math.min(event.clientX + offset, window.innerWidth - width - 12);
    const top = event.clientY + offset + height > window.innerHeight
      ? event.clientY - height - offset
      : event.clientY + offset;
    tooltip.style.left = `${Math.max(12, left)}px`;
    tooltip.style.top = `${Math.max(12, top)}px`;
  };

  document.addEventListener('pointerover', (event) => {
    const target = event.target.closest?.('[data-tooltip]');
    if (!target) return;
    activeTarget = target;
    // El globo tiene tres partes, y de las tres sólo el cuerpo es
    // obligatorio: un titulillo que dice de qué se está hablando, la
    // explicación en llano, y la fórmula compuesta al pie para quien la
    // quiera. Ese orden es deliberado: antes el globo EMPEZABA por la
    // fórmula, y quien no la reconocía se quedaba sin saber qué era la
    // cifra que estaba mirando.
    const titulo = target.dataset.tooltipTitle;
    const formula = target.dataset.tooltipFx;
    tooltip.innerHTML =
      (titulo ? `<span class="aq-tip-title">${fxEscapar(titulo)}</span>` : '') +
      fxEscapar(target.dataset.tooltip || '') +
      (formula && typeof fx === 'function' ? `<span class="aq-tip-fx">${fx(formula)}</span>` : '');
    tooltip.classList.add('visible');
    moveTooltip(event);
  });

  document.addEventListener('pointermove', (event) => {
    if (activeTarget) moveTooltip(event);
  });

  document.addEventListener('pointerout', (event) => {
    if (!activeTarget || event.relatedTarget?.closest?.('[data-tooltip]') === activeTarget) return;
    activeTarget = null;
    tooltip.classList.remove('visible');
  });
}

function goHome() {
  window.location.href = 'index.html';
}

function toggleTheme() {
  const isLight = document.body.classList.contains('light-mode');
  setTheme(isLight ? 'dark' : 'light');
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem('aqvis_theme');
  } catch (e) {
    saved = null;
  }

  const preferred = saved || ((window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark');
  setTheme(preferred);
}

function setTheme(mode) {
  const body = document.body;
  if (!body) return;

  body.classList.toggle('light-mode', mode === 'light');
  try {
    localStorage.setItem('aqvis_theme', mode);
  } catch (e) {
    // ignore
  }

  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.innerHTML = themeIcon(mode);
  btn.title = mode === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
}

function themeIcon(mode) {
  const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor"/></svg>';
  return mode === 'light' ? sun : moon;
}

function syncSlider(input, valId, suffix) {
  const min = safeNumber(input.min, 0);
  const max = safeNumber(input.max, 100);
  const value = safeNumber(input.value, min);
  const pct = ((value - min) / (max - min || 1)) * 100;
  input.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--surface3) ${pct}%)`;

  const label = document.getElementById(valId);
  if (label) label.textContent = `${value}${suffix}`;
}

function updateAlphaDisplay(select, alphaId) {
  const el = document.getElementById(alphaId);
  if (!el || !select) return;

  const name = select.options[select.selectedIndex]?.value;
  const match = CONSTRUCTION_MATERIALS[name] || TREATMENT_MATERIALS[name];
  if (match) {
    el.textContent = 'ᾱ ' + avgAlpha(match.alpha).toFixed(2);
  } else {
    el.textContent = 'ᾱ —';
  }
}

function avgAlpha(alphaArr) {
  return alphaArr.reduce((sum, value) => sum + value, 0) / alphaArr.length;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
