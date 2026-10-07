import { paintStrokes } from "./annotations.js";

/** Keep temporary screenshot canvases bounded, including very long documents. */
export function captureSize(width, height, ratio = 1) {
  const MAX_PIXELS = 12_000_000;
  const MAX_EDGE = 16384;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("The page has no capture area.");
  }
  const scale = Math.min(Math.max(1, Math.min(Number(ratio) || 1, 2)), Math.sqrt(MAX_PIXELS / (width * height)), MAX_EDGE / width, MAX_EDGE / height);
  return { width, height, scale };
}

let rendererLoad = null;

/** Convert a CSS selection to bitmap bounds, including rounded edge pixels. */
export function bitmapRegion(region, width, height, bitmapWidth, bitmapHeight) {
  if (!region || ![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0) {
    throw new Error("Select an area to capture.");
  }
  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  const left = Math.floor(clamp(region.x, width) * bitmapWidth / width);
  const top = Math.floor(clamp(region.y, height) * bitmapHeight / height);
  const right = Math.ceil(clamp(region.x + region.width, width) * bitmapWidth / width);
  const bottom = Math.ceil(clamp(region.y + region.height, height) * bitmapHeight / height);
  if (right <= left || bottom <= top) throw new Error("The selected area is outside the page.");
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function checkAborted(signal) {
  if (signal?.aborted) throw new DOMException("Screenshot cancelled.", "AbortError");
}

const RENDER_TIMEOUT_MS = 20_000;

/** The renderer can wait forever (html-to-image never catches a rejected image
 * decode), so a capture gives up on abort or after the timeout instead of
 * holding Send. A canvas that arrives after that is released, not kept. */
function renderWithin(rendering, signal, ms = RENDER_TIMEOUT_MS) {
  let settled = false;
  let timer = null;
  let onAbort = null;
  const stop = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("The screenshot took too long to render. Try Viewport, or attach an image with Upload.")), ms);
    onAbort = () => reject(new DOMException("Screenshot cancelled.", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  rendering.then((canvas) => {
    if (settled && canvas) canvas.width = canvas.height = 0;
  }, () => {});
  return Promise.race([rendering, stop]).finally(() => {
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  });
}

/** The bundled renderer retains resource data URLs in a module-level cache.
 * Remove its script and namespace after each capture so dynamic assets cannot
 * accumulate in the review iframe. */
function releaseRenderer(load = rendererLoad) {
  if (!load) return;
  if (rendererLoad === load) rendererLoad = null;
  load.script.onload = load.script.onerror = null;
  load.script.remove();
  // An artifact can legitimately define this global. Restore it only if the
  // injected UMD bundle still owns the current namespace.
  if (load.namespaceLoaded && window.htmlToImage === load.namespace) {
    try {
      if (load.hadNamespace) window.htmlToImage = load.previousNamespace;
      else delete window.htmlToImage;
    } catch {}
  }
}

/** Load the bundled renderer only when the reviewer asks for a screenshot. */
function renderer() {
  if (!rendererLoad) {
    const script = document.createElement("script");
    const load = {
      script,
      namespace: null,
      namespaceLoaded: false,
      hadNamespace: Object.prototype.hasOwnProperty.call(window, "htmlToImage"),
      previousNamespace: window.htmlToImage,
      promise: null,
    };
    rendererLoad = load;
    load.promise = new Promise((resolve, reject) => {
      script.setAttribute("data-eh-sdk", "");
      script.src = new URL("/vendor/html-to-image.js", import.meta.url).href;
      script.onload = () => {
        script.onload = script.onerror = null;
        const namespace = window.htmlToImage;
        load.namespace = namespace;
        load.namespaceLoaded = true;
        if (typeof namespace?.toCanvas !== "function") {
          releaseRenderer(load);
          reject(new Error("Screenshot renderer could not be loaded."));
          return;
        }
        resolve(namespace.toCanvas);
      };
      script.onerror = () => {
        releaseRenderer(load);
        reject(new Error("Screenshot renderer could not be loaded. Try attaching an image instead."));
      };
      document.head.append(script);
    });
    return load.promise;
  }
  return rendererLoad.promise;
}

/** Capture the current edited document, excluding review controls. */
export async function capturePage(mode = "viewport", { region, strokes = [], signal, renderTimeoutMs } = {}) {
  checkAborted(signal);
  const full = mode === "full";
  const root = document.documentElement;
  if (root.getElementsByTagName("*").length > 30000) {
    throw new Error("This document is too large to capture safely. Attach a browser screenshot using Upload.");
  }
  let imagePixels = 0;
  for (const el of document.querySelectorAll("img, canvas, video")) {
    if (el.closest("[data-eh-ui], [data-eh-sdk]")) continue;
    imagePixels += (el.naturalWidth || el.videoWidth || el.width || 0) * (el.naturalHeight || el.videoHeight || el.height || 0);
    if (imagePixels > 24_000_000) throw new Error("This page contains too much image data to capture safely. Attach a browser screenshot using Upload.");
  }
  const width = full ? Math.max(root.scrollWidth, window.innerWidth) : window.innerWidth;
  const height = full ? Math.max(root.scrollHeight, document.body.scrollHeight, window.innerHeight) : window.innerHeight;
  const scrollX = full ? 0 : window.scrollX;
  const scrollY = full ? 0 : window.scrollY;
  const size = captureSize(width, height, window.devicePixelRatio);
  let canvas = null;
  let cropped = null;
  // The renderer checks this signal while fetching assets; release the link
  // and timer even when the frame is disposed during a screenshot.
  const fetchAbort = new AbortController();
  const abortFetch = () => fetchAbort.abort();
  signal?.addEventListener("abort", abortFetch, { once: true });
  const fetchTimeout = setTimeout(abortFetch, 10000);
  try {
    const render = await renderer();
    checkAborted(signal);
    const rootColor = getComputedStyle(root).backgroundColor;
    const bodyColor = getComputedStyle(document.body).backgroundColor;
    const opaque = (color) => color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)";
    canvas = await renderWithin(render(root, {
      width,
      height,
      canvasWidth: Math.max(1, Math.floor(width * size.scale)),
      canvasHeight: Math.max(1, Math.floor(height * size.scale)),
      pixelRatio: 1,
      skipAutoScale: true,
      backgroundColor: opaque(rootColor) ? rootColor : opaque(bodyColor) ? bodyColor : "#ffffff",
      fetchRequestInit: { signal: fetchAbort.signal },
      style: full ? {} : { transform: `translate(${-scrollX}px, ${-scrollY}px)`, transformOrigin: "top left" },
      filter: (node) => node.nodeType !== 1 || (!node.hasAttribute("data-eh-ui") && !node.hasAttribute("data-eh-sdk")),
    }), signal, renderTimeoutMs);
    checkAborted(signal);
    if (!full && (window.scrollX !== scrollX || window.scrollY !== scrollY || window.innerWidth !== width || window.innerHeight !== height)) {
      throw new Error("The page moved during capture. Please select the area again.");
    }
    paintStrokes(canvas.getContext("2d"), strokes, { x: scrollX, y: scrollY, scaleX: canvas.width / width, scaleY: canvas.height / height });
    let output = canvas;
    if (mode === "region") {
      const rect = bitmapRegion(region, width, height, canvas.width, canvas.height);
      cropped = document.createElement("canvas");
      cropped.width = rect.width;
      cropped.height = rect.height;
      cropped.getContext("2d").drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      output = cropped;
      canvas.width = canvas.height = 0;
    }
    const blob = await new Promise((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error("Screenshot could not be encoded.")), "image/png"));
    checkAborted(signal);
    if (blob.size > 8 * 1024 * 1024) throw new Error("Screenshot exceeds 8 MB. Capture the visible area instead.");
    const bytes = await blob.arrayBuffer();
    checkAborted(signal);
    return { bytes, width: output.width, height: output.height, mode: full ? "full" : mode === "region" ? "region" : "viewport" };
  } finally {
    // Dropping the JS reference alone delays reclaiming the backing bitmap.
    if (canvas) canvas.width = canvas.height = 0;
    if (cropped) cropped.width = cropped.height = 0;
    clearTimeout(fetchTimeout);
    signal?.removeEventListener("abort", abortFetch);
    releaseRenderer();
  }
}
