/* ============================================================
 * 回忆之树（Beta）
 * - 场景：写实大树 + 铺到远方的像素草地 + 远处像素小树 + 程序化像素山川河流
 * - 交互：只有 360° 水平转盘旋转（根部固定画面中心），无缩放、无俯仰
 * - 果实：相册里的照片 / 视频，只挂最外层枝梢，静态首帧贴图，点击开灯箱
 * - 杨絮：柔和绒毛，无拖尾，极慢飘落
 *
 * 这是「源码」，浏览器实际加载的是同目录的 tree.bundle.js。
 * 改完本文件后，在项目根目录执行：
 *   npx esbuild assets/tree/tree.js --bundle --format=iife --global-name=MemoryTree --minify
 *     --alias:three=./assets/vendor/three.module.js
 *     --outfile=assets/tree/tree.bundle.js
 * ============================================================ */
import * as THREE from "three";

const MAX_PER_ALBUM = 10;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const isVideoUrl = (url = "") => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);

export function initTree() {
  const section = document.querySelector("#treeShowcase");
  const canvas = document.querySelector("#treeCanvas");
  const fluffCanvas = document.querySelector("#glowCanvas");
  const resetBtn = document.querySelector("#treeReset");
  const statusEl = document.querySelector("#treeStatus");
  if (!section || !canvas || !fluffCanvas) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const theme = () => (document.documentElement.dataset.theme === "night" ? "night" : "day");

  /* ---------------- 渲染器 ---------------- */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (error) {
    if (statusEl) statusEl.textContent = "当前浏览器不支持 WebGL，无法显示 3D 树。";
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 800);
  camera.position.set(0, 5.2, 21);
  camera.lookAt(0, 6.4, 0);

  const palettes = {
    day: { fog: 0xe8f3df, hemiSky: 0xf3fbee, hemiGround: 0x7ea062, sun: 0xfff6e2, ambient: 0.6, sunI: 1.2, fluff: [255, 255, 255] },
    night: { fog: 0x101c13, hemiSky: 0x2a3d5c, hemiGround: 0x16241a, sun: 0xbfd4ff, ambient: 0.34, sunI: 0.7, fluff: [210, 226, 255] }
  };

  scene.fog = new THREE.Fog(palettes[theme()].fog, 130, 440);

  /* ---------------- 灯光 ---------------- */
  const hemi = new THREE.HemisphereLight(palettes[theme()].hemiSky, palettes[theme()].hemiGround, 0.95);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, palettes[theme()].ambient);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(palettes[theme()].sun, palettes[theme()].sunI);
  sun.position.set(40, 70, 30);
  scene.add(sun);

  /* ---------------- 背景：山川河流 ---------------- */
  const backdrop = buildBackdrop(theme());
  scene.add(backdrop.mesh);

  /* ---------------- 地面：草地 ---------------- */
  const grassTexture = makeGrassTexture();
  grassTexture.anisotropy = 4;
  const groundMaterial = new THREE.MeshLambertMaterial({ map: grassTexture, color: 0xffffff });
  const groundGeometry = new THREE.PlaneGeometry(700, 700);
  groundGeometry.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  scene.add(ground);
  scene.add(makeGroundFade());

  /* ---------------- 远处像素小树 ---------------- */
  addDistantTrees(scene);

  /* ---------------- 转盘：树 + 脚下一圈草 ---------------- */
  const turntable = new THREE.Group();
  scene.add(turntable);

  const tree = buildRealisticTree();
  const barkMaterial = makeBarkMaterial();
  turntable.add(new THREE.Mesh(tree.geometry, barkMaterial));

  const blobShadow = makeBlobShadow();
  blobShadow.position.y = 0.02;
  turntable.add(blobShadow);

  addGrassTufts(turntable, 80, 7, 0.5);
  addGrassTufts(scene, 150, 55, 1.1);

  /* ---------------- 果实 ---------------- */
  const playTexture = makePlayTexture();
  const playGeo = new THREE.PlaneGeometry(0.24, 0.24);
  const playMaterial = new THREE.MeshBasicMaterial({ map: playTexture, transparent: true, depthTest: false });
  playGeo.userData.shared = true;
  playMaterial.userData.shared = true;
  let fruits = [];
  let fruitMeshes = [];

  function rebuildFruits() {
    for (const fruit of fruits) {
      turntable.remove(fruit.mesh);
      disposeObject(fruit.mesh);
      if (fruit.stem) { turntable.remove(fruit.stem); disposeObject(fruit.stem); }
    }
    fruits = [];
    fruitMeshes = [];

    const albums = Array.isArray(window.__albums) ? window.__albums : [];
    const tips = tree.tips;
    if (!albums.length || !tips.length) {
      if (statusEl) { statusEl.hidden = false; statusEl.textContent = "还没有果实，上传照片或视频后就会长出来。"; }
      return;
    }
    if (statusEl) { statusEl.hidden = true; statusEl.textContent = ""; }

    const sorted = tips.slice().sort((a, b) => Math.atan2(a.position.z, a.position.x) - Math.atan2(b.position.z, b.position.x));
    const wanted = albums.length * MAX_PER_ALBUM;
    const stride = Math.max(1, Math.floor(sorted.length / wanted));
    let cursor = 0;

    albums.forEach((album, a) => {
      const media = (album.photos || []).slice(0, MAX_PER_ALBUM);
      media.forEach((photo, k) => {
        const tip = sorted[cursor % sorted.length];
        cursor += stride;
        if (!tip) return;
        const isVideo = isVideoUrl(photo.url);
        const size = 0.46 + Math.random() * 0.12;
        const out = new THREE.Vector3(tip.dir.x, 0, tip.dir.z);
        if (out.lengthSq() < 0.001) out.set(1, 0, 0);
        out.normalize();
        const position = tip.position.clone().addScaledVector(out, size * 0.9).add(new THREE.Vector3(0, -size * 0.5, 0));

        const color = albumColor(album, a);
        const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
        mesh.position.copy(position);
        mesh.userData = { albumIndex: a, photoIndex: k, album, photo, isVideo, ready: false };
        if (isVideo) {
          const badge = new THREE.Mesh(playGeo, playMaterial);
          badge.position.z = 0.02;
          badge.userData = { shared: true };
          mesh.add(badge);
        }
        const stem = makeStem(tip.position, position, color);
        turntable.add(stem);
        turntable.add(mesh);
        fruits.push({ mesh, stem, albumIndex: a, photoIndex: k });
        fruitMeshes.push(mesh);
        loadFruitTexture(mesh, photo, isVideo);
      });
    });
  }

  window.addEventListener("albums:updated", rebuildFruits);

  /* ---------------- 杨絮 ---------------- */
  const fluffCtx = fluffCanvas.getContext("2d");
  const fluffSprite = makeFluffSprite();
  let fluffW = 0;
  let fluffH = 0;
  const fluff = [];
  const MAX_FLUFF = 140;
  const projected = new THREE.Vector3();

  function resizeFluff() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fluffW = section.clientWidth;
    fluffH = section.clientHeight;
    fluffCanvas.width = Math.max(1, Math.round(fluffW * dpr));
    fluffCanvas.height = Math.max(1, Math.round(fluffH * dpr));
    fluffCanvas.style.width = `${fluffW}px`;
    fluffCanvas.style.height = `${fluffH}px`;
    fluffCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function stepFluff(dt) {
    fluffCtx.clearRect(0, 0, fluffW, fluffH);
    if (reduceMotion || !fluffW) return;
    const rgb = palettes[theme()].fluff;

    if (fluff.length < MAX_FLUFF && tree.emitPoints.length) {
      const spawn = Math.random() < 0.5 ? 1 : 0;
      for (let s = 0; s < spawn; s += 1) {
        const p = tree.emitPoints[(Math.random() * tree.emitPoints.length) | 0];
        const world = p.clone().applyAxisAngle(Y_AXIS, turntable.rotation.y);
        projected.copy(world).project(camera);
        if (projected.z > 1) continue;
        const x = (projected.x * 0.5 + 0.5) * fluffW;
        const y = (-projected.y * 0.5 + 0.5) * fluffH;
        if (x < -20 || x > fluffW + 20 || y < -20 || y > fluffH + 20) continue;
        fluff.push({
          x, y,
          fall: 5 + Math.random() * 9,
          swayAmp: 7 + Math.random() * 13,
          swaySpeed: 0.25 + Math.random() * 0.35,
          phase: Math.random() * Math.PI * 2,
          age: 0,
          life: 14 + Math.random() * 10,
          size: (9 + Math.random() * 11) * (1 - Math.min(0.4, projected.z))
        });
      }
    }

    for (let i = fluff.length - 1; i >= 0; i -= 1) {
      const f = fluff[i];
      f.age += dt;
      f.y += f.fall * dt;
      f.x += Math.sin(f.age * f.swaySpeed + f.phase) * f.swayAmp * dt;
      if (f.y > fluffH + 24 || f.age > f.life) { fluff.splice(i, 1); continue; }
      const fade = Math.min(1, f.age / 2) * Math.min(1, (f.life - f.age) / 3);
      fluffCtx.globalAlpha = Math.max(0, fade) * 0.85;
      fluffCtx.drawImage(fluffSprite, f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
    }
    fluffCtx.globalAlpha = 1;
  }

  /* ---------------- 交互：转盘旋转 / 点击 ---------------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const parentQuatInv = new THREE.Quaternion();

  let dragging = false;
  let lastX = 0;
  let down = null;

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    down = { x: event.clientX, y: event.clientY, time: performance.now() };
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    turntable.rotation.y += dx * 0.006;
  });
  canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    canvas.releasePointerCapture?.(event.pointerId);
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    const elapsed = performance.now() - down.time;
    down = null;
    if (moved > 6 || elapsed > 700) return;
    const hit = pickFruit(event.clientX, event.clientY);
    if (hit && typeof window.__treeOpenPhoto === "function") {
      window.__treeOpenPhoto(hit.albumIndex, hit.photoIndex);
    }
  });
  canvas.addEventListener("pointercancel", () => { dragging = false; down = null; });

  let hoverFrame = 0;
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || dragging) return;
    const { clientX, clientY } = event;
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      canvas.classList.toggle("is-hovering", Boolean(pickFruit(clientX, clientY)));
    });
  });

  function pickFruit(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !fruitMeshes.length) return null;
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(fruitMeshes, false);
    return hits.length ? hits[0].object.userData : null;
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => { turntable.rotation.y = 0; });
  }

  /* ---------------- 尺寸 / 可见性 / 主题 ---------------- */
  function resize() {
    const width = section.clientWidth;
    const height = section.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    resizeFluff();
  }

  const clock = new THREE.Clock();
  let rafId = 0;
  let visible = true;

  function loop() {
    if (!visible) { rafId = 0; return; }
    rafId = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    parentQuatInv.copy(turntable.quaternion).invert();
    for (const mesh of fruitMeshes) mesh.quaternion.copy(parentQuatInv).multiply(camera.quaternion);
    renderer.render(scene, camera);
    stepFluff(dt);
  }
  function startLoop() { if (!rafId) { clock.getDelta(); rafId = requestAnimationFrame(loop); } }
  function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) startLoop(); else stopLoop();
    }, { threshold: 0.02 });
    observer.observe(section);
  }

  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(section);
  window.addEventListener("resize", resize, { passive: true });

  if ("MutationObserver" in window) {
    new MutationObserver(() => applyTheme(theme())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function applyTheme(next) {
    const p = palettes[next];
    scene.fog.color.setHex(p.fog);
    hemi.color.setHex(p.hemiSky);
    hemi.groundColor.setHex(p.hemiGround);
    ambient.intensity = p.ambient;
    sun.color.setHex(p.sun);
    sun.intensity = p.sunI;
    barkMaterial.color.set(next === "night" ? 0x5f5040 : 0x7c5a3b);
    barkMaterial.emissive.set(next === "night" ? 0x14251c : 0x112a1c);
    backdrop.update(next);
  }

  /* ---------------- 启动 ---------------- */
  if (statusEl) statusEl.textContent = "正在生长回忆之树…";
  resize();
  rebuildFruits();
  startLoop();

  return { rebuildFruits, resize };
}

/* ============================================================
 * 背景山川河流
 * ============================================================ */
function buildBackdrop(themeName) {
  const texture = makeBackdropTexture(themeName);
  const geometry = new THREE.CylinderGeometry(240, 240, 340, 72, 1, true);
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 34;
  return {
    mesh,
    update(next) {
      material.map.dispose();
      material.map = makeBackdropTexture(next);
      material.needsUpdate = true;
    }
  };
}

function makeBackdropTexture(themeName) {
  const night = themeName === "night";
  const w = 1024;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  if (night) {
    sky.addColorStop(0, "#0c1811");
    sky.addColorStop(0.45, "#152a1c");
    sky.addColorStop(0.6, "#1d3a24");
    sky.addColorStop(1, "#16281a");
  } else {
    sky.addColorStop(0, "#ffffff");
    sky.addColorStop(0.45, "#eef7e6");
    sky.addColorStop(0.6, "#a9d488");
    sky.addColorStop(1, "#7ba05b");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/* ============================================================
 * 地面 / 草
 * ============================================================ */
function makeGrassTexture() {
  const s = 16;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < s; i += 1) {
    for (let j = 0; j < s; j += 1) {
      const r = 96 + Math.floor(Math.random() * 26);
      const g = 165 + Math.floor(Math.random() * 45);
      const b = 78 + Math.floor(Math.random() * 26);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(i, j, 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(180, 180);
  return texture;
}

function makeGroundFade() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.55, "rgba(247,251,242,0.5)");
  grad.addColorStop(1, "rgba(247,251,242,1)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(340, 340);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.02;
  return mesh;
}

function makeTuftTexture() {
  const w = 32;
  const h = 32;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  for (let b = 0; b < 8; b += 1) {
    const bx = 3 + Math.random() * 26;
    const bh = 10 + Math.random() * 18;
    const r = 108 + Math.floor(Math.random() * 40);
    const g = 178 + Math.floor(Math.random() * 52);
    const b = 88 + Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    for (let y = 0; y < bh; y += 2) {
      const drift = (y / bh) * (Math.random() * 4 - 2);
      ctx.fillRect(Math.round(bx + drift), h - y - 2, 2, 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function addGrassTufts(parent, count, radius, scale) {
  const geometry = makeTuftGeometry();
  const material = new THREE.MeshLambertMaterial({ map: makeTuftTexture(), transparent: true, alphaTest: 0.45, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    pos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    quat.setFromAxisAngle(Y_AXIS, Math.random() * Math.PI);
    const s = (0.6 + Math.random() * 0.8) * scale;
    scl.set(s, s * (0.8 + Math.random() * 0.6), s);
    matrix.compose(pos, quat, scl);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
}

function makeTuftGeometry() {
  const a = new THREE.PlaneGeometry(1, 1);
  a.translate(0, 0.5, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  return mergeGeometries([a, b]);
}

function makeBlobShadow() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(20,30,18,0.42)");
  grad.addColorStop(1, "rgba(20,30,18,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const geometry = new THREE.PlaneGeometry(11, 11);
  geometry.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geometry, material);
}

function addDistantTrees(scene) {
  const count = 64;
  const trunkGeometry = new THREE.BoxGeometry(0.7, 2.6, 0.7);
  trunkGeometry.translate(0, 1.3, 0);
  const leafGeometry = new THREE.BoxGeometry(2.6, 2.6, 2.6);
  leafGeometry.translate(0, 3.4, 0);
  const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x5b4128 });
  const leafMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
  const leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, count);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = 46 + Math.random() * 150;
    const s = 0.8 + Math.random() * 2.2;
    matrix.makeScale(s, s, s);
    matrix.setPosition(Math.cos(a) * r, 0, Math.sin(a) * r);
    trunks.setMatrixAt(i, matrix);
    leaves.setMatrixAt(i, matrix);
    color.setHSL(0.27, 0.42, 0.28 + Math.random() * 0.14);
    leaves.setColorAt(i, color);
  }
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  scene.add(trunks);
  scene.add(leaves);
}

/* ============================================================
 * 树
 * ============================================================ */
function buildRealisticTree() {
  const geometries = [];
  const tips = [];
  const emitPoints = [];

  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.18, 2.4, 0.12),
    new THREE.Vector3(-0.12, 5.0, -0.1),
    new THREE.Vector3(0.1, 7.2, 0.12)
  ]);
  geometries.push(taperedTubeGeometry(trunkCurve, 0.78, 0.4, 34, 12));
  sampleEmit(trunkCurve, 22, emitPoints);

  const mains = 9;
  for (let i = 0; i < mains; i += 1) {
    const t = 0.42 + (i / (mains - 1)) * 0.52;
    const base = trunkCurve.getPointAt(Math.min(0.97, t));
    const angle = (i / mains) * Math.PI * 2 + Math.random() * 0.5;
    const dir = new THREE.Vector3(Math.cos(angle), 0.7 + Math.random() * 0.45, Math.sin(angle)).normalize();
    growBranch(base, dir, 3.6 + Math.random() * 1.2, 0.34, 3, geometries, tips, emitPoints);
  }
  growBranch(trunkCurve.getPointAt(1), new THREE.Vector3(0.1, 1, 0.1).normalize(), 3.4, 0.36, 3, geometries, tips, emitPoints);

  return { geometry: mergeGeometries(geometries), tips, emitPoints };
}

function growBranch(start, dir, length, radius, depth, geometries, tips, emitPoints) {
  const end = start.clone().addScaledVector(dir, length);
  const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, length * 0.16, 0));
  const curve = new THREE.CatmullRomCurve3([start, mid, end]);
  geometries.push(taperedTubeGeometry(curve, radius, radius * 0.6, depth >= 3 ? 14 : 9, depth >= 3 ? 8 : 6));
  sampleEmit(curve, depth >= 3 ? 7 : 4, emitPoints);

  if (depth <= 0) {
    tips.push({ position: end, dir: dir.clone(), radius });
    return;
  }
  const children = depth >= 3 ? 3 : 2;
  for (let i = 0; i < children; i += 1) {
    const spread = 0.45 + Math.random() * 0.45;
    const axis = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.3, Math.random() - 0.5));
    if (axis.lengthSq() < 0.01) axis.set(1, 0, 0);
    axis.normalize();
    const newDir = dir.clone().applyAxisAngle(axis, spread);
    newDir.y += 0.22;
    newDir.normalize();
    growBranch(end, newDir, length * 0.68, radius * 0.62, depth - 1, geometries, tips, emitPoints);
  }
}

function makeBarkMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x7c5a3b,
    roughness: 0.9,
    metalness: 0.03,
    emissive: 0x112a1c,
    emissiveIntensity: 0.35
  });
}

function taperedTubeGeometry(curve, radiusStart, radiusEnd, segments = 24, radial = 8) {
  const frames = curve.computeFrenetFrames(segments, false);
  const points = [];
  for (let i = 0; i <= segments; i += 1) points.push(curve.getPointAt(i / segments));
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const radius = radiusStart + (radiusEnd - radiusStart) * t;
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const P = points[i];
    for (let j = 0; j <= radial; j += 1) {
      const v = (j / radial) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      const nx = cos * N.x + sin * B.x;
      const ny = cos * N.y + sin * B.y;
      const nz = cos * N.z + sin * B.z;
      normals.push(nx, ny, nz);
      positions.push(P.x + radius * nx, P.y + radius * ny, P.z + radius * nz);
      uvs.push(j / radial, i / segments);
    }
  }
  for (let i = 1; i <= segments; i += 1) {
    for (let j = 1; j <= radial; j += 1) {
      const a = (radial + 1) * (i - 1) + (j - 1);
      const b = (radial + 1) * i + (j - 1);
      const c = (radial + 1) * i + j;
      const d = (radial + 1) * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

function mergeGeometries(geometries) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geometries) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index.count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  let vOffset = 0;
  let iOffset = 0;
  for (const g of geometries) {
    positions.set(g.attributes.position.array, vOffset * 3);
    normals.set(g.attributes.normal.array, vOffset * 3);
    uvs.set(g.attributes.uv.array, vOffset * 2);
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 1) indices[iOffset + i] = idx[i] + vOffset;
    vOffset += g.attributes.position.count;
    iOffset += idx.length;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

function sampleEmit(curve, count, out) {
  for (let i = 0; i < count; i += 1) {
    const point = curve.getPointAt((i + 0.5) / count);
    out.push(point.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3)));
  }
}

function makeStem(from, to, color) {
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 });
  return new THREE.Line(geometry, material);
}

function albumColor(album, index) {
  const text = `${album.owner || ""}${album.title || ""}`;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  const hue = (hash / 360 + index * 0.07) % 1;
  return new THREE.Color().setHSL(hue, 0.5, 0.56);
}

function makePlayTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(12,18,15,0.62)";
  ctx.beginPath();
  ctx.arc(64, 64, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(52, 42);
  ctx.lineTo(92, 64);
  ctx.lineTo(52, 86);
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeFluffSprite() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.98)");
  grad.addColorStop(0.4, "rgba(248,252,242,0.72)");
  grad.addColorStop(0.72, "rgba(206,220,196,0.4)");
  grad.addColorStop(1, "rgba(196,212,186,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/* ---------------- 贴图加载 ---------------- */
const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");
const videoQueue = [];
let activeVideoLoads = 0;
const MAX_VIDEO_LOADS = 4;

function enqueueVideo(task) {
  videoQueue.push(task);
  pumpVideoQueue();
}
function pumpVideoQueue() {
  while (activeVideoLoads < MAX_VIDEO_LOADS && videoQueue.length) {
    const task = videoQueue.shift();
    activeVideoLoads += 1;
    task(() => { activeVideoLoads -= 1; pumpVideoQueue(); });
  }
}

function needsCrossOrigin(url) {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function loadFruitTexture(mesh, photo, isVideo) {
  const material = mesh.material;
  const apply = (texture) => {
    if (!texture) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
    mesh.userData.ready = true;
  };

  if (!isVideo) {
    textureLoader.load(photo.url, apply, undefined, () => {});
    return;
  }

  enqueueVideo((release) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    if (needsCrossOrigin(photo.url)) video.crossOrigin = "anonymous";
    video.src = photo.url;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const texture = captureVideoFrame(video);
      if (texture) apply(texture);
      video.pause();
      video.removeAttribute("src");
      try { video.load(); } catch (_) {}
      release();
    };
    video.addEventListener("loadeddata", () => {
      try { video.currentTime = 0.1; } catch (_) {}
      setTimeout(finish, 450);
    });
    video.addEventListener("seeked", finish);
    video.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      release();
    });
  });
}

function captureVideoFrame(video) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const max = 512;
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.getImageData(0, 0, 1, 1);
  } catch (_) {
    return null;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.userData && child.userData.shared) return;
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material.userData && material.userData.shared) return;
        if (material.map) material.map.dispose();
        material.dispose();
      });
    }
  });
}
