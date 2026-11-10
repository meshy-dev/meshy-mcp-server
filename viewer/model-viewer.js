// The 3D viewer meshy_view_model shows inside hosts that render MCP Apps.
// The tool result names a model the server holds; the page reads it back in
// base64 resource chunks (meshy-model://{id}/{chunk}) and renders it with three.js.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createBridge } from "./bridge.js";

const $ = (id) => document.getElementById(id);
const bridge = createBridge({ name: "meshy-model-viewer", version: "1.0.0" });

let view;
let disposed = false;

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
  view?.setBackground();
}

function showMessage(text, progress) {
  $("overlay").hidden = false;
  $("message").textContent = text;
  $("progress").hidden = progress === undefined;
  if (progress !== undefined) $("progress").firstElementChild.style.width = `${Math.round(progress * 100)}%`;
}

function formatBytes(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function base64ToBytes(base64) {
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(base64);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readModel(model) {
  const bytes = new Uint8Array(model.bytes);
  let offset = 0;
  for (let chunk = 0; chunk < model.chunks; chunk++) {
    if (disposed) throw new Error("The viewer was closed.");
    const result = await bridge.readResource(`meshy-model://${model.id}/${chunk}`);
    const content = result?.contents?.[0];
    if (!content?.blob) throw new Error("The server sent no model data.");
    const part = base64ToBytes(content.blob);
    bytes.set(part, offset);
    offset += part.length;
    showMessage(`Loading ${formatBytes(model.bytes)}…`, offset / model.bytes);
  }
  if (offset !== model.bytes) throw new Error(`Received ${offset} of ${model.bytes} bytes.`);
  return bytes;
}

// Embedded GLB images are decoded straight from their bytes. three.js would
// otherwise hand them to the browser as blob: URLs, which the default app
// sandbox policy (Cursor's included) does not allow.
// This replaces a GLTFParser method, so it checks that the method and its cache
// still exist and leaves three.js alone otherwise (three is pinned in package.json).
function decodeImagesWithoutUrls(parser) {
  if (
    typeof createImageBitmap !== "function" ||
    typeof parser.loadImageSource !== "function" ||
    typeof parser.sourceCache !== "object" ||
    typeof parser.getDependency !== "function"
  ) {
    return { name: "meshy_images" };
  }
  const loadImageSource = parser.loadImageSource.bind(parser);
  parser.loadImageSource = (sourceIndex, loader) => {
    const source = parser.json.images[sourceIndex];
    if (source.bufferView === undefined || !/^image\/(png|jpeg|webp)$/.test(source.mimeType || "")) {
      return loadImageSource(sourceIndex, loader);
    }
    if (parser.sourceCache[sourceIndex] !== undefined) {
      return parser.sourceCache[sourceIndex].then((texture) => texture.clone());
    }
    const promise = parser
      .getDependency("bufferView", source.bufferView)
      .then((data) =>
        createImageBitmap(new Blob([data], { type: source.mimeType }), {
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        }),
      )
      .then((bitmap) => {
        const texture = new THREE.Texture(bitmap);
        texture.needsUpdate = true;
        texture.userData.mimeType = source.mimeType;
        return texture;
      });
    parser.sourceCache[sourceIndex] = promise;
    return promise;
  };
  return { name: "meshy_images" };
}

function createView() {
  const stage = $("stage");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const environment = new THREE.PMREMGenerator(renderer);
  scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture;
  environment.dispose();
  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(3, 5, 4);
  scene.add(light);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;

  const timer = new THREE.Timer();
  const startDirection = new THREE.Vector3(1.3, 0.8, 1.9).normalize();
  let mixer;
  let radius = 0;
  let userMoved = false;

  // Fit the model's bounding sphere inside the narrower field of view, so a tall
  // character in a narrow chat panel keeps its head and feet in frame. A frame can
  // start at zero width, so this runs again whenever the stage is resized.
  const fit = (direction) => {
    if (!radius) return;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.05;
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    camera.position.copy(direction).multiplyScalar(distance);
    controls.update();
  };
  const currentDirection = () => {
    const direction = camera.position.clone().sub(controls.target);
    return direction.lengthSq() > 0 && Number.isFinite(direction.lengthSq()) ? direction.normalize() : startDirection;
  };

  const setRotate = (on) => {
    controls.autoRotate = on;
    $("rotate").setAttribute("aria-pressed", String(on));
  };
  renderer.domElement.addEventListener("pointerdown", () => {
    userMoved = true;
    setRotate(false);
  });
  renderer.domElement.addEventListener("wheel", () => (userMoved = true), { passive: true });
  $("rotate").addEventListener("click", () => setRotate(!controls.autoRotate));
  $("reset").addEventListener("click", () => {
    userMoved = false;
    fit(startDirection);
  });

  const resize = () => {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!userMoved) fit(currentDirection());
  };
  resize();
  new ResizeObserver(resize).observe(stage);

  // Render only while the viewer is on screen: a long conversation can hold many
  // viewers, and browsers cap how many WebGL contexts stay alive at once.
  const loop = (time) => {
    timer.update(time);
    mixer?.update(timer.getDelta());
    controls.update();
    renderer.render(scene, camera);
  };
  let visible = true;
  let lost = false;
  const run = () => renderer.setAnimationLoop(visible && !lost && !disposed ? loop : null);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    run();
  }).observe(stage);
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    lost = true;
    run();
    showMessage("The browser paused this 3D view to free graphics memory. Scroll it out of view and back to resume.");
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    lost = false;
    $("overlay").hidden = true;
    run();
  });
  run();

  return {
    setBackground() {
      scene.background = new THREE.Color(getComputedStyle(stage).backgroundColor);
    },
    show(gltf) {
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      root.position.sub(center);
      scene.add(root);
      radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
      fit(startDirection);
      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(root);
        mixer.clipAction(gltf.animations[0]).play();
      }
      let triangles = 0;
      root.traverse((object) => {
        if (!object.isMesh) return;
        const geometry = object.geometry;
        triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
      });
      // Rigged characters carry a near-empty bind-pose clip; only real motion is worth a label.
      return { triangles: Math.round(triangles), animated: (gltf.animations[0]?.duration ?? 0) > 0.1 };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      renderer.dispose();
    },
  };
}

async function show(result) {
  const init = await connected.catch(() => undefined);
  if (result.isError) {
    showMessage(result.content?.find((c) => c.type === "text")?.text || "The model could not be opened.");
    return;
  }
  const model = result.structuredContent?.model;
  if (!model?.id) {
    showMessage("The tool result named no model to show.");
    return;
  }
  $("name").textContent = model.name;
  $("stats").textContent = formatBytes(model.bytes);
  if (init?.hostCapabilities && !init.hostCapabilities.serverResources) {
    showMessage("This app can't pass the model to the viewer (it doesn't let views read server resources).");
    return;
  }
  try {
    view ??= createView();
    view.setBackground();
  } catch (error) {
    showMessage("This viewer needs WebGL, which is not available here.");
    bridge.log("error", `WebGL: ${error?.message || error}`);
    return;
  }
  try {
    showMessage(`Loading ${formatBytes(model.bytes)}…`, 0);
    const bytes = await readModel(model);
    if (disposed) return;
    showMessage("Preparing the model…");
    const loader = new GLTFLoader();
    loader.register(decodeImagesWithoutUrls);
    const gltf = await loader.parseAsync(bytes.buffer, "");
    if (disposed) return;
    const info = view.show(gltf);
    $("stats").textContent = [
      `${info.triangles.toLocaleString()} triangles`,
      formatBytes(model.bytes),
      info.animated ? "animated" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    $("overlay").hidden = true;
    $("tools").hidden = false;
  } catch (error) {
    showMessage(`The model could not be shown: ${error?.message || error}`);
    bridge.log("error", `meshy viewer: ${error?.message || error}`);
  }
}

let started = false;
bridge.on("ui/notifications/tool-result", (result) => {
  if (started) return;
  started = true;
  show(result);
});
bridge.on("ui/notifications/host-context-changed", (context) => {
  if (context.theme) setTheme(context.theme);
});
bridge.on("ui/notifications/tool-cancelled", () => {
  if (!started) showMessage("The tool call was cancelled.");
});
bridge.on("ui/resource-teardown", () => {
  disposed = true;
  view?.dispose();
  return {};
});
bridge.on("ping", () => ({}));

setTheme(window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const connected = bridge.connect();
connected
  .then((init) => {
    if (init?.hostContext?.theme) setTheme(init.hostContext.theme);
    bridge.reportSize();
  })
  .catch((error) => showMessage(`Could not reach the host: ${error?.message || error}`));
