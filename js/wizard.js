const wizardState = {
  currentStep: 1,
  materialMode: 'library',
  hasTreatment: null,
};

const STEP_LABELS = {
  1: 'Espacio',
  2: 'Temperatura',
  3: 'Materiales',
  4: 'Absorción',
  5: 'Tratamiento',
  6: 'Detalle',
};

function getStepSequence() {
  const seq = [1, 2, 3];
  if (wizardState.materialMode === 'custom') seq.push(4);
  seq.push(5);
  if (wizardState.hasTreatment === true) seq.push(6);
  return seq;
}

function updateTimeline() {
  const nav = document.getElementById('timeline');
  if (!nav) return;

  const sequence = getStepSequence();
  nav.style.setProperty('--timeline-steps', sequence.length);
  nav.innerHTML = sequence.map((step, index) => {
    const currentIndex = sequence.indexOf(wizardState.currentStep);
    const status = step === wizardState.currentStep ? 'active' : index < currentIndex ? 'done' : 'upcoming';
    return `<div class="tl-node ${status}" role="listitem"${status === 'active' ? ' aria-current="step"' : ''}><span class="tl-dot" aria-hidden="true"></span><span class="tl-label">${STEP_LABELS[step]}</span></div>`;
  }).join('');
}

function goToStep(nextStep) {
  const current = document.getElementById(`step-${wizardState.currentStep}`);
  const next = document.getElementById(`step-${nextStep}`);
  if (!current || !next) return;

  current.classList.remove('active');
  next.classList.add('active');
  wizardState.currentStep = nextStep;
  updateTimeline();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goBackStep() {
  const sequence = getStepSequence();
  const previousStep = sequence[sequence.indexOf(wizardState.currentStep) - 1];
  if (previousStep) goToStep(previousStep);
}

function validateSpaceDimensions() {
  const inputs = ['w-largo', 'w-ancho', 'w-alto']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const firstInvalid = inputs.find((input) => !input.checkValidity());
  if (!firstInvalid) return true;
  firstInvalid.reportValidity();
  return false;
}

function restorePreviousDimensions() {
  let previousInput = null;
  try {
    previousInput = JSON.parse(sessionStorage.getItem('aqvis_input') || 'null');
  } catch (error) {
    previousInput = null;
  }

  if (!previousInput) return;
  [
    ['w-largo', previousInput.L],
    ['w-ancho', previousInput.W],
    ['w-alto', previousInput.H],
  ].forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input && Number.isFinite(Number(value))) input.value = value;
  });
}

function setMaterialMode(mode) {
  wizardState.materialMode = mode;

  document.querySelectorAll('.mtog-btn').forEach((button) => {
    button.classList.toggle('active', button.id === `mtog-${mode}`);
  });

  const libRows = document.getElementById('lib-rows');
  const customNote = document.getElementById('custom-note');
  if (libRows) libRows.style.display = mode === 'library' ? 'block' : 'none';
  if (customNote) customNote.style.display = mode === 'custom' ? 'block' : 'none';
  updateTimeline();
}

function selectTreatment(value) {
  wizardState.hasTreatment = value;
  document.querySelectorAll('.yn-card').forEach((card) => {
    const selectedId = value ? 'yn-yes' : 'yn-no';
    card.classList.toggle('selected', card.id === selectedId || card.dataset.treatment === String(value));
  });

  const button = document.getElementById('treat-continue-btn');
  if (button) {
    button.style.display = 'flex';
    button.style.opacity = '0';
    setTimeout(() => {
      button.style.opacity = '1';
      button.style.transition = 'opacity 0.3s';
    }, 10);
  }

  updateTimeline();
}

function afterMaterials() {
  goToStep(wizardState.materialMode === 'custom' ? 4 : 5);
}

function afterCustomAbsorption() {
  goToStep(5);
}

function continueTreatment() {
  if (wizardState.hasTreatment === null) return;
  if (wizardState.hasTreatment) goToStep(6);
  else runAndRedirect();
}

function getSurfaceArea(surfId, L, W, H) {
  if (surfId === 'piso' || surfId === 'techo') return L * W;
  if (surfId === 'pared1' || surfId === 'pared2') return L * H;
  if (surfId === 'pared3' || surfId === 'pared4') return W * H;
  return Infinity;
}

function buildMaterialDropdowns() {
  const surfIds = ['piso', 'techo', 'pared1', 'pared2', 'pared3', 'pared4'];
  surfIds.forEach((surfId) => {
    const sel = document.getElementById('mat-' + surfId);
    if (!sel) return;
    const names = getConstructionForSurface(surfId);
    sel.innerHTML = names.map((name) => `<option value="${name}">${name}</option>`).join('');

    const alphaEl = document.getElementById('alpha-' + surfId);
    const db = CONSTRUCTION_MATERIALS[names[0]];
    if (alphaEl && db) alphaEl.textContent = 'ᾱ ' + avgAlpha(db.alpha).toFixed(2);
  });
}

function buildTreatmentDropdowns() {
  const surfIds = ['piso', 'techo', 'pared1', 'pared2', 'pared3', 'pared4'];
  surfIds.forEach((surfId) => {
    const sel = document.getElementById('treat-mat-' + surfId);
    if (!sel) return;
    const names = getTreatmentForSurface(surfId);
    sel.innerHTML = '<option value="">Sin tratamiento</option>' + names.map((name) => `<option value="${name}">${name}</option>`).join('');
    updateTreatmentAlpha(sel, 'treat-alpha-' + surfId);
  });
}

function updateTreatmentAlpha(select, alphaId) {
  const output = document.getElementById(alphaId);
  if (!output) return;
  const treatment = TREATMENT_MATERIALS[select?.value];
  if (!treatment?.alpha?.length) {
    output.textContent = 'ᾱ —';
    return;
  }
  const average = treatment.alpha.reduce((sum, value) => sum + value, 0) / treatment.alpha.length;
  output.textContent = 'ᾱ ' + average.toFixed(2);
}

function initTreatmentValidation() {
  const surfIds = ['piso', 'techo', 'pared1', 'pared2', 'pared3', 'pared4'];
  surfIds.forEach((surfId) => {
    const input = document.getElementById('treat-m2-' + surfId);
    if (!input) return;

    const updateFeedback = () => {
      const L = safeNumber(document.getElementById('w-largo')?.value, 6.0);
      const W = safeNumber(document.getElementById('w-ancho')?.value, 4.5);
      const H = safeNumber(document.getElementById('w-alto')?.value, 2.8);
      const maxArea = getSurfaceArea(surfId, L, W, H);
      const val = safeNumber(input.value, 0);

      let feedback = input.parentElement.querySelector('.treat-feedback');
      if (!feedback) {
        feedback = document.createElement('div');
        feedback.className = 'treat-feedback';
        input.parentElement.appendChild(feedback);
      }

      if (val > maxArea) {
        input.classList.add('input-error');
        input.value = maxArea.toFixed(1);
        feedback.textContent = `❌ Máx: ${maxArea.toFixed(1)} m²`;
        feedback.style.color = '#FF4444';
      } else if (val > 0) {
        input.classList.remove('input-error');
        feedback.textContent = `✓ Disponible: ${(maxArea - val).toFixed(1)} m²`;
        feedback.style.color = '#00C2CB';
      } else {
        input.classList.remove('input-error');
        feedback.textContent = `Área superficie: ${maxArea.toFixed(1)} m²`;
        feedback.style.color = 'var(--text3)';
      }
    };

    input.addEventListener('input', updateFeedback);
    input.addEventListener('focus', updateFeedback);
  });
}

function renderCustomAbsorptionTable() {
  const body = document.getElementById('abs-tbody');
  if (!body) return;

  const surfIds = ['piso', 'techo', 'pared1', 'pared2', 'pared3', 'pared4'];
  const names = surfIds.map((id) => ({ id, label: id.replace('pared', 'Pared ') }));

  body.innerHTML = names.map(({ id, label }) => {
    const rowLabel = id === 'piso' ? 'Piso' : id === 'techo' ? 'Techo' : label;
    return `
      <tr>
        <td>${rowLabel}</td>
        ${BANDS.map((_, bi) => `
          <td><input type="number" id="abs-${id}-${bi}" value="0.05" min="0" max="1" step="0.01" /></td>
        `).join('')}
      </tr>
    `;
  }).join('');
}

function getInputs() {
  const L = safeNumber(document.getElementById('w-largo')?.value, 6.0);
  const W = safeNumber(document.getElementById('w-ancho')?.value, 4.5);
  const H = safeNumber(document.getElementById('w-alto')?.value, 2.8);
  let T = safeNumber(document.getElementById('w-temp')?.value, 20);
  T = clamp(T, 10, 30);

  const surfDefs = [
    { id: 'piso', name: 'Piso', area: L * W },
    { id: 'techo', name: 'Techo', area: L * W },
    { id: 'pared1', name: 'Pared 1', area: L * H },
    { id: 'pared2', name: 'Pared 2', area: L * H },
    { id: 'pared3', name: 'Pared 3', area: W * H },
    { id: 'pared4', name: 'Pared 4', area: W * H },
  ];

  const surfaces = surfDefs.map((def) => {
    let alpha = Array(6).fill(0.05);
    let materialName = 'Custom';

    if (wizardState.materialMode === 'custom') {
      alpha = BANDS.map((_, bi) => {
        const val = safeNumber(document.getElementById(`abs-${def.id}-${bi}`)?.value, 0.05);
        return clamp(val, 0, 1);
      });
    } else {
      const select = document.getElementById('mat-' + def.id);
      materialName = select?.options[select.selectedIndex]?.value || 'Hormigón liso';
      alpha = CONSTRUCTION_MATERIALS[materialName]?.alpha || Array(6).fill(0.05);
    }

    let treatment = null;
    if (wizardState.hasTreatment) {
      const treatSelect = document.getElementById('treat-mat-' + def.id);
      const treatName = treatSelect?.options[treatSelect.selectedIndex]?.value;
      const treatM2 = safeNumber(document.getElementById('treat-m2-' + def.id)?.value, 0);

      if (treatName && TREATMENT_MATERIALS[treatName] && treatM2 > 0) {
        const safeM2 = Math.min(treatM2, def.area);
        alpha = combineAlphaByArea(alpha, TREATMENT_MATERIALS[treatName].alpha, def.area, safeM2);
        treatment = { name: treatName, area: safeM2 };
      }
    }

    return { id: def.id, name: def.name, area: def.area, alpha, materialName, treatment };
  });

  return { L, W, H, T, surfaces, hasTreatment: wizardState.hasTreatment === true };
}

function runAndRedirect() {
  const input = getInputs();
  const result = calculate(input);
  const clean = JSON.parse(JSON.stringify(result, (_, value) =>
    typeof value === 'number' && !Number.isFinite(value) ? null : value
  ));

  input.schemaVersion = AQVIS_SCHEMA_VERSION;
  clean.schemaVersion = AQVIS_SCHEMA_VERSION;

  sessionStorage.setItem('aqvis_input', JSON.stringify(input));
  sessionStorage.setItem('aqvis_result', JSON.stringify(clean));
  window.location.href = 'results.html';
}

document.addEventListener('DOMContentLoaded', () => {
  const timeline = document.getElementById('timeline');
  if (timeline) updateTimeline();

  restorePreviousDimensions();
  buildMaterialDropdowns();

  const stepOneNext = document.getElementById('next-step-1');
  if (stepOneNext) stepOneNext.addEventListener('click', () => {
    if (validateSpaceDimensions()) goToStep(2);
  });

  const stepTwoNext = document.getElementById('next-step-2');
  if (stepTwoNext) stepTwoNext.addEventListener('click', () => goToStep(3));

  const stepThreeNext = document.getElementById('next-step-3');
  if (stepThreeNext) stepThreeNext.addEventListener('click', afterMaterials);

  renderCustomAbsorptionTable();
  const stepFourNext = document.getElementById('next-step-4');
  if (stepFourNext) stepFourNext.addEventListener('click', afterCustomAbsorption);

  const stepSixNext = document.getElementById('next-step-6');
  if (stepSixNext) stepSixNext.addEventListener('click', runAndRedirect);

  buildTreatmentDropdowns();
  initTreatmentValidation();

  document.querySelectorAll('input[type="range"]').forEach((slider) => {
    const valId = slider.dataset.valId;
    const suffix = slider.dataset.suffix || '';
    syncSlider(slider, valId, suffix);
    slider.addEventListener('input', () => syncSlider(slider, valId, suffix));
  });

  const tempPreview = document.getElementById('vsound-preview');
  const tempRange = document.getElementById('w-temp');
  if (tempPreview && tempRange) {
    const updatePreview = () => {
      const temp = clamp(safeNumber(tempRange.value, 20), 10, 30);
      const speed = speedOfSound(temp).toFixed(1);
      tempPreview.textContent = `c = ${speed} m/s a ${temp}°C`;
    };
    tempRange.addEventListener('input', updatePreview);
    updatePreview();
  }
});
