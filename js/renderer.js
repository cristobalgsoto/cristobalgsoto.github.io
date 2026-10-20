/**
 * renderer.js — Renderiza resultados en la pantalla de resultados
 * AQVIS — Acoustic Visual Simulation Engine
 */

'use strict';

function renderResults(res, inp) {
  currentResultData = res;

  renderThreeJS(res, inp);
  renderDecay(res);
  if (typeof renderRT60Chart === 'function') renderRT60Chart(res, decayMethod);
  renderVariables(res);
  renderModes(res);
  renderBolt(res);
  renderSpace(res, inp);
}

// ── Three.js ─────────────────────────────────────

// Instancias globales para poder actualizar el cubo sin recrear la escena
let _threeState = null;
let _availableModes = [];

function moveThreeCamera(direction) {
  const state = _threeState;
  if (!state?.controls) return;
  const offset = state.camera.position.clone().sub(state.controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  const step = 0.16;
  if (direction === 'left') spherical.theta -= step;
  if (direction === 'right') spherical.theta += step;
  if (direction === 'up') spherical.phi -= step;
  if (direction === 'down') spherical.phi += step;
  spherical.phi = Math.max(0.12, Math.min(Math.PI / 2 - 0.06, spherical.phi));
  state.animateCameraTo(state.controls.target.clone().add(new THREE.Vector3().setFromSpherical(spherical)));
}

function zoomThreeCamera(direction) {
  const state = _threeState;
  if (!state?.controls) return;
  const offset = state.camera.position.clone().sub(state.controls.target);
  const nextDistance = offset.length() * (direction === 'in' ? 0.84 : 1.19);
  offset.setLength(Math.max(state.controls.minDistance, Math.min(20, nextDistance)));
  state.animateCameraTo(state.controls.target.clone().add(offset));
}

function toggleDecayPlayback() {
  if (_threeState?.toggleDecayPlayback) _threeState.toggleDecayPlayback();
}

let cameraHoldTimeout = null;
let cameraHoldInterval = null;

function startCameraHold(direction) {
  stopCameraHold();
  cameraHoldTimeout = setTimeout(() => {
    cameraHoldInterval = setInterval(() => moveThreeCamera(direction), 120);
  }, 220);
}

function stopCameraHold() {
  clearTimeout(cameraHoldTimeout);
  clearInterval(cameraHoldInterval);
  cameraHoldTimeout = null;
  cameraHoldInterval = null;
}

function renderThreeJS(res, inp) {
  const container = document.getElementById('three-container');
  if (!container || typeof THREE === 'undefined') return;

  // Si ya existe la escena, solo actualizar dimensiones
  if (_threeState) {
    _updateRoomMesh(_threeState, inp.L, inp.W, inp.H);
    return;
  }

  // ── Primera inicialización ──────────────────────
  container.innerHTML = '';
  const W = container.offsetWidth  || 400;
  const H = container.offsetHeight || 300;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);
  scene.fog = new THREE.FogExp2(0x0a0a0a, 0.006);

  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 1000);
  camera.position.set(6, 5, 8);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // ── Luces ───────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x333333));

  const mainLight = new THREE.DirectionalLight(0xffffff, 1);
  mainLight.position.set(2, 3, 2);
  scene.add(mainLight);

  const fillLight = new THREE.PointLight(0x4466aa, 0.4);
  fillLight.position.set(-1, 1, -2);
  scene.add(fillLight);

  const backLight = new THREE.PointLight(0xffaa66, 0.3);
  backLight.position.set(0, 1, 2);
  scene.add(backLight);

  // ── Grid ────────────────────────────────────────
  const gridHelper = new THREE.GridHelper(240, 160, 0x333333, 0x1e1e1e);
  gridHelper.position.y = 0;
  scene.add(gridHelper);

  const floorGeo = new THREE.PlaneGeometry(800, 800);
  const floorMat = new THREE.MeshBasicMaterial({
    color: 0x09090d,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -0.002;
  scene.add(floorMesh);

  // ── Cubo inicial ────────────────────────────────
  let roomMesh = null;
  let wireframe = null;
  let controls = null;
  let modeCloud = null;
  let modeCloudBase = null;
  let selectedMode = null;
  let modeViewActive = false;
  let transitionFrom = null;
  let transitionTo = null;
  let transitionStart = 0;
  const transitionDuration = 420;
  let decayRays = null;
  let decayRayPaths = [];
  let decayMethodState = null;
  let decayAnimationStart = performance.now();
  let decayTabActive = false;
  let decayPlaying = true;

  function _modeAxisOffset(index, size) {
    if (!index) return 0;
    const antinode = Math.floor((index - 1) / 2);
    const normalized = (2 * antinode + 1) / (2 * index);
    return (normalized - 0.5) * size;
  }

  function _smoothStep(edge0, edge1, value) {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function _buildDecayRays(bw, bh, bd, seedOffset = 0) {
    if (decayRays) scene.remove(decayRays);

    const bounds = { x: bw / 2, y: bh / 2, z: bd / 2 };
    const rayCount = 28;
    const pathPointCount = 72;
    const trailSegments = 18;
    const directions = [];
    decayRayPaths = [];
    let seed = 7919 + seedOffset;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let rayIndex = 0; rayIndex < rayCount; rayIndex++) {
      const azimuth = random() * Math.PI * 2;
      const elevation = (random() - 0.5) * Math.PI * 0.8;
      directions.push(new THREE.Vector3(
        Math.cos(elevation) * Math.cos(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.sin(azimuth),
      ).normalize());
    }

    for (const direction of directions) {
      const origin = new THREE.Vector3(
        (random() - 0.5) * bw * 0.18,
        (random() - 0.5) * bh * 0.18,
        (random() - 0.5) * bd * 0.18,
      );
      const points = [origin.clone()];
      const current = origin.clone();
      const velocity = direction.clone();
      for (let pointIndex = 1; pointIndex < pathPointCount; pointIndex++) {
        const tx = velocity.x > 0 ? (bounds.x - current.x) / velocity.x : (-bounds.x - current.x) / velocity.x;
        const ty = velocity.y > 0 ? (bounds.y - current.y) / velocity.y : (-bounds.y - current.y) / velocity.y;
        const tz = velocity.z > 0 ? (bounds.z - current.z) / velocity.z : (-bounds.z - current.z) / velocity.z;
        const distance = Math.min(tx > 0 ? tx : Infinity, ty > 0 ? ty : Infinity, tz > 0 ? tz : Infinity);
        current.addScaledVector(velocity, distance);
        points.push(current.clone());
        if (Math.abs(current.x) >= bounds.x - 0.0001) velocity.x *= -1;
        if (Math.abs(current.y) >= bounds.y - 0.0001) velocity.y *= -1;
        if (Math.abs(current.z) >= bounds.z - 0.0001) velocity.z *= -1;
      }

      const cumulative = [0];
      for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
        cumulative.push(cumulative[pointIndex - 1] + points[pointIndex - 1].distanceTo(points[pointIndex]));
      }
      decayRayPaths.push({ points, cumulative, length: cumulative[cumulative.length - 1] });
    }

    const positions = new Float32Array(rayCount * trailSegments * 6);
    const opacities = new Float32Array(rayCount * trailSegments * 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(0xff8a00) },
      },
      vertexShader: `
        attribute float aOpacity;
        varying float vOpacity;
        void main() {
          vOpacity = aOpacity;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying float vOpacity;
        void main() { gl_FragColor = vec4(color, vOpacity); }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    decayRays = new THREE.LineSegments(geometry, material);
    decayRays.position.y = roomMesh.position.y;
    decayRays.visible = false;
    decayRays.userData = { bw, bh, bd, trailSegments };
    scene.add(decayRays);
  }

  function _sampleDecayPath(path, distance) {
    const wrapped = ((distance % path.length) + path.length) % path.length;
    let index = 1;
    while (index < path.cumulative.length && path.cumulative[index] < wrapped) index++;
    const start = path.points[index - 1];
    const end = path.points[index] || path.points[path.points.length - 1];
    const span = path.cumulative[index] - path.cumulative[index - 1] || 1;
    return start.clone().lerp(end, (wrapped - path.cumulative[index - 1]) / span);
  }

  function _updateDecayMethod(method, result) {
    if (!decayRays || !result) return;
    const definition = typeof DECAY_METHODS !== 'undefined' && DECAY_METHODS[method]
      ? DECAY_METHODS[method]
      : { key: 'RT_sabine', color: '#ff8a00' };
    const values = result[definition.key] || [];
    const average = values.filter(value => Number.isFinite(value));
    const rt60 = average.length ? average.reduce((sum, value) => sum + value, 0) / average.length : 1;
    const fmp = Math.max(0.05, Number(result.fmp) || 1);
    decayMethodState = { rt60, fmp, color: definition.color || '#ff8a00' };
    const methodSeed = Array.from(method || 'sabine').reduce(
      (sum, character) => sum + character.charCodeAt(0), 0,
    ) * 97;
    const dimensions = decayRays.userData;
    const wasVisible = decayRays.visible;
    _buildDecayRays(dimensions.bw, dimensions.bh, dimensions.bd, methodSeed);
    decayRays.visible = wasVisible || decayTabActive;
    decayRays.material.uniforms.color.value.set(decayMethodState.color);
    decayAnimationStart = performance.now();
  }

  function _animateDecayRays(time) {
    if (!decayRays || !decayRays.visible || !decayMethodState || !decayPlaying) return false;
    const { rt60, fmp } = decayMethodState;
    const scale = decayRays.userData.bw / Math.max(0.1, decayRays.userData.bw, decayRays.userData.bh, decayRays.userData.bd);
    const visualMeanPath = Math.max(0.12, fmp * scale);
    const visualSpeed = visualMeanPath / 0.42;
    const gapDuration = Math.min(0.18, Math.max(0.08, rt60 * 0.035));
    const cycleDuration = rt60 + gapDuration;
    const cycleAge = ((time - decayAnimationStart) / 1000) % cycleDuration;
    const age = Math.min(cycleAge, rt60);
    const trailDistance = visualMeanPath * 1.35;
    const positions = decayRays.geometry.attributes.position.array;
    const opacities = decayRays.geometry.attributes.aOpacity.array;
    let vertex = 0;
    let alphaIndex = 0;
    decayRayPaths.forEach(path => {
      const headDistance = age * visualSpeed;
      for (let segment = 0; segment < decayRays.userData.trailSegments; segment++) {
        const currentDistance = headDistance - segment * (trailDistance / decayRays.userData.trailSegments);
        const start = currentDistance >= 0
          ? _sampleDecayPath(path, currentDistance)
          : new THREE.Vector3(0, 0, 0);
        const endDistance = currentDistance + trailDistance / decayRays.userData.trailSegments;
        const end = endDistance >= 0
          ? _sampleDecayPath(path, endDistance)
          : new THREE.Vector3(0, 0, 0);
        positions[vertex++] = start.x;
        positions[vertex++] = start.y;
        positions[vertex++] = start.z;
        positions[vertex++] = end.x;
        positions[vertex++] = end.y;
        positions[vertex++] = end.z;
        const trailFade = currentDistance >= 0
          ? 1 - segment / decayRays.userData.trailSegments
          : 0;
        const decayFade = cycleAge < rt60 ? Math.pow(10, -6 * age / rt60) : 0;
        opacities[alphaIndex++] = trailFade * decayFade * 0.8;
        opacities[alphaIndex++] = trailFade * decayFade * 0.8;
      }
    });
    decayRays.geometry.attributes.position.needsUpdate = true;
    decayRays.geometry.attributes.aOpacity.needsUpdate = true;
    return true;
  }

  function _positionModeCloud(mode, bw, bh, bd) {
    if (!modeCloud) return;
    const target = _getModeCloudPosition(mode, bw, bh, bd);
    modeCloud.position.copy(target);
  }

  function _getModeCloudPosition(mode, bw, bh, bd) {
    return new THREE.Vector3(
      _modeAxisOffset(mode.nx, bw),
      roomMesh.position.y + _modeAxisOffset(mode.ny, bh),
      _modeAxisOffset(mode.nz, bd),
    );
  }

  function _buildModeCloud(bw, bh, bd) {
    if (modeCloud) scene.remove(modeCloud);

    const gridX = 20;
    const gridY = 12;
    const gridZ = 16;
    const count = gridX * gridY * gridZ;
    modeCloudBase = new Float32Array(count * 3);
    const signals = new Float32Array(count);
    const positions = new Float32Array(count * 3);

    let i = 0;
    for (let iz = 0; iz < gridZ; iz++) {
      for (let iy = 0; iy < gridY; iy++) {
        for (let ix = 0; ix < gridX; ix++) {
      const offset = i * 3;
          const x = -bw / 2 + (ix / (gridX - 1)) * bw;
          const y = -bh / 2 + (iy / (gridY - 1)) * bh;
          const z = -bd / 2 + (iz / (gridZ - 1)) * bd;
      modeCloudBase[offset] = positions[offset] = x;
      modeCloudBase[offset + 1] = positions[offset + 1] = y;
      modeCloudBase[offset + 2] = positions[offset + 2] = z;
          i++;
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSignal', new THREE.BufferAttribute(signals, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        nodeColor: { value: new THREE.Color(0x2388ff) },
        antinodeColor: { value: new THREE.Color(0xff3b22) },
      },
      vertexShader: `
        attribute float aSignal;
        varying float vSignal;
        void main() {
          vSignal = aSignal;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (0.017 + abs(aSignal) * 0.032) * 300.0 / max(1.0, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 nodeColor;
        uniform vec3 antinodeColor;
        varying float vSignal;
        void main() {
          float distanceToCenter = distance(gl_PointCoord, vec2(0.5));
          float softCircle = 1.0 - smoothstep(0.25, 0.5, distanceToCenter);
          if (softCircle <= 0.0) discard;
          float strength = abs(vSignal);
          vec3 color = mix(nodeColor, antinodeColor, smoothstep(0.05, 0.8, strength));
          gl_FragColor = vec4(color, (0.25 + strength * 0.75) * softCircle);
        }
      `,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    modeCloud = new THREE.Points(geometry, material);
    modeCloud.position.y = roomMesh.position.y;
    modeCloud.userData.bw = bw;
    modeCloud.userData.bh = bh;
    modeCloud.userData.bd = bd;
    modeCloud.visible = false;
    scene.add(modeCloud);
    if (selectedMode) _positionModeCloud(selectedMode, bw, bh, bd);
  }

  function _animateModeCloud(time) {
    if (!modeCloud) return false;

    let changed = false;
    if (transitionStart) {
      const transition = Math.min(1, (time - transitionStart) / transitionDuration);
      const easedTransition = transition * transition * (3 - 2 * transition);
      modeCloud.position.lerpVectors(transitionFrom, transitionTo, easedTransition);
      changed = true;
      if (transition >= 1) transitionStart = 0;
    }
    if (!selectedMode) return changed;

    const positions = modeCloud.geometry.attributes.position.array;
    const signals = modeCloud.geometry.attributes.aSignal.array;
    const { bw, bh, bd } = modeCloud.userData;
    const phase = time * 0.0015;
    const { nx, ny, nz } = selectedMode;
    for (let i = 0; i < positions.length; i += 3) {
      const particleIndex = i / 3;
      const x = modeCloudBase[i] / bw + 0.5;
      const y = modeCloudBase[i + 1] / bh + 0.5;
      const z = modeCloudBase[i + 2] / bd + 0.5;
      const field = Math.cos(nx * Math.PI * x)
        * Math.cos(ny * Math.PI * y)
        * Math.cos(nz * Math.PI * z);
      const proceduralNoise = 0.10 * Math.sin(x * 37 + z * 23 + time * 0.0007)
        + 0.06 * Math.sin(y * 51 - x * 17 - time * 0.00045);
      signals[particleIndex] = field * Math.cos(phase + proceduralNoise);
    }
    modeCloud.geometry.attributes.aSignal.needsUpdate = true;
    return true;
  }

  function _buildMesh(L, W, H) {
    if (roomMesh)  scene.remove(roomMesh);
    if (wireframe) scene.remove(wireframe);

    const maxDim = Math.max(L, W, H);
    const scale  = 2.2 / maxDim;
    const bw = L * scale;
    const bh = H * scale;
    const bd = W * scale;

    const geo = new THREE.BoxGeometry(bw, bh, bd);

    const faceMat = new THREE.MeshBasicMaterial({
      color: 0x00c2cb,
      transparent: true,
      opacity: 0.30,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    roomMesh = new THREE.Mesh(geo, faceMat);
    roomMesh.position.y = bh / 2 + 0.04;
    scene.add(roomMesh);

    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1 });
    wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
    wireframe.position.y = bh / 2 + 0.04;
    scene.add(wireframe);
    _buildModeCloud(bw, bh, bd);
    _buildDecayRays(bw, bh, bd);
    if (decayRays) decayRays.visible = decayTabActive;

    if (controls) {
      controls.target.set(0, roomMesh.position.y, 0);
      controls.update();
    }
    transitionStart = 0;
  }

  // ── Render on demand ─────────────────────────────
  // El loop de abajo corre siempre (requestAnimationFrame), pero solo
  // llama a renderer.render() cuando algo realmente cambió (cámara,
  // geometría, resize). Evita repintar 60fps en vacío — importante
  // sobre todo en modo claro, donde el canvas además lleva un CSS
  // filter (invert/hue-rotate/contrast) que es caro de recomputar
  // en cada frame si no hace falta.
  let needsRender = true;
  function requestRender() { needsRender = true; }
  let cameraTween = null;

  function animateCameraTo(position) {
    cameraTween = {
      start: camera.position.clone(),
      target: position,
      startedAt: performance.now(),
      duration: 360,
    };
    requestRender();
  }

  function updateDecayPlaybackButton() {
    const button = document.getElementById('decay-play-toggle');
    if (!button) return;
    button.innerHTML = decayPlaying ? '&#10074;&#10074;' : '&#9654;';
    button.setAttribute('aria-pressed', String(decayPlaying));
    button.setAttribute('aria-label', decayPlaying ? 'Pausar animación de Decay' : 'Reproducir animación de Decay');
    button.title = decayPlaying ? 'Pausar animación' : 'Reproducir animación';
  }

  _buildMesh(inp.L, inp.W, inp.H);
  _updateDecayMethod(typeof decayMethod !== 'undefined' ? decayMethod : 'sabine', res);
  requestRender();

  // ── OrbitControls ───────────────────────────────
  if (typeof THREE.OrbitControls !== 'undefined') {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.05;
    controls.enableZoom     = true;
    controls.zoomSpeed      = 1.2;
    controls.rotateSpeed    = 1.0;
    controls.enablePan      = false;
    controls.minDistance    = 2.8;
    controls.maxPolarAngle  = Math.PI / 2 - 0.05;
    controls.autoRotate     = false; // lo manejamos manualmente
    controls.target.set(0, roomMesh.position.y, 0);
    controls.addEventListener('change', requestRender);
  }

  // ── Auto-rotación con pausa al interactuar ──────
  let userInteracting  = false;
  let interactTimer    = null;
  const AUTO_ROT_SPEED = 0.003; // radianes por frame (~0.17°)
  const RESUME_DELAY   = 2500;  // ms de inactividad antes de reanudar

  function onUserStart() {
    userInteracting = true;
    cameraTween = null;
    clearTimeout(interactTimer);
  }
  function onUserEnd() {
    clearTimeout(interactTimer);
    interactTimer = setTimeout(() => {
      userInteracting = false;
    }, RESUME_DELAY);
  }

  renderer.domElement.addEventListener('mousedown',   onUserStart, { passive: true });
  renderer.domElement.addEventListener('touchstart',  onUserStart, { passive: true });
  renderer.domElement.addEventListener('mouseup',     onUserEnd,   { passive: true });
  renderer.domElement.addEventListener('touchend',    onUserEnd,   { passive: true });
  renderer.domElement.addEventListener('wheel',       onUserStart, { passive: true });

  // ── Loop de animación ───────────────────────────
  function animate() {
    requestAnimationFrame(animate);
    if (cameraTween) {
      const progress = Math.min(1, (performance.now() - cameraTween.startedAt) / cameraTween.duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      camera.position.lerpVectors(cameraTween.start, cameraTween.target, eased);
      if (progress >= 1) cameraTween = null;
      needsRender = true;
    }
    if (controls) controls.update();
    const now = performance.now();
    if (_animateModeCloud(now) || _animateDecayRays(now)) needsRender = true;
    if (needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }
  }
  animate();

  // ── ResizeObserver ──────────────────────────────
  const ro = new ResizeObserver(() => {
    const nw = container.offsetWidth;
    const nh = container.offsetHeight;
    if (nw > 0 && nh > 0) {
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      requestRender();
    }
  });
  ro.observe(container);

  // ── Guardar estado global ───────────────────────
  _threeState = {
    scene,
    camera,
    renderer,
    controls,
    _buildMesh,
    requestRender,
    animateCameraTo,
    setMode(mode) {
      const nextMode = mode || null;
      transitionStart = 0;
      selectedMode = nextMode;
      if (modeCloud) {
        modeCloud.position.set(0, roomMesh.position.y, 0);
        modeCloud.visible = Boolean(selectedMode && modeViewActive);
      }
      if (decayRays && selectedMode) decayRays.visible = false;
      requestRender();
    },
    setDecay(method, result) {
      selectedMode = null;
      if (modeCloud) modeCloud.visible = false;
      if (decayRays) {
        decayRays.visible = decayTabActive;
        _updateDecayMethod(method, result);
      }
      requestRender();
    },
    setDecayActive(active, method, result) {
      decayTabActive = Boolean(active);
      if (decayRays) decayRays.visible = decayTabActive;
      if (decayTabActive && result) _updateDecayMethod(method, result);
      updateDecayPlaybackButton();
      requestRender();
    },
    setModeViewActive(active) {
      modeViewActive = Boolean(active);
      if (modeCloud) modeCloud.visible = Boolean(modeViewActive && selectedMode);
      requestRender();
    },
    toggleDecayPlayback() {
      decayPlaying = !decayPlaying;
      if (decayPlaying) decayAnimationStart = performance.now();
      updateDecayPlaybackButton();
      requestRender();
    },
  };
  updateDecayPlaybackButton();
}

function selectRoomMode(modeIndex) {
  if (!_threeState?.setMode) return;
  const mode = _availableModes[modeIndex];
  if (!mode) return;
  if (selectRoomMode.activeIndex === modeIndex) {
    _threeState.setMode(null);
    selectRoomMode.activeIndex = null;
    document.querySelectorAll('.mode-row-v2').forEach(row => row.classList.remove('selected'));
    const label = document.getElementById('selected-mode-label');
    if (label) label.textContent = 'Selecciona un modo para visualizarlo en 3D';
    return;
  }
  _threeState.setMode(mode);
  selectRoomMode.activeIndex = modeIndex;
  document.querySelectorAll('.mode-row-v2').forEach(row => {
    row.classList.toggle('selected', row.dataset.modeIndex === String(modeIndex));
  });
  const label = document.getElementById('selected-mode-label');
  if (label) label.textContent = `Visualizando: ${mode.label} · ${mode.f} Hz`;
}

/**
 * Actualiza las dimensiones del cubo sin recrear la escena.
 * Se llama desde los listeners de los inputs de geometría.
 */
function _updateRoomMesh(state, L, W, H) {
  state._buildMesh(L, W, H);
  state.requestRender();
}

/**
 * Expone una función pública para actualizar el cubo desde
 * los inputs de la columna izquierda (res-largo, res-ancho, res-alto).
 */
function updateThreeCubeDimensions() {
  const L = parseFloat(document.getElementById('res-largo')?.value) || 6.0;
  const W = parseFloat(document.getElementById('res-ancho')?.value) || 4.5;
  const H = parseFloat(document.getElementById('res-alto')?.value)  || 2.8;

  if (_threeState) {
    _updateRoomMesh(_threeState, L, W, H);
  }
}

// ── Decay (RT60) ─────────────────────────────────

function renderDecay(res) {
  // El selector de método (Sabine/Eyring/Fitzroy/Millington) y el
  // gráfico en sí viven en results.js (renderDecayToggle / renderRT60Chart) —
  // acá solo se delega y se arma la nota interpretativa.
  if (typeof renderDecayToggle === 'function') renderDecayToggle(res);

  const noteEl = document.getElementById('rt-note-text');
  if (noteEl) noteEl.innerHTML = interpretRT(res.RT_avg);
}

// ── Variables Iniciales ───────────────────────────

function renderVariables(res) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('p-dc',        res.dc.toFixed(2));
  set('p-vsound',    res.c.toFixed(1));
  set('p-alpha',     res.alpha_avg.toFixed(3));
  set('p-R',         res.R.toFixed(1));
  set('p-schroeder', Math.round(res.schroeder) + ' Hz');
}

// ── Modos ─────────────────────────────────────────

function renderModes(res) {
  _availableModes = res.modes || [];
  const schEl = document.getElementById('schroeder-val');
  if (schEl) schEl.textContent = Math.round(res.schroeder) + ' Hz';

  renderModesDensity(res);
  renderModesColumns(res);
}

// ── Histograma de densidad modal (barras apiladas por banda) ───

function renderModesDensity(res) {
  const container = document.getElementById('modes-density-chart');
  if (!container) return;

  const modes   = res.modes || [];
  const maxFreq = res.schroeder * 1.15;

  if (!modes.length || maxFreq <= 20) {
    container.innerHTML = '<div class="note">No se detectaron modos en el rango analizado.</div>';
    return;
  }

  // ~22 bins, ancho redondeado a un múltiplo de 5 Hz
  const binWidth = Math.max(5, Math.round((maxFreq / 22) / 5) * 5);
  const nBins    = Math.max(1, Math.ceil(maxFreq / binWidth));
  const bins     = Array.from({ length: nBins }, () => ({ axial: 0, tangencial: 0, oblicuo: 0 }));
  modes.forEach(m => {
    const bi = Math.min(Math.floor(m.f / binWidth), nBins - 1);
    bins[bi][m.type]++;
  });
  const maxCount = Math.max(1, ...bins.map(b => b.axial + b.tangencial + b.oblicuo));

  const W = container.clientWidth || 600;
  const H = window.matchMedia('(max-width: 720px)').matches ? 140 : 180;
  const PAD = { top: 10, right: 4, bottom: 24, left: 4 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const gap  = 3;
  const barW = Math.max(2, innerW / nBins - gap);

  const STACK = [
    ['oblicuo',    '#e83e8c'],
    ['tangencial', '#f59e0b'],
    ['axial',      '#2563eb'],
  ];

  const bars = bins.map((b, i) => {
    const x = PAD.left + i * (innerW / nBins);
    let yCursor = PAD.top + innerH;
    return STACK.map(([type, color]) => {
      const h = (b[type] / maxCount) * innerH;
      if (h <= 0) return '';
      yCursor -= h;
      const f0 = i * binWidth, f1 = f0 + binWidth;
      return `<rect x="${x.toFixed(1)}" y="${yCursor.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" data-tooltip="${f0}-${f1} Hz: ${b[type]} ${type}"></rect>`;
    }).join('');
  }).join('');

  const schroederX = PAD.left + Math.min(res.schroeder / maxFreq, 1) * innerW;
  const schroederEl = res.schroeder < maxFreq
    ? `<line x1="${schroederX.toFixed(1)}" y1="${PAD.top}" x2="${schroederX.toFixed(1)}" y2="${(PAD.top + innerH).toFixed(1)}"
         stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5,3"/>
       <text x="${schroederX.toFixed(1)}" y="${(PAD.top - 2).toFixed(1)}" text-anchor="middle" font-size="10"
         fill="var(--accent)" font-family="var(--font-mono)">Schroeder</text>`
    : '';

  const nLabels = 5;
  const xLabels = Array.from({ length: nLabels }, (_, i) => {
    const f = Math.round((maxFreq * i / (nLabels - 1)) / 10) * 10;
    const x = PAD.left + Math.min(f / maxFreq, 1) * innerW;
    return `<text x="${x.toFixed(1)}" y="${(H - 8).toFixed(1)}" text-anchor="middle" font-size="10"
      fill="var(--text3)" font-family="var(--font-mono)">${f}</text>`;
  }).join('');

  container.innerHTML = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">
      ${bars}
      ${schroederEl}
      ${xLabels}
    </svg>`;
}

// ── Listas de modos agrupadas por tipo ──────────────────────────

function renderModesColumns(res) {
  const wrap = document.getElementById('modes-cols');
  if (!wrap) return;

  const modes = res.modes || [];
  if (!modes.length) {
    wrap.innerHTML = '<div class="note">No se detectaron modos en el rango analizado.</div>';
    return;
  }

  const TYPES = [
    { key: 'axial',      label: 'Axial',      cls: 'col-axial' },
    { key: 'tangencial', label: 'Tangencial', cls: 'col-tangencial' },
    { key: 'oblicuo',    label: 'Oblicuo',    cls: 'col-oblicuo' },
  ];
  const MAX_PER_COL = 24;

  const tabs = document.getElementById('modes-type-tabs');
  if (tabs) {
    tabs.innerHTML = TYPES.map((type, index) =>
      `<button type="button" class="modes-type-btn${index === 0 ? ' active' : ''}" role="tab" aria-selected="${index === 0}" onclick="setModesType('${type.key}',this)">${type.label}</button>`
    ).join('');
  }

  wrap.innerHTML = TYPES.map(t => {
    const list  = modes.filter(m => m.type === t.key);
    const shown = list.slice(0, MAX_PER_COL);
    const rows  = shown.length
      ? shown.map(m => {
        const modeIndex = modes.indexOf(m);
        return `<button type="button" class="mode-row-v2" data-mode-index="${modeIndex}" onclick="selectRoomMode(${modeIndex})"><span class="freq">${m.f} Hz</span><span class="lbl">${m.label}</span></button>`;
      }).join('')
      : `<div class="note" style="font-size:10px">Sin modos en esta zona.</div>`;
    const countTxt = list.length > MAX_PER_COL
      ? `${list.length} en zona modal (primeros ${MAX_PER_COL})`
      : `${list.length} en zona modal`;

    return `<div class="${t.cls}${t.key === TYPES[0].key ? ' active' : ''}" data-mode-type="${t.key}">
      <div class="modes-col-head">
        <span class="modes-col-dot"></span>
        <span class="modes-col-title">${t.label}</span>
        <span class="modes-col-count">${countTxt}</span>
      </div>
      <div class="modes-list">${rows}</div>
    </div>`;
  }).join('');

  const freqs = modes.map(mode => mode.f);
  const hasClose = freqs.some((frequency, index) => freqs.some((other, otherIndex) => index !== otherIndex && Math.abs(frequency - other) < 3));
  if (hasClose) wrap.innerHTML += '<div class="note" style="grid-column:1/-1;margin-top:6px">Modos muy próximos: puede existir acumulación de energía.</div>';
}

function setModesType(type, button) {
  document.querySelectorAll('.modes-type-btn').forEach(tab => {
    const active = tab === button;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('#modes-cols [data-mode-type]').forEach(column => {
    column.classList.toggle('active', column.dataset.modeType === type);
  });
}

function setModesView(view, button) {
  document.querySelectorAll('.modes-view-btn').forEach(tab => {
    const active = tab === button;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.modes-view-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `modes-view-${view}`);
  });
}

// ── Región de Bolt ────────────────────────────────

function renderBolt(res) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('bolt-lh', res.boltX.toFixed(2));
  set('bolt-wh', res.boltY.toFixed(2));

  const dimsEl = document.getElementById('bolt-dims');
  if (dimsEl) {
    dimsEl.innerHTML =
      `Menor: ${res.boltSmallestLabel}<br>` +
      `Media: ${res.boltMidLabel}<br>` +
      `Mayor: ${res.boltLargestLabel}`;
  }

  const chip = document.getElementById('bolt-chip');
  const txt  = document.getElementById('bolt-text');

  if (chip) {
    chip.className   = 'chip ' + (res.inBolt ? 'chip-good' : 'chip-bad');
    chip.textContent = res.inBolt ? '✓ Dentro de la región' : '⚠ Fuera de la región';
  }

  if (txt) {
    txt.style.color = res.inBolt ? 'var(--text2)' : '#f05050';
    txt.textContent = boltAdviceText(res);
  }

  renderBoltChart(res);
}

// Mensaje de ayuda: si está fuera, indica qué proporción corregir y
// en qué dirección, usando el punto del borde del polígono más cercano.
function boltAdviceText(res) {
  if (res.inBolt) {
    return 'Las proporciones caen dentro de la región de Bolt — distribución modal favorable.';
  }
  const dx = res.nearestBoltPoint.x - res.boltX;
  const dy = res.nearestBoltPoint.y - res.boltY;
  const parts = [];
  if (Math.abs(dx) > 0.01) {
    parts.push(`${dx > 0 ? 'aumenta' : 'reduce'} ${res.boltMidLabel.toLowerCase()} respecto a ${res.boltSmallestLabel.toLowerCase()}`);
  }
  if (Math.abs(dy) > 0.01) {
    parts.push(`${dy > 0 ? 'aumenta' : 'reduce'} ${res.boltLargestLabel.toLowerCase()} respecto a ${res.boltSmallestLabel.toLowerCase()}`);
  }
  const advice = parts.length ? parts.join(' y ') : 'ajusta las proporciones';
  return `Fuera de la región (a ${res.boltMargin.toFixed(2)} del borde más cercano) — ${advice}.`;
}

// ── Gráfico de la región de Bolt (polígono real, no rectángulo) ──

function renderBoltChart(res) {
  const container = document.getElementById('bolt-chart');
  if (!container) return;

  const xs = BOLT_POLYGON.map(p => p[0]);
  const ys = BOLT_POLYGON.map(p => p[1]);
  const refXs = BOLT_REFERENCE_RATIOS.map(r => r.x);
  const refYs = BOLT_REFERENCE_RATIOS.map(r => r.y);

  const xMin = Math.min(...xs, ...refXs, res.boltX) - 0.18;
  const xMax = Math.max(...xs, ...refXs, res.boltX) + 0.18;
  const yMin = Math.min(...ys, ...refYs, res.boltY) - 0.18;
  const yMax = Math.max(...ys, ...refYs, res.boltY) + 0.18;

  const W = container.clientWidth  || 400;
  const H = container.clientHeight || 400;
  const PAD = { top: 14, right: 14, bottom: 30, left: 32 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const xPos = x => PAD.left + ((x - xMin) / (xMax - xMin)) * innerW;
  const yPos = y => PAD.top + innerH - ((y - yMin) / (yMax - yMin)) * innerH;

  // Paso de las marcas adaptado al rango (una sala muy fuera de la
  // región estira el eje mucho — con un paso fijo las marcas se
  // amontonaban).
  const stepFor = range => {
    const raw = range / 7;
    const candidates = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];
    return candidates.find(s => s >= raw) || Math.ceil(raw);
  };
  const niceTicks = (min, max, step) => {
    const ticks = [];
    const first = Math.ceil(min / step) * step;
    for (let v = first; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
  };
  const xTicks = niceTicks(xMin, xMax, stepFor(xMax - xMin));
  const yTicks = niceTicks(yMin, yMax, stepFor(yMax - yMin));

  const gridLines = [
    ...xTicks.map(t => `<line x1="${xPos(t).toFixed(1)}" y1="${PAD.top}" x2="${xPos(t).toFixed(1)}" y2="${(PAD.top + innerH).toFixed(1)}" stroke="var(--border2)" stroke-width="0.5" stroke-dasharray="2,4"/>
      <text x="${xPos(t).toFixed(1)}" y="${(PAD.top + innerH + 14).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--text3)" font-family="var(--font-mono)">${t.toFixed(1)}</text>`),
    ...yTicks.map(t => `<line x1="${PAD.left}" y1="${yPos(t).toFixed(1)}" x2="${(PAD.left + innerW).toFixed(1)}" y2="${yPos(t).toFixed(1)}" stroke="var(--border2)" stroke-width="0.5" stroke-dasharray="2,4"/>
      <text x="${(PAD.left - 5).toFixed(1)}" y="${(yPos(t) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text3)" font-family="var(--font-mono)">${t.toFixed(1)}</text>`),
  ].join('');

  const polyPoints = BOLT_POLYGON.map(([x, y]) => `${xPos(x).toFixed(1)},${yPos(y).toFixed(1)}`).join(' ');
  const boltShape = `<polygon points="${polyPoints}" fill="var(--accent-dim)" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>`;

  const refDots = BOLT_REFERENCE_RATIOS.map(r => `
    <circle cx="${xPos(r.x).toFixed(1)}" cy="${yPos(r.y).toFixed(1)}" r="3.5" fill="var(--surface)" stroke="var(--text3)" stroke-width="1.3" data-tooltip="${r.name}: ${r.x.toFixed(2)}, ${r.y.toFixed(2)}"></circle>`).join('');

  const roomColor = res.inBolt ? '#64dc82' : '#f05050';
  const rx = xPos(res.boltX), ry = yPos(res.boltY);
  const roomPoint = `
    <circle cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" r="12" fill="none" stroke="${roomColor}" stroke-width="1.5" opacity="0.45"/>
    <circle cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" r="6" fill="${roomColor}"/>
    <text x="${(rx + 12).toFixed(1)}" y="${(ry - 8).toFixed(1)}" font-size="10" fill="var(--text2)" font-family="var(--font-body)">Tu sala</text>`;

  const xAxisLabel = `<text x="${(PAD.left + innerW / 2).toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--text3)" font-family="var(--font-mono)">media / menor</text>`;
  const yAxisLabel = `<text transform="rotate(-90)" x="${-(PAD.top + innerH / 2)}" y="11" text-anchor="middle" font-size="10" fill="var(--text3)" font-family="var(--font-mono)">mayor / menor</text>`;

  container.innerHTML = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">
      ${gridLines}
      ${boltShape}
      ${refDots}
      ${roomPoint}
      ${xAxisLabel}
      ${yAxisLabel}
    </svg>`;
}

// ── Espacio ───────────────────────────────────────

function renderSpace(res, inp) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('g-vol',  res.V.toFixed(1));
  set('g-area', res.S_total.toFixed(1));
  set('g-fmp',  res.fmp.toFixed(2));

  const grid = document.getElementById('geo-surf-grid');
  if (grid) {
    grid.innerHTML = res.surfaces.map(sf => `
      <div class="geo-surf-item">
        <span class="geo-surf-lbl">${sf.name}</span>
        <span class="geo-surf-val">${sf.area.toFixed(1)} m²</span>
      </div>`).join('');
  }
}

// ── Init page ─────────────────────────────────────

function setSelectValue(select, value) {
  if (!select || typeof value !== 'string') return;
  const optionIndex = Array.from(select.options).findIndex(opt => opt.text === value);
  if (optionIndex >= 0) select.selectedIndex = optionIndex;
}

function populateMaterialSelectors(inp) {
  const ids = ['piso', 'techo', 'pared1', 'pared2', 'pared3', 'pared4'];
  if (!inp || !Array.isArray(inp.surfaces)) return;

  inp.surfaces.forEach((surface, index) => {
    const id = ids[index];
    const select = document.getElementById('res-mat-' + id);
    if (select && surface.materialName) {
      setSelectValue(select, surface.materialName);
      updateAlphaDisplay(select, 'res-alpha-' + id);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const rawInp = sessionStorage.getItem('aqvis_input');
  const rawRes = sessionStorage.getItem('aqvis_result');

  const defaultInp = {
    L: 6.0, W: 4.5, H: 2.8, T: 20,
    surfaces: [
      { name: 'Piso',    area: 27.0, alpha: [0.01,0.01,0.02,0.02,0.02,0.02], materialName: 'Cerámica' },
      { name: 'Techo',   area: 27.0, alpha: [0.02,0.02,0.03,0.04,0.04,0.03], materialName: 'Yeso liso' },
      { name: 'Pared 1', area: 16.8, alpha: [0.02,0.02,0.03,0.04,0.04,0.03], materialName: 'Yeso liso' },
      { name: 'Pared 2', area: 16.8, alpha: [0.02,0.02,0.03,0.04,0.04,0.03], materialName: 'Yeso liso' },
      { name: 'Pared 3', area: 12.6, alpha: [0.03,0.03,0.04,0.05,0.07,0.09], materialName: 'Ladrillo' },
      { name: 'Pared 4', area: 12.6, alpha: [0.03,0.03,0.04,0.05,0.07,0.09], materialName: 'Ladrillo' },
    ]
  };

  let inp, res;
  try {
    inp = rawInp ? JSON.parse(rawInp) : defaultInp;
    res = rawRes ? JSON.parse(rawRes) : calculate(inp);
    // Datos de una versión de esquema distinta (p.ej. sessionStorage de una
    // pestaña vieja tras un cambio de forma futuro) no son de confiar —
    // se descartan y se recalcula con los valores por defecto en vez de
    // asumir una forma que puede ya no ser cierta.
    if (inp?.schemaVersion && inp.schemaVersion !== AQVIS_SCHEMA_VERSION) {
      inp = defaultInp;
      res = calculate(defaultInp);
    }
  } catch(e) {
    inp = defaultInp;
    res = calculate(defaultInp);
  }

  currentResultInput = inp;

  // Rellenar panel izquierdo
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('res-largo', inp.L);
  setVal('res-ancho', inp.W);
  setVal('res-alto',  inp.H);

  const tempEl = document.getElementById('res-temp');
  if (tempEl) {
    tempEl.value = inp.T;
    syncSlider(tempEl, 'res-temp-val', '°C');
  }

  populateMaterialSelectors(inp);
  renderResults(res, inp);

  // ── Listeners: inputs de geometría actualizan cubo en tiempo real ──
  ['res-largo', 'res-ancho', 'res-alto'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateThreeCubeDimensions);
  });
});

// syncSlider() vive en app.js (carga antes que este archivo en results.html).
