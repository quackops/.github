const TAG = 'three-d-stage';

const FOV = 45;
const FIT_MARGIN = 1.35;
const VIEW_DIR = [1, 0.55, 1.25];

const MAX_PIXEL_RATIO = 2;
const SHADOW_MAP_SIZE = 2048;
const AUTOROTATE_SPEED = 1.2;
const DAMPING_FACTOR = 0.08;

const OBJECT_URL_TTL_MS = 4000;

const STYLES = `
  :host {
    position: relative;
    display: block;
    width: 100%;
    height: 100vh;
    background: var(--stage-bg, #f0eee6);
    overflow: hidden;
  }
  :host([hidden]) { display: none; }
  canvas { display: block; outline: none; touch-action: none; }
  .toolbar[hidden] { display: none; }
  .toolbar {
    position: absolute;
    right: 16px;
    bottom: 16px;
    display: flex;
    gap: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .toolbar button {
    appearance: none;
    border: 1px solid rgba(20, 20, 19, 0.18);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.92);
    color: #1a1915;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    line-height: 1;
    padding: 9px 12px;
    cursor: default;
  }
  .toolbar button:hover { background: #fff; }
  .toolbar button:active { transform: translateY(1px); }
  .toolbar button[disabled] { opacity: 0.5; pointer-events: none; }
  .error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font: 500 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #8a2f20;
    text-align: center;
    white-space: pre-line;
  }
  .error[hidden] { display: none; }
`;

const template = document.createElement('template');
template.innerHTML = `
  <div class="error" part="error" role="alert" hidden></div>
  <div class="toolbar" part="toolbar">
    <button type="button" part="button" data-format="obj" disabled>Download OBJ + MTL</button>
    <button type="button" part="button" data-format="glb" disabled>Download GLB</button>
  </div>
`;

const sheet = (() => {
  if (typeof CSSStyleSheet !== 'function' || !('replaceSync' in CSSStyleSheet.prototype)) return null;
  const s = new CSSStyleSheet();
  s.replaceSync(STYLES);
  return s;
})();

function adoptStyles(root) {
  if (sheet) {
    root.adoptedStyleSheets = [sheet];
    return;
  }
  const style = document.createElement('style');
  style.textContent = STYLES;
  root.append(style);
}

function withResolvers() {
  if (typeof Promise.withResolvers === 'function') return Promise.withResolvers();
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_TTL_MS);
}

function claimName(base, taken) {
  let name = base;
  for (let i = 2; taken.has(name); i += 1) name = `${base}_${i}`;
  taken.add(name);
  return name;
}

function nameParts(object) {
  const meshNames = new Set();
  const matNames = new Set();
  const materials = new Set();
  let meshIndex = 0;
  let matIndex = 0;

  object.traverse((node) => {
    if (!node.isMesh) return;
    node.name = claimName(node.name || `part_${meshIndex}`, meshNames);
    meshIndex += 1;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) {
      if (!material || materials.has(material)) continue;
      material.name = claimName(material.name || `mat_${matIndex}`, matNames);
      matIndex += 1;
      materials.add(material);
    }
  });

  return [...materials];
}

function buildMtl(materials) {
  const lines = ['# Exported by three-d-stage'];
  for (const material of materials) {
    const { r = 0.8, g = 0.8, b = 0.8 } = material.color ?? {};
    const roughness = typeof material.roughness === 'number' ? material.roughness : 0.5;
    const opacity = typeof material.opacity === 'number' ? material.opacity : 1;
    lines.push(
      `newmtl ${material.name}`,
      `Kd ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`,
      'Ks 0.2000 0.2000 0.2000',
      `Ns ${Math.round((1 - roughness) * 200)}`,
      `d ${opacity.toFixed(4)}`,
      ''
    );
  }
  return lines.join('\n');
}

function disposeObject(object) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) material?.dispose();
  });
}

function notifyExport(format, ok) {
  try {
    window.parent.postMessage({ type: 'omelette:notify-3d-export', format, ok: ok === true }, '*');
  } catch {}
}

export class ThreeDStage extends HTMLElement {
  static observedAttributes = ['background', 'autorotate', 'no-toolbar'];

  ready;

  #root;
  #error;
  #toolbar;
  #buttons;
  #resolveReady;
  #rejectReady;
  #listeners = new AbortController();

  #booted = false;
  #disposed = false;
  #needsRender = true;

  #THREE = null;
  #renderer = null;
  #scene = null;
  #camera = null;
  #controls = null;
  #keyLight = null;
  #ground = null;
  #object = null;
  #resizeObserver = null;
  #reducedMotion = null;
  #renderFrame = () => this.#renderIfNeeded();

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    adoptStyles(this.#root);
    this.#root.append(template.content.cloneNode(true));

    this.#error = this.#root.querySelector('.error');
    this.#toolbar = this.#root.querySelector('.toolbar');
    this.#buttons = [...this.#toolbar.querySelectorAll('button')];
    for (const button of this.#buttons) {
      button.addEventListener('click', () => this.#runExport(button.dataset.format), {
        signal: this.#listeners.signal,
      });
    }

    const { promise, resolve, reject } = withResolvers();
    this.ready = promise;
    this.#resolveReady = resolve;
    this.#rejectReady = reject;

    this.ready.catch(() => {});
  }

  get name() {
    const raw = (this.getAttribute('name') || '').replace(/[^\w.-]+/g, '_').replace(/^\.+/, '');
    return raw || 'model';
  }

  set name(value) {
    this.setAttribute('name', value);
  }

  get autorotate() {
    return this.hasAttribute('autorotate');
  }

  set autorotate(value) {
    this.toggleAttribute('autorotate', Boolean(value));
  }

  get noToolbar() {
    return this.hasAttribute('no-toolbar');
  }

  set noToolbar(value) {
    this.toggleAttribute('no-toolbar', Boolean(value));
  }

  get object() { return this.#object; }
  get scene() { return this.#scene; }
  get camera() { return this.#camera; }
  get renderer() { return this.#renderer; }
  get controls() { return this.#controls; }

  connectedCallback() {
    if (this.#disposed) return;
    if (this.#booted) {
      this.#renderer?.setAnimationLoop(this.#renderFrame);
      this.#resizeObserver?.observe(this);
      this.#invalidate();
      return;
    }
    this.#booted = true;
    this.#boot().catch((err) => this.#fail(err));
  }

  disconnectedCallback() {
    this.#renderer?.setAnimationLoop(null);
    this.#resizeObserver?.disconnect();
  }

  attributeChangedCallback(name, previous, value) {
    if (previous === value) return;
    if (name === 'background') {
      if (value == null) this.style.removeProperty('--stage-bg');
      else this.style.setProperty('--stage-bg', value);
      return;
    }
    if (name === 'no-toolbar') {
      this.#toolbar.hidden = value != null;
      return;
    }
    if (name === 'autorotate' && this.#controls) {
      this.#controls.autoRotate = this.autorotate && !this.#reducedMotion?.matches;
      this.#invalidate();
    }
  }

  async #boot() {
    const background = this.getAttribute('background');
    if (background) this.style.setProperty('--stage-bg', background);

    const [THREE, { OrbitControls }] = await Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
    ]);
    if (this.#disposed) return;
    this.#THREE = THREE;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.#renderer = renderer;
    this.#root.insertBefore(renderer.domElement, this.#error);

    const { signal } = this.#listeners;
    renderer.domElement.addEventListener('webglcontextlost', (event) => event.preventDefault(), { signal });
    renderer.domElement.addEventListener('webglcontextrestored', () => this.#invalidate(), { signal });

    const scene = new THREE.Scene();
    this.#scene = scene;

    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 500);
    camera.position.set(3, 2.2, 4);
    this.#camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = DAMPING_FACTOR;
    controls.autoRotateSpeed = AUTOROTATE_SPEED;
    this.#controls = controls;

    this.#reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    const applyAutoRotate = () => {
      controls.autoRotate = this.autorotate && !this.#reducedMotion?.matches;
      this.#invalidate();
    };
    applyAutoRotate();
    this.#reducedMotion?.addEventListener('change', applyAutoRotate, { signal });

    controls.addEventListener('start', () => { controls.autoRotate = false; });

    this.#buildStudio();

    const fit = () => {
      const width = this.clientWidth || 1;
      const height = this.clientHeight || 1;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      this.#invalidate();
    };
    fit();
    this.#resizeObserver = new ResizeObserver(fit);

    if (this.isConnected) {
      this.#resizeObserver.observe(this);
      renderer.setAnimationLoop(this.#renderFrame);
    }

    this.#resolveReady({ THREE });
  }

  #buildStudio() {
    const THREE = this.#THREE;
    const scene = this.#scene;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    key.shadow.bias = -0.0002;
    this.#keyLight = key;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xfff4e6, 0.5);
    fill.position.set(-5, 3, -4);
    scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.18 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.#ground = ground;
    scene.add(ground);
  }

  setObject(object) {
    if (!this.#THREE) throw new Error(`${TAG}: not ready — await stage.ready first`);

    if (this.#object && this.#object !== object) {
      this.#scene.remove(this.#object);
      disposeObject(this.#object);
    }
    this.#object = object;

    object.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
    });

    this.#frame(object);
    this.#scene.add(object);
    this.#setButtonsEnabled(true);
    this.#invalidate();
  }

  #frame(object) {
    const THREE = this.#THREE;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    this.#ground.position.y = box.min.y;

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const camera = this.#camera;
    const distance = (sphere.radius / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) * FIT_MARGIN;

    camera.position
      .copy(sphere.center)
      .add(new THREE.Vector3(...VIEW_DIR).normalize().multiplyScalar(distance));
    camera.near = Math.max(distance / 100, 0.01);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();

    this.#controls.target.copy(sphere.center);
    this.#controls.update();

    const span = sphere.radius * 3;
    const shadowCamera = this.#keyLight.shadow.camera;
    shadowCamera.left = -span;
    shadowCamera.right = span;
    shadowCamera.top = span;
    shadowCamera.bottom = -span;
    shadowCamera.updateProjectionMatrix();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.abort();
    this.#renderer?.setAnimationLoop(null);
    this.#resizeObserver?.disconnect();
    this.#controls?.dispose();
    if (this.#object) disposeObject(this.#object);
    if (this.#ground) disposeObject(this.#ground);
    this.#renderer?.dispose();
    this.#renderer?.domElement.remove();
    this.#renderer = null;
    this.#object = null;
    this.#setButtonsEnabled(false);
  }

  #invalidate() {
    this.#needsRender = true;
  }

  #renderIfNeeded() {
    const moved = this.#controls.update();
    if (!moved && !this.#needsRender) return;
    this.#needsRender = false;
    this.#renderer.render(this.#scene, this.#camera);
  }

  #fail(err) {
    this.#error.hidden = false;
    this.#error.textContent =
      'three.js failed to load.\n' +
      'Check that the pinned <script type="importmap"> from the usage notes is in <head> before any module script.\n\n' +
      String(err?.message ?? err);
    this.#rejectReady(err);
  }

  #setButtonsEnabled(enabled) {
    for (const button of this.#buttons) button.disabled = !enabled;
  }

  async #runExport(format) {
    if (!this.#object) return;
    try {
      await (format === 'obj' ? this.#exportObj() : this.#exportGlb());
      notifyExport(format, true);
    } catch (err) {
      notifyExport(format, false);
      throw err;
    }
  }

  async #exportObj() {
    const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js');
    const materials = nameParts(this.#object);
    const base = this.name;
    const obj = `mtllib ${base}.mtl\n${new OBJExporter().parse(this.#object)}`;
    downloadBlob(new Blob([obj], { type: 'text/plain' }), `${base}.obj`);
    downloadBlob(new Blob([buildMtl(materials)], { type: 'text/plain' }), `${base}.mtl`);
  }

  async #exportGlb() {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    nameParts(this.#object);
    const buffer = await new GLTFExporter().parseAsync(this.#object, { binary: true });
    downloadBlob(new Blob([buffer], { type: 'model/gltf-binary' }), `${this.name}.glb`);
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, ThreeDStage);
