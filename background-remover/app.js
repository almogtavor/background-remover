const els = {
  fileInput: document.getElementById("fileInput"),
  dropZone: document.getElementById("dropZone"),
  displayCanvas: document.getElementById("displayCanvas"),
  canvasShell: document.getElementById("canvasShell"),
  emptyState: document.getElementById("emptyState"),
  statusText: document.getElementById("statusText"),
  autoDetectBtn: document.getElementById("autoDetectBtn"),
  bgColorInput: document.getElementById("bgColorInput"),
  pickColorBtn: document.getElementById("pickColorBtn"),
  toleranceInput: document.getElementById("toleranceInput"),
  toleranceValue: document.getElementById("toleranceValue"),
  softnessInput: document.getElementById("softnessInput"),
  softnessValue: document.getElementById("softnessValue"),
  edgeOnlyInput: document.getElementById("edgeOnlyInput"),
  outlineEnabledInput: document.getElementById("outlineEnabledInput"),
  outlineColorInput: document.getElementById("outlineColorInput"),
  outlineSizeInput: document.getElementById("outlineSizeInput"),
  outlineSizeValue: document.getElementById("outlineSizeValue"),
  downloadBtn: document.getElementById("downloadBtn"),
  resetBtn: document.getElementById("resetBtn"),
  resultTab: document.getElementById("resultTab"),
  originalTab: document.getElementById("originalTab"),
  cropBtn: document.getElementById("cropBtn"),
  autoCropBtn: document.getElementById("autoCropBtn"),
};

const state = {
  imageName: "",
  image: null,
  originalCanvas: document.createElement("canvas"),
  resultCanvas: document.createElement("canvas"),
  view: "result",
  isPicking: false,
  isCropping: false,
  cropStart: null,
  cropRect: null,
  crop: null,
  autoCrop: false,
  lastObjectPixels: 0,
};

const originalCtx = state.originalCanvas.getContext("2d", { willReadFrequently: true });
const resultCtx = state.resultCanvas.getContext("2d", { willReadFrequently: true });
const displayCtx = els.displayCanvas.getContext("2d");
const outlineWork = {
  maskCanvas: document.createElement("canvas"),
  outlineCanvas: document.createElement("canvas"),
  subjectCanvas: document.createElement("canvas"),
  finalCanvas: document.createElement("canvas"),
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbCss({ r, g, b }) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function colorDistance(data, index, color) {
  const dr = data[index] - color.r;
  const dg = data[index + 1] - color.g;
  const db = data[index + 2] - color.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function updateOutputs() {
  els.toleranceValue.value = els.toleranceInput.value;
  els.softnessValue.value = els.softnessInput.value;
  els.outlineSizeValue.value = els.outlineSizeInput.value;
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function setButtonsEnabled(enabled) {
  els.downloadBtn.disabled = !enabled;
  els.resetBtn.disabled = !enabled;
  els.cropBtn.disabled = !enabled;
  els.autoCropBtn.disabled = !enabled;
}

function setAutoCrop(on) {
  state.autoCrop = on;
  els.autoCropBtn.setAttribute("aria-pressed", String(on));
}

function setPicking(on) {
  state.isPicking = on;
  els.pickColorBtn.setAttribute("aria-pressed", String(on));
  els.canvasShell.classList.toggle("picking", on);
}

function setCropping(on) {
  state.isCropping = on;
  state.cropStart = null;
  state.cropRect = null;
  els.cropBtn.setAttribute("aria-pressed", String(on));
  els.canvasShell.classList.toggle("cropping", on);
}

function setView(view) {
  state.view = view;
  els.resultTab.classList.toggle("active", view === "result");
  els.originalTab.classList.toggle("active", view === "original");
  els.resultTab.setAttribute("aria-selected", String(view === "result"));
  els.originalTab.setAttribute("aria-selected", String(view === "original"));
  drawDisplay();
}

function syncDisplaySize(source) {
  if (els.displayCanvas.width !== source.width || els.displayCanvas.height !== source.height) {
    els.displayCanvas.width = source.width;
    els.displayCanvas.height = source.height;
  }
}

function drawDisplay() {
  const source = state.view === "original" ? state.originalCanvas : state.resultCanvas;
  if (!source.width || !source.height) return;

  syncDisplaySize(source);
  displayCtx.clearRect(0, 0, els.displayCanvas.width, els.displayCanvas.height);
  displayCtx.drawImage(source, 0, 0);
}

// Always redraws 1:1 from the decoded source image, so crops never resample or round-trip pixels.
function drawOriginalImage(image) {
  const { x, y, w, h } = state.crop || { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
  state.originalCanvas.width = w;
  state.originalCanvas.height = h;
  originalCtx.drawImage(image, x, y, w, h, 0, 0, w, h);
}

function getOpaqueBounds({ data, width, height }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function quantizedKey(data, index) {
  const bucket = 16;
  const r = Math.round(data[index] / bucket) * bucket;
  const g = Math.round(data[index + 1] / bucket) * bucket;
  const b = Math.round(data[index + 2] / bucket) * bucket;
  return `${clamp(r, 0, 255)},${clamp(g, 0, 255)},${clamp(b, 0, 255)}`;
}

function detectBackgroundColor() {
  if (!state.originalCanvas.width) return null;

  const width = state.originalCanvas.width;
  const height = state.originalCanvas.height;
  const { data } = originalCtx.getImageData(0, 0, width, height);
  const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 120));
  const buckets = new Map();

  function addSample(x, y) {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 12) return;

    const key = quantizedKey(data, index);
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += data[index];
    bucket.g += data[index + 1];
    bucket.b += data[index + 2];
    buckets.set(key, bucket);
  }

  for (let x = 0; x < width; x += sampleStep) {
    addSample(x, 0);
    addSample(x, height - 1);
  }

  for (let y = 0; y < height; y += sampleStep) {
    addSample(0, y);
    addSample(width - 1, y);
  }

  const cornerSize = Math.max(3, Math.floor(Math.min(width, height) * 0.04));
  for (let y = 0; y < cornerSize; y += sampleStep) {
    for (let x = 0; x < cornerSize; x += sampleStep) {
      addSample(x, y);
      addSample(width - 1 - x, y);
      addSample(x, height - 1 - y);
      addSample(width - 1 - x, height - 1 - y);
    }
  }

  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }

  if (!best) return null;
  return {
    r: best.r / best.count,
    g: best.g / best.count,
    b: best.b / best.count,
  };
}

function getMatchingMask(data, width, height, bgColor, tolerance) {
  const mask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    if (data[index + 3] > 0 && colorDistance(data, index, bgColor) <= tolerance) {
      mask[pixel] = 1;
    }
  }
  return mask;
}

function getEdgeConnectedMask(matchMask, width, height) {
  const connected = new Uint8Array(width * height);
  const queue = [];

  function tryAdd(pixel) {
    if (!matchMask[pixel] || connected[pixel]) return;
    connected[pixel] = 1;
    queue.push(pixel);
  }

  for (let x = 0; x < width; x += 1) {
    tryAdd(x);
    tryAdd((height - 1) * width + x);
  }

  for (let y = 0; y < height; y += 1) {
    tryAdd(y * width);
    tryAdd(y * width + width - 1);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixel = queue[cursor];
    const x = pixel % width;
    const y = Math.floor(pixel / width);

    if (x > 0) tryAdd(pixel - 1);
    if (x < width - 1) tryAdd(pixel + 1);
    if (y > 0) tryAdd(pixel - width);
    if (y < height - 1) tryAdd(pixel + width);
  }

  return connected;
}

function buildObjectMask(imageData) {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  let objectPixels = 0;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (data[pixel * 4 + 3] > 0) {
      mask[pixel] = 1;
      objectPixels += 1;
    }
  }

  state.lastObjectPixels = objectPixels;
  return mask;
}

function applyColorRemoval() {
  if (!state.originalCanvas.width) return;

  updateOutputs();
  const width = state.originalCanvas.width;
  const height = state.originalCanvas.height;
  const bgColor = hexToRgb(els.bgColorInput.value);
  const tolerance = Number(els.toleranceInput.value);
  const softness = Number(els.softnessInput.value);
  const imageData = originalCtx.getImageData(0, 0, width, height);
  const matchMask = getMatchingMask(imageData.data, width, height, bgColor, tolerance + softness);
  const removalMask = els.edgeOnlyInput.checked
    ? getEdgeConnectedMask(matchMask, width, height)
    : matchMask;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    if (!removalMask[pixel]) continue;

    const distance = colorDistance(imageData.data, index, bgColor);
    if (distance <= tolerance) {
      imageData.data[index + 3] = 0;
    } else if (softness > 0) {
      const fade = 1 - (distance - tolerance) / softness;
      imageData.data[index + 3] = Math.round(imageData.data[index + 3] * (1 - clamp(fade, 0, 1)));
    }
  }

  const objectMask = buildObjectMask(imageData);
  const finalData = els.outlineEnabledInput.checked
    ? renderOutline(imageData, objectMask)
    : imageData;

  const bounds = (state.autoCrop && getOpaqueBounds(finalData)) || { x: 0, y: 0, w: width, h: height };
  state.resultCanvas.width = bounds.w;
  state.resultCanvas.height = bounds.h;
  resultCtx.putImageData(finalData, -bounds.x, -bounds.y);

  const keptPercent = width * height
    ? Math.round((state.lastObjectPixels / (width * height)) * 100)
    : 0;
  setStatus(`${state.imageName || "Image"} - ${keptPercent}% retained`);
  drawDisplay();
}

function renderOutline(imageData, objectMask) {
  const size = Number(els.outlineSizeInput.value);
  if (size <= 0) return imageData;

  const width = imageData.width;
  const height = imageData.height;
  const outlineColor = hexToRgb(els.outlineColorInput.value);
  const radiusSquared = size * size;

  Object.values(outlineWork).forEach((canvas) => {
    canvas.width = width;
    canvas.height = height;
  });

  const maskCtx = outlineWork.maskCanvas.getContext("2d");
  const outlineCtx = outlineWork.outlineCanvas.getContext("2d");
  const subjectCtx = outlineWork.subjectCanvas.getContext("2d");
  const finalCtx = outlineWork.finalCanvas.getContext("2d", { willReadFrequently: true });

  const maskData = maskCtx.createImageData(width, height);
  for (let pixel = 0; pixel < objectMask.length; pixel += 1) {
    if (objectMask[pixel]) maskData.data[pixel * 4 + 3] = 255;
  }

  maskCtx.clearRect(0, 0, width, height);
  maskCtx.putImageData(maskData, 0, 0);

  outlineCtx.clearRect(0, 0, width, height);
  outlineCtx.globalCompositeOperation = "source-over";
  for (let oy = -size; oy <= size; oy += 1) {
    for (let ox = -size; ox <= size; ox += 1) {
      if (ox * ox + oy * oy <= radiusSquared) {
        outlineCtx.drawImage(outlineWork.maskCanvas, ox, oy);
      }
    }
  }

  outlineCtx.globalCompositeOperation = "source-in";
  outlineCtx.fillStyle = rgbCss(outlineColor);
  outlineCtx.fillRect(0, 0, width, height);
  outlineCtx.globalCompositeOperation = "destination-out";
  outlineCtx.drawImage(outlineWork.maskCanvas, 0, 0);
  outlineCtx.globalCompositeOperation = "source-over";

  subjectCtx.clearRect(0, 0, width, height);
  subjectCtx.putImageData(imageData, 0, 0);

  finalCtx.clearRect(0, 0, width, height);
  finalCtx.drawImage(outlineWork.outlineCanvas, 0, 0);
  finalCtx.drawImage(outlineWork.subjectCanvas, 0, 0);

  return finalCtx.getImageData(0, 0, width, height);
}

function loadImageFromFile(file) {
  if (!file || !file.type.startsWith("image/")) return;

  const imageUrl = URL.createObjectURL(file);
  const image = new Image();

  image.addEventListener("load", () => {
    URL.revokeObjectURL(imageUrl);
    state.image = image;
    state.imageName = file.name;
    setCropping(false);
    state.crop = null;
    drawOriginalImage(image);

    const detected = detectBackgroundColor();
    if (detected) {
      els.bgColorInput.value = rgbToHex(detected);
    }

    els.emptyState.classList.add("hidden");
    setButtonsEnabled(true);
    setView("result");
    applyColorRemoval();
  });

  image.addEventListener("error", () => {
    URL.revokeObjectURL(imageUrl);
    setStatus("Could not load that image");
  });

  image.src = imageUrl;
}

function getCanvasPoint(event) {
  const rect = els.displayCanvas.getBoundingClientRect();
  const scaleX = els.displayCanvas.width / rect.width;
  const scaleY = els.displayCanvas.height / rect.height;
  return {
    x: clamp(Math.floor((event.clientX - rect.left) * scaleX), 0, els.displayCanvas.width - 1),
    y: clamp(Math.floor((event.clientY - rect.top) * scaleY), 0, els.displayCanvas.height - 1),
  };
}

function pickColor(event) {
  if (!state.isPicking || !state.originalCanvas.width) return;

  const { x, y } = getCanvasPoint(event);
  const pixel = originalCtx.getImageData(x, y, 1, 1).data;
  els.bgColorInput.value = rgbToHex({ r: pixel[0], g: pixel[1], b: pixel[2] });
  setPicking(false);
  setView("result");
  applyColorRemoval();
}

function drawCropSelection() {
  drawDisplay();
  const rect = state.cropRect;
  if (!rect) return;

  const { width, height } = els.displayCanvas;
  const scale = width / els.displayCanvas.getBoundingClientRect().width;
  displayCtx.fillStyle = "rgba(23, 32, 42, 0.55)";
  displayCtx.fillRect(0, 0, width, height);
  displayCtx.clearRect(rect.x, rect.y, rect.w, rect.h);
  displayCtx.drawImage(state.originalCanvas, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
  displayCtx.lineWidth = 2 * scale;
  displayCtx.strokeStyle = "#ffffff";
  displayCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
}

function startCrop(event) {
  if (!state.isCropping) return;
  els.displayCanvas.setPointerCapture(event.pointerId);
  state.cropStart = getCanvasPoint(event);
  state.cropRect = null;
}

function moveCrop(event) {
  if (!state.cropStart) return;
  const a = state.cropStart;
  const b = getCanvasPoint(event);
  state.cropRect = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x) + 1,
    h: Math.abs(a.y - b.y) + 1,
  };
  drawCropSelection();
}

function endCrop() {
  if (!state.cropStart) return;
  const rect = state.cropRect;
  state.cropStart = null;
  state.cropRect = null;
  if (!rect || rect.w < 4 || rect.h < 4) {
    drawDisplay();
    return;
  }

  const base = state.crop || { x: 0, y: 0 };
  state.crop = { x: base.x + rect.x, y: base.y + rect.y, w: rect.w, h: rect.h };
  drawOriginalImage(state.image);
  setCropping(false);
  setView("result");
  applyColorRemoval();
}

function resetImage() {
  if (!state.image) return;

  setCropping(false);
  setAutoCrop(false);
  state.crop = null;
  drawOriginalImage(state.image);
  const detected = detectBackgroundColor();
  if (detected) els.bgColorInput.value = rgbToHex(detected);

  els.toleranceInput.value = "34";
  els.softnessInput.value = "18";
  els.edgeOnlyInput.checked = false;
  els.outlineEnabledInput.checked = true;
  els.outlineColorInput.value = "#ffffff";
  els.outlineSizeInput.value = "8";
  updateOutputs();
  applyColorRemoval();
}

function downloadResult() {
  if (!state.resultCanvas.width) return;

  const link = document.createElement("a");
  const baseName = (state.imageName || "background-removed").replace(/\.[^.]+$/, "");
  link.download = `${baseName}-transparent.png`;
  link.href = state.resultCanvas.toDataURL("image/png");
  link.click();
}

function setDragActive(active) {
  els.dropZone.classList.toggle("drag-over", active);
  els.canvasShell.classList.toggle("drag-over", active);
}

function handleDrag(event) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  setDragActive(true);
}

function clearDrag(event) {
  event.preventDefault();
  setDragActive(false);
}

function handleDrop(event) {
  clearDrag(event);
  loadImageFromFile(event.dataTransfer?.files[0]);
}

function handlePaste(event) {
  const items = event.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      event.preventDefault();
      loadImageFromFile(item.getAsFile());
      return;
    }
  }
}

function autoDetect() {
  const detected = detectBackgroundColor();
  if (!detected) return;

  els.bgColorInput.value = rgbToHex(detected);
  applyColorRemoval();
}

function wireEvents() {
  els.fileInput.addEventListener("change", (event) => {
    loadImageFromFile(event.target.files[0]);
  });

  els.dropZone.addEventListener("dragenter", handleDrag);
  els.dropZone.addEventListener("dragover", handleDrag);
  els.dropZone.addEventListener("dragleave", clearDrag);
  els.dropZone.addEventListener("drop", handleDrop);
  els.canvasShell.addEventListener("dragenter", handleDrag);
  els.canvasShell.addEventListener("dragover", handleDrag);
  els.canvasShell.addEventListener("dragleave", clearDrag);
  els.canvasShell.addEventListener("drop", handleDrop);

  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    setDragActive(false);
  });
  document.addEventListener("paste", handlePaste);

  els.autoDetectBtn.addEventListener("click", autoDetect);
  els.pickColorBtn.addEventListener("click", () => {
    if (!state.originalCanvas.width) return;
    setCropping(false);
    setPicking(!state.isPicking);
    setView("original");
    setStatus(state.isPicking ? "Pick a pixel from the image" : "Pixel picker off");
  });
  els.cropBtn.addEventListener("click", () => {
    if (!state.originalCanvas.width) return;
    setPicking(false);
    setCropping(!state.isCropping);
    setView(state.isCropping ? "original" : "result");
    setStatus(state.isCropping ? "Drag a rectangle to crop" : "Crop off");
  });

  [
    els.bgColorInput,
    els.toleranceInput,
    els.softnessInput,
    els.edgeOnlyInput,
    els.outlineEnabledInput,
    els.outlineColorInput,
    els.outlineSizeInput,
  ].forEach((input) => {
    input.addEventListener("input", applyColorRemoval);
    input.addEventListener("change", applyColorRemoval);
  });

  els.autoCropBtn.addEventListener("click", () => {
    setAutoCrop(!state.autoCrop);
    setView("result");
    applyColorRemoval();
  });

  els.displayCanvas.addEventListener("click", pickColor);
  els.displayCanvas.addEventListener("pointerdown", startCrop);
  els.displayCanvas.addEventListener("pointermove", moveCrop);
  els.displayCanvas.addEventListener("pointerup", endCrop);
  els.displayCanvas.addEventListener("pointercancel", endCrop);
  els.resultTab.addEventListener("click", () => setView("result"));
  els.originalTab.addEventListener("click", () => setView("original"));
  els.downloadBtn.addEventListener("click", downloadResult);
  els.resetBtn.addEventListener("click", resetImage);
}

updateOutputs();
wireEvents();
