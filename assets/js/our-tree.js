/* 西南 F4 相册：兼容配置指南中的 Worker /list 与 /upload 接口。 */
const ALBUM_CONFIG = window.ALBUM_CONFIG || {};
const WORKER_URL = ALBUM_CONFIG.workerUrl || "https://proud-flower-5f26.hleisure161.workers.dev";
const API_ROOT = WORKER_URL.replace(/\/$/, "");
const DEMO_IMAGE = "assets/img/cover.jpg";
const MAX_UPLOAD_MB = 60;
const LOCAL_MEDIA = Array.isArray(window.LOCAL_MEDIA) ? window.LOCAL_MEDIA : [];

const $ = (selector) => document.querySelector(selector);
const albumGrid = $("#albumGrid");
const albumDetail = $("#albumDetail");
const photoGrid = $("#photoGrid");
const syncStatus = $("#syncStatus");
const syncDot = $("#syncDot");
const modal = $("#uploadModal");
const form = $("#uploadForm");
const fileInput = $("#fileInput");
const dropZone = $("#dropZone");
const fileSummary = $("#fileSummary");
const startUpload = $("#startUpload");
const toast = $("#toast");
const selectBar = $("#selectBar");
const selectCount = $("#selectCount");
const manageToggle = $("#manageToggle");
const root = document.documentElement;

let photos = [];
let albums = [];
window.__albums = [];
let selectedFiles = [];
let activeAlbum = null;
let lightboxPhotos = [];
let lightboxIndex = -1;
let manageMode = false;
const selectedIndices = new Set();
const deletedNames = new Set();

function applyTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("swf4-theme", theme);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", theme === "night" ? "#101713" : "#f5f1ea");
}

const savedTheme = localStorage.getItem("swf4-theme");
if (savedTheme === "night" || savedTheme === "day") applyTheme(savedTheme);

$("#themeToggle").addEventListener("click", () => {
  applyTheme(root.dataset.theme === "night" ? "day" : "night");
  initParticles();
});

function configured() {
  return API_ROOT && !API_ROOT.includes("你的worker地址");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function setSync(state, message) {
  syncStatus.textContent = message;
  syncDot.className = `sync-dot ${state || ""}`;
}

function encodeMeta(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeMeta(value) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const binary = atob(normalized);
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch (_) {
    return "未命名";
  }
}

function isVideo(url = "") {
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
}

function parsePhoto(file, index) {
  const name = String(file.name || `memory-${index}`).replace(/^\d+-/, "");
  const dotted = name.match(/^swf4\.([^.]+)\.([^.]+)\.(\d+)\./);
  if (dotted) {
    return { ...file, owner: decodeMeta(dotted[1]), album: decodeMeta(dotted[2]), timestamp: Number(dotted[3]) || 0, index, remote: true };
  }
  const legacy = name.match(/^swf4-([A-Za-z0-9_-]+)-([A-Za-z0-9_-]+)-(\d+)-/);
  if (legacy) {
    return { ...file, owner: decodeMeta(legacy[1]), album: decodeMeta(legacy[2]), timestamp: Number(legacy[3]) || 0, index, remote: true };
  }
  return { ...file, owner: "往日存档", album: "未命名相册", timestamp: 0, index, remote: true };
}

function localPhotos() {
  return LOCAL_MEDIA.map((item, index) => ({
    name: item.name || `local-${index}`,
    url: item.url,
    owner: item.owner || "西南 F4",
    album: item.album || "本地影像",
    timestamp: Number(item.timestamp) || 0,
    index,
    local: true
  }));
}

function groupAlbums(list) {
  const groups = new Map();
  list.forEach((photo) => {
    const key = `${photo.owner}\u0000${photo.album}`;
    if (!groups.has(key)) groups.set(key, { key, owner: photo.owner, title: photo.album, dateValue: photo.timestamp || 0, photos: [] });
    const group = groups.get(key);
    group.photos.push(photo);
    group.dateValue = Math.max(group.dateValue, photo.timestamp || 0);
  });
  return [...groups.values()]
    .map((group) => ({ ...group, date: group.dateValue ? formatDate(group.dateValue) : "未记录日期" }))
    .sort((a, b) => b.dateValue - a.dateValue);
}

function formatDate(timestamp) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(timestamp));
  } catch (_) { return ""; }
}

function publishAlbums() {
  window.__albums = albums;
  window.dispatchEvent(new CustomEvent("albums:updated", { detail: albums }));
}

function renderAlbums() {
  unobserveFloats(albumGrid);
  publishAlbums();
  if (!albums.length) {
    albumGrid.innerHTML = `<div class="empty-state"><div><strong>还没有相册</strong><p>点击右下角的 +，把第一份回忆放进来。</p><button type="button" data-action="upload">创建新相册</button></div></div>`;
    return;
  }
  albumGrid.innerHTML = albums.map((album, index) => {
    const first = album.photos[0];
    const cover = first?.url || DEMO_IMAGE;
    const coverIsVideo = first && isVideo(first.url);
    const coverTag = coverIsVideo
      ? `<video src="${escapeAttr(cover)}#t=0.1" muted playsinline preload="metadata"></video>`
      : `<img src="${escapeAttr(cover)}" alt="${escapeAttr(album.title)}封面" loading="lazy">`;
    const videoCount = album.photos.filter((photo) => isVideo(photo.url)).length;
    const summary = [`${album.photos.length} 个回忆`, videoCount ? `${videoCount} 段视频` : ""].filter(Boolean).join(" · ");
    return `<button type="button" class="album-card" data-float style="--float-delay:${Math.min(index * 70, 420)}ms" data-album-index="${index}">
      <span class="album-cover${coverIsVideo ? " is-video" : ""}">${coverTag}<span class="album-index">0${index + 1}</span></span>
      <span class="album-body"><span><span class="album-owner">${escapeHtml(album.owner)}</span><strong class="album-title">${escapeHtml(album.title)}</strong><span class="album-meta">${summary} · ${escapeHtml(album.date)}</span></span><span class="album-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 12h13M13 6l6 6-6 6" /></svg></span></span>
    </button>`;
  }).join("");
  observeFloats(albumGrid);
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function escapeAttr(value) { return escapeHtml(value); }

function openAlbum(index) {
  activeAlbum = albums[index];
  if (!activeAlbum) return;
  exitManageMode();
  $("#albumDetailOwner").textContent = activeAlbum.owner;
  $("#albumDetailTitle").textContent = activeAlbum.title;
  $("#albumDetailCount").textContent = `${activeAlbum.photos.length} 个回忆`;
  $("#albumDetailDate").textContent = activeAlbum.date;
  renderPhotoTiles();
  albumGrid.hidden = true;
  albumDetail.hidden = false;
  document.querySelector("#albums").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPhotoTiles() {
  if (!activeAlbum) return;
  unobserveFloats(photoGrid);
  photoGrid.innerHTML = activeAlbum.photos.map((photo, index) => {
    const source = escapeAttr(photo.url);
    const label = escapeAttr(photo.name || `${activeAlbum.title} · ${index + 1}`);
    const delay = Math.min(index * 45, 540);
    const media = isVideo(photo.url)
      ? `<video src="${source}#t=0.1" muted playsinline preload="metadata"></video>`
      : `<img src="${source}" alt="${label}" loading="lazy">`;
    return `<button class="photo-tile${isVideo(photo.url) ? " is-video" : ""}" data-float style="--float-delay:${delay}ms" type="button" data-photo-index="${index}">${media}<span class="tile-check" aria-hidden="true"></span></button>`;
  }).join("");
  observeFloats(photoGrid);
  photoGrid.querySelectorAll(".photo-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      const i = Number(tile.dataset.photoIndex);
      if (manageMode) toggleSelect(i, tile);
      else openLightbox(activeAlbum.photos, i);
    });
  });
  updateSelectBar();
}

function exitManageMode() {
  manageMode = false;
  selectedIndices.clear();
  albumDetail.classList.remove("is-managing");
  if (selectBar) selectBar.hidden = true;
  if (manageToggle) {
    manageToggle.classList.remove("is-active");
    manageToggle.setAttribute("aria-pressed", "false");
  }
  photoGrid.querySelectorAll(".photo-tile.is-selected").forEach((el) => el.classList.remove("is-selected"));
  updateSelectBar();
}

function toggleManageMode() {
  if (!activeAlbum) return;
  if (manageMode) { exitManageMode(); return; }
  manageMode = true;
  selectedIndices.clear();
  albumDetail.classList.add("is-managing");
  if (selectBar) selectBar.hidden = false;
  if (manageToggle) {
    manageToggle.classList.add("is-active");
    manageToggle.setAttribute("aria-pressed", "true");
  }
  updateSelectBar();
}

function toggleSelect(index, tile) {
  if (selectedIndices.has(index)) selectedIndices.delete(index);
  else selectedIndices.add(index);
  tile.classList.toggle("is-selected", selectedIndices.has(index));
  updateSelectBar();
}

function updateSelectBar() {
  if (!selectBar || !selectCount) return;
  const count = selectedIndices.size;
  selectCount.textContent = `已选 ${count} 项`;
  const del = selectBar.querySelector('[data-select="delete"]');
  const download = selectBar.querySelector('[data-select="download"]');
  if (del) del.disabled = count === 0;
  if (download) download.disabled = count === 0;
}

function toggleSelectAll() {
  if (!activeAlbum) return;
  if (selectedIndices.size === activeAlbum.photos.length) selectedIndices.clear();
  else activeAlbum.photos.forEach((_, i) => selectedIndices.add(i));
  photoGrid.querySelectorAll(".photo-tile").forEach((tile) => {
    tile.classList.toggle("is-selected", selectedIndices.has(Number(tile.dataset.photoIndex)));
  });
  updateSelectBar();
}

function getAdminPassword() {
  if (ALBUM_CONFIG.uploadPassword) return ALBUM_CONFIG.uploadPassword;
  const saved = sessionStorage.getItem("swf4-admin-pw");
  if (saved) return saved;
  const input = window.prompt("请输入口令（和上传口令相同）");
  if (input === null) return null;
  sessionStorage.setItem("swf4-admin-pw", input);
  return input;
}

async function deleteRemote(photo, password) {
  const response = await fetch(`${API_ROOT}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, name: photo.name })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "删除失败");
  return data;
}

async function deleteSelected() {
  if (!activeAlbum || !selectedIndices.size) return;
  const chosen = [...selectedIndices].map((i) => activeAlbum.photos[i]).filter(Boolean);
  const remoteItems = chosen.filter((photo) => photo.remote);
  const localCount = chosen.length - remoteItems.length;
  if (!remoteItems.length) {
    showToast("选中的都是本地文件，请到仓库里删除");
    return;
  }
  if (!window.confirm(`确定删除选中的 ${remoteItems.length} 个吗？删除后网页无法恢复。`)) return;
  const password = getAdminPassword();
  if (password === null) return;
  let ok = 0;
  const errors = [];
  for (const photo of remoteItems) {
    try {
      await deleteRemote(photo, password);
      ok += 1;
      deletedNames.add(photo.name);
    } catch (error) {
      if (/密码/.test(error.message)) {
        sessionStorage.removeItem("swf4-admin-pw");
        errors.push(error.message);
        break;
      }
      errors.push(error.message);
    }
  }
  if (ok) showToast(`已删除 ${ok} 个${errors.length ? `，${errors.length} 个失败` : ""}${localCount ? `；${localCount} 个本地文件已跳过` : ""}`);
  else showToast(`删除失败：${errors[0] || "未知错误"}`);
  const key = activeAlbum.key;
  await loadAlbums();
  const nextIndex = albums.findIndex((album) => album.key === key);
  if (nextIndex >= 0) openAlbum(nextIndex);
  else closeAlbum();
}

async function downloadSelected() {
  if (!activeAlbum || !selectedIndices.size) return;
  const chosen = [...selectedIndices].map((i) => activeAlbum.photos[i]).filter(Boolean);
  let ok = 0;
  for (const photo of chosen) {
    try {
      const response = await fetch(photo.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = photo.name || "memory";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      ok += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch (_) { /* 跳过 */ }
  }
  showToast(ok ? `已开始下载 ${ok} 个` : "下载失败");
}

function closeAlbum() {
  exitManageMode();
  activeAlbum = null;
  albumDetail.hidden = true;
  albumGrid.hidden = false;
}

async function loadAlbums() {
  const local = localPhotos();
  if (!configured()) {
    photos = local;
    albums = groupAlbums(photos);
    if (local.length) setSync("online", `本地 ${local.length} 个回忆`);
    else setSync("", "演示预览 · 等待 Worker");
    renderAlbums();
    return;
  }
  setSync("", "正在同步相册");
  if (!local.length) albumGrid.innerHTML = Array.from({ length: 3 }, () => "<div class=\"loading-grid\"></div>").join("");
  try {
    const response = await fetch(`${API_ROOT}/list?_=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "读取相册失败");
    const remote = (Array.isArray(data.files) ? data.files : [])
      .map(parsePhoto)
      .filter((photo) => !deletedNames.has(photo.name));
    photos = [...local, ...remote];
    albums = groupAlbums(photos);
    setSync("online", `已同步 ${photos.length} 个回忆`);
    renderAlbums();
  } catch (error) {
    console.error(error);
    photos = local;
    albums = groupAlbums(photos);
    if (local.length) {
      setSync("error", "云端连接失败 · 显示本地");
      renderAlbums();
    } else {
      setSync("error", "相册连接失败");
      albumGrid.innerHTML = `<div class="empty-state"><div><strong>暂时无法读取相册</strong><p>${escapeHtml(error.message || "请检查 Worker 地址和配置")}</p><button type="button" data-action="retry">重新连接</button></div></div>`;
    }
  }
}

function openUpload() {
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#uploaderName").focus(), 80);
}

function closeUpload() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function updateFiles(files) {
  selectedFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
  if (!selectedFiles.length) {
    fileSummary.textContent = "还没有选择文件";
    startUpload.disabled = true;
    return;
  }
  const names = selectedFiles.slice(0, 2).map((file) => file.name).join("、");
  fileSummary.textContent = `${selectedFiles.length} 个文件${names ? `：${names}${selectedFiles.length > 2 ? "等" : ""}` : ""}`;
  startUpload.disabled = !form.checkValidity();
}

async function compressImage(file, maxSize = 1800, quality = .84) {
  if (!file.type.startsWith("image/")) return file;
  if (!window.createImageBitmap) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("图片压缩失败");
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadOne(file, owner, title, password) {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`${file.name} 超过 ${MAX_UPLOAD_MB}MB，请用「更新相册.bat」导入本地大文件`);
  }
  const compressed = await compressImage(file);
  const baseName = compressed.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `swf4.${encodeMeta(owner)}.${encodeMeta(title)}.${Date.now()}.${baseName}`;
  const response = await fetch(`${API_ROOT}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, filename, content: await fileToBase64(compressed) })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "上传失败");
  return data;
}

async function submitUpload(event) {
  event.preventDefault();
  if (!selectedFiles.length) return;
  if (!configured()) {
    showToast("请先在 assets/js/config.js 配置 Worker 地址");
    return;
  }
  const owner = $("#uploaderName").value.trim();
  const title = $("#albumTitle").value.trim();
  const password = $("#passwordInput").value;
  startUpload.disabled = true;
  startUpload.querySelector("span").textContent = `上传中 0/${selectedFiles.length}`;
  try {
    let okCount = 0;
    const errors = [];
    for (let index = 0; index < selectedFiles.length; index += 1) {
      try {
        await uploadOne(selectedFiles[index], owner, title, password);
        okCount += 1;
      } catch (error) {
        errors.push(error.message);
      }
      startUpload.querySelector("span").textContent = `上传中 ${index + 1}/${selectedFiles.length}`;
    }
    if (okCount) {
      showToast(`“${title}”已上传 ${okCount} 个文件${errors.length ? `，${errors.length} 个失败` : ""}`);
      form.reset();
      updateFiles([]);
      closeUpload();
    } else {
      showToast(`上传失败：${errors[0] || "未知错误"}`);
    }
    await loadAlbums();
  } catch (error) {
    showToast(`上传失败：${error.message}`);
  } finally {
    startUpload.disabled = false;
    startUpload.querySelector("span").textContent = "开始上传";
  }
}

function openLightbox(list, index) {
  lightboxPhotos = list;
  lightboxIndex = index;
  renderLightbox();
  $("#lightbox").classList.add("open");
  $("#lightbox").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function renderLightbox() {
  const photo = lightboxPhotos[lightboxIndex];
  if (!photo) return;
  const figure = $(".lightbox-figure");
  const oldMedia = $("#lightboxImage, #lightboxVideo");
  if (oldMedia) {
    if (typeof oldMedia.pause === "function") oldMedia.pause();
    oldMedia.remove();
  }
  if (isVideo(photo.url)) {
    const video = document.createElement("video");
    video.id = "lightboxVideo";
    video.src = photo.url;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    figure.insertBefore(video, $("#lightboxCaption"));
  } else {
    const image = document.createElement("img");
    image.id = "lightboxImage";
    image.src = photo.url;
    image.alt = photo.name || "照片预览";
    figure.insertBefore(image, $("#lightboxCaption"));
  }
  $("#lightboxCaption").textContent = `${photo.owner || activeAlbum?.owner || "西南 F4"} · ${lightboxIndex + 1} / ${lightboxPhotos.length}`;
}

function closeLightbox() {
  const media = $("#lightboxImage, #lightboxVideo");
  if (media) {
    if (typeof media.pause === "function") media.pause();
    media.remove();
  }
  $("#lightbox").classList.remove("open");
  $("#lightbox").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  lightboxPhotos = [];
  lightboxIndex = -1;
}

function changeLightbox(direction) {
  if (!lightboxPhotos.length) return;
  lightboxIndex = (lightboxIndex + direction + lightboxPhotos.length) % lightboxPhotos.length;
  renderLightbox();
}

$("#headerUpload").addEventListener("click", openUpload);
$("#floatingUpload").addEventListener("click", openUpload);
$("#refreshButton").addEventListener("click", loadAlbums);
$("#backToAlbums").addEventListener("click", closeAlbum);
if (manageToggle) manageToggle.addEventListener("click", toggleManageMode);
if (selectBar) {
  selectBar.addEventListener("click", (event) => {
    const action = event.target.closest("[data-select]")?.dataset.select;
    if (!action) return;
    if (action === "all") toggleSelectAll();
    else if (action === "cancel") exitManageMode();
    else if (action === "delete") deleteSelected();
    else if (action === "download") downloadSelected();
  });
}
$("#closeUpload").addEventListener("click", closeUpload);
$("#cancelUpload").addEventListener("click", closeUpload);
$("#uploadForm").addEventListener("submit", submitUpload);
$("#uploadForm").addEventListener("input", () => { startUpload.disabled = !selectedFiles.length || !form.checkValidity(); });
fileInput.addEventListener("change", () => updateFiles(fileInput.files));
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") fileInput.click(); });
["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); }));
["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("is-dragging"); }));
dropZone.addEventListener("drop", (event) => updateFiles(event.dataTransfer.files));
albumGrid.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "upload") openUpload();
  if (action === "retry") loadAlbums();
  const card = event.target.closest("[data-album-index]");
  if (card) openAlbum(Number(card.dataset.albumIndex));
});
$("#lightboxClose").addEventListener("click", closeLightbox);
$("#lightboxPrev").addEventListener("click", () => changeLightbox(-1));
$("#lightboxNext").addEventListener("click", () => changeLightbox(1));
$("#lightbox").addEventListener("click", (event) => { if (event.target.id === "lightbox") closeLightbox(); });
modal.addEventListener("click", (event) => { if (event.target === modal) closeUpload(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { if (modal.classList.contains("open")) closeUpload(); else if ($("#lightbox").classList.contains("open")) closeLightbox(); }
  if ($("#lightbox").classList.contains("open")) { if (event.key === "ArrowLeft") changeLightbox(-1); if (event.key === "ArrowRight") changeLightbox(1); }
});
window.addEventListener("scroll", () => $("#siteHeader").classList.toggle("is-scrolled", window.scrollY > 30), { passive: true });

/* 浮动进入：元素进入视口时向上浮起并淡入。 */
let floatObserver = null;
function observeFloats(scope = document) {
  const targets = scope.querySelectorAll("[data-float]:not(.is-in)");
  if (!targets.length) return;
  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => { el.classList.add("is-in", "float-done"); });
    return;
  }
  if (!floatObserver) {
    floatObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        el.classList.add("is-in");
        const finish = (event) => {
          if (event.propertyName !== "opacity") return;
          el.classList.add("float-done");
          el.removeEventListener("transitionend", finish);
        };
        el.addEventListener("transitionend", finish);
        floatObserver.unobserve(el);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.12 });
  }
  targets.forEach((el) => floatObserver.observe(el));
}

function unobserveFloats(scope) {
  if (!floatObserver) return;
  scope.querySelectorAll("[data-float]").forEach((el) => floatObserver.unobserve(el));
}

/* 粒子层：漂浮、邻近连线，以及指针靠近时向外散开。 */
const particleCanvas = $("#particles");
const particleContext = particleCanvas.getContext("2d");
let particleWidth = 0;
let particleHeight = 0;
let particleDpr = 1;
let particleList = [];
const pointer = { x: -9999, y: -9999, active: false };
const particlePalette = {
  day: { colors: ["#2f5a49", "#315847", "#7a4a26", "#3f6b55", "#5b7a68"], alphaMin: .55, alphaRange: .35 },
  night: { colors: ["#9bb3a4", "#d9a786", "#a8c7ba", "#dfe8dc", "#789987"], alphaMin: .37, alphaRange: .28 }
};
const pointerRadius = 148;
const linkDistance = 102;

function resizeParticles() {
  particleDpr = Math.min(window.devicePixelRatio || 1, 2);
  particleWidth = window.innerWidth;
  particleHeight = window.innerHeight;
  particleCanvas.width = particleWidth * particleDpr;
  particleCanvas.height = particleHeight * particleDpr;
  particleCanvas.style.width = `${particleWidth}px`;
  particleCanvas.style.height = `${particleHeight}px`;
  particleContext.setTransform(particleDpr, 0, 0, particleDpr, 0, 0);
}

function initParticles() {
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const count = Math.round(Math.min(touch ? 130 : 220, Math.max(touch ? 65 : 100, (particleWidth * particleHeight) / 11000)));
  const palette = particlePalette[root.dataset.theme === "night" ? "night" : "day"];
  particleList = Array.from({ length: count }, () => ({
    x: Math.random() * particleWidth,
    y: Math.random() * particleHeight,
    vx: (Math.random() - .5) * .35,
    vy: (Math.random() - .5) * .35,
    radius: Math.random() * 2.1 + .8,
    color: palette.colors[(Math.random() * palette.colors.length) | 0],
    alpha: Math.random() * palette.alphaRange + palette.alphaMin
  }));
}

function particleFrame() {
  particleContext.clearRect(0, 0, particleWidth, particleHeight);
  const isNight = root.dataset.theme === "night";
  for (const particle of particleList) {
    if (pointer.active) {
      const dx = particle.x - pointer.x;
      const dy = particle.y - pointer.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < pointerRadius * pointerRadius && distanceSquared > .01) {
        const distance = Math.sqrt(distanceSquared);
        const force = 1 - distance / pointerRadius;
        particle.vx += (dx / distance) * force * .72;
        particle.vy += (dy / distance) * force * .72;
      }
    }
    particle.vx = particle.vx * .968 + (Math.random() - .5) * .018;
    particle.vy = particle.vy * .968 + (Math.random() - .5) * .018;
    const speed = Math.hypot(particle.vx, particle.vy);
    if (speed > 3.8) {
      particle.vx = particle.vx / speed * 3.8;
      particle.vy = particle.vy / speed * 3.8;
    }
    particle.x += particle.vx;
    particle.y += particle.vy;
    if (particle.x < -10) particle.x = particleWidth + 10;
    if (particle.x > particleWidth + 10) particle.x = -10;
    if (particle.y < -10) particle.y = particleHeight + 10;
    if (particle.y > particleHeight + 10) particle.y = -10;
  }

  particleContext.lineWidth = 1;
  for (let index = 0; index < particleList.length; index += 1) {
    const first = particleList[index];
    for (let next = index + 1; next < particleList.length; next += 1) {
      const second = particleList[next];
      const dx = first.x - second.x;
      const dy = first.y - second.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < linkDistance * linkDistance) {
        const alpha = (1 - Math.sqrt(distanceSquared) / linkDistance) * (isNight ? .16 : .3);
        particleContext.strokeStyle = `rgba(${isNight ? "178,211,188" : "47,90,73"},${alpha})`;
        particleContext.beginPath();
        particleContext.moveTo(first.x, first.y);
        particleContext.lineTo(second.x, second.y);
        particleContext.stroke();
      }
    }
  }
  for (const particle of particleList) {
    particleContext.globalAlpha = particle.alpha;
    particleContext.fillStyle = particle.color;
    particleContext.beginPath();
    particleContext.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    particleContext.fill();
  }
  particleContext.globalAlpha = 1;
  requestAnimationFrame(particleFrame);
}

window.addEventListener("mousemove", (event) => { pointer.x = event.clientX; pointer.y = event.clientY; pointer.active = true; });
window.addEventListener("mouseout", () => { pointer.active = false; pointer.x = -9999; pointer.y = -9999; });
window.addEventListener("touchmove", (event) => { const touch = event.touches[0]; if (touch) { pointer.x = touch.clientX; pointer.y = touch.clientY; pointer.active = true; } }, { passive: true });
window.addEventListener("touchend", () => { pointer.active = false; pointer.x = -9999; pointer.y = -9999; });
resizeParticles();
initParticles();
particleFrame();
window.addEventListener("resize", () => { resizeParticles(); initParticles(); }, { passive: true });

if (ALBUM_CONFIG.uploadPassword) $("#passwordInput").value = ALBUM_CONFIG.uploadPassword;

observeFloats();

/* 供「回忆之树」调用：按相册下标 + 照片下标打开灯箱。 */
window.__treeOpenPhoto = (albumIndex, photoIndex) => {
  const album = albums[albumIndex];
  if (!album || !album.photos.length) return;
  const safeIndex = Math.max(0, Math.min(photoIndex, album.photos.length - 1));
  openLightbox(album.photos, safeIndex);
};

/* 回忆之树：进入视口附近再懒加载 3D 模块。 */
(function setupTreeShowcase() {
  const treeSection = document.querySelector("#treeShowcase");
  if (!treeSection) return;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    const status = document.querySelector("#treeStatus");
    const script = document.createElement("script");
    script.src = "assets/tree/tree.bundle.js";
    script.onload = () => {
      try {
        if (window.MemoryTree && typeof window.MemoryTree.initTree === "function") {
          window.MemoryTree.initTree();
        }
      } catch (error) {
        console.error(error);
        if (status) status.textContent = "3D 树初始化失败：" + error.message;
      }
    };
    script.onerror = () => {
      if (status) status.textContent = "3D 树加载失败，请检查 assets/tree/tree.bundle.js。";
    };
    document.body.appendChild(script);
  };
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    }, { rootMargin: "500px" });
    observer.observe(treeSection);
  } else {
    start();
  }
})();

loadAlbums();
