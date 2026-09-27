'use strict';

let _simThreeState = null;

function initSimulatorThree(L, W, H) {
  const container = document.getElementById('three-container');
  if (!container || typeof THREE === 'undefined') return;
  if (_simThreeState) {
    _updateSimulatorRoomMesh(_simThreeState, L, W, H);
    return;
  }

  container.innerHTML = '';
  const width = container.offsetWidth || 400;
  const height = container.offsetHeight || 260;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);
  scene.fog = new THREE.FogExp2(0x0a0a0a, 0.006);

  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000);
  camera.position.set(6, 5, 8);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

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

  let roomMesh = null;
  let wireframe = null;
  let controls = null;

  function buildMesh(L, W, H) {
    if (roomMesh) scene.remove(roomMesh);
    if (wireframe) scene.remove(wireframe);

    const maxDim = Math.max(L, W, H);
    const scale = 2.2 / Math.max(maxDim, 0.1);
    const bw = L * scale;
    const bh = H * scale;
    const bd = W * scale;

    const geometry = new THREE.BoxGeometry(bw, bh, bd);
    const faceMat = new THREE.MeshBasicMaterial({
      color: 0x00c2cb,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    roomMesh = new THREE.Mesh(geometry, faceMat);
    roomMesh.position.y = bh / 2 + 0.04;
    scene.add(roomMesh);

    const edgesGeo = new THREE.EdgesGeometry(geometry);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1 });
    wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
    wireframe.position.y = bh / 2 + 0.04;
    scene.add(wireframe);

    if (controls) {
      controls.target.set(0, roomMesh.position.y, 0);
      controls.update();
    }
  }

  // Render on demand: solo repintar cuando algo cambió (cámara, malla,
  // resize) en vez de forzar 60fps constantes.
  let needsRender = true;
  function requestRender() { needsRender = true; }

  buildMesh(L, W, H);
  requestRender();

  if (typeof THREE.OrbitControls !== 'undefined') {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.zoomSpeed = 1.2;
    controls.rotateSpeed = 1.0;
    controls.enablePan = false;
    controls.minDistance = 2.8;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.autoRotate = false;
    controls.target.set(0, roomMesh.position.y, 0);
    controls.addEventListener('change', requestRender);
  }

  let userInteracting = false;
  let interactTimer = null;
  const AUTO_ROT_SPEED = 0.003;
  const RESUME_DELAY = 2500;

  function onUserStart() {
    userInteracting = true;
    clearTimeout(interactTimer);
  }

  function onUserEnd() {
    clearTimeout(interactTimer);
    interactTimer = setTimeout(() => {
      userInteracting = false;
    }, RESUME_DELAY);
  }

  renderer.domElement.addEventListener('mousedown', onUserStart, { passive: true });
  renderer.domElement.addEventListener('touchstart', onUserStart, { passive: true });
  renderer.domElement.addEventListener('mouseup', onUserEnd, { passive: true });
  renderer.domElement.addEventListener('touchend', onUserEnd, { passive: true });
  renderer.domElement.addEventListener('wheel', onUserStart, { passive: true });

  function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }
  }

  animate();

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

  _simThreeState = { scene, camera, renderer, controls, buildMesh, requestRender };
}

function _updateSimulatorRoomMesh(state, L, W, H) {
  state.buildMesh(L, W, H);
  state.requestRender();
}

function updateSimulatorCubeDimensions() {
  const L = parseFloat(document.getElementById('w-largo')?.value) || 6.0;
  const W = parseFloat(document.getElementById('w-ancho')?.value) || 4.5;
  const H = parseFloat(document.getElementById('w-alto')?.value) || 2.8;

  const label = document.getElementById('sim-iso-dim-lbl');
  if (label) label.textContent = `${L} × ${W} × ${H} m`;

  if (_simThreeState) {
    _updateSimulatorRoomMesh(_simThreeState, L, W, H);
  } else {
    initSimulatorThree(L, W, H);
  }
}

function initSimulatorCube() {
  updateSimulatorCubeDimensions();
}

document.addEventListener('DOMContentLoaded', () => {
  initSimulatorCube();
  ['w-largo', 'w-ancho', 'w-alto'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateSimulatorCubeDimensions);
  });
});
