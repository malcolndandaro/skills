/** Temporary review drawings. Coordinates are CSS pixels in the document. */
export const DRAW_COLOR = "#e23d37";
export const DRAW_WIDTH = 4;
export const MAX_DRAW_STROKES = 200;
export const MAX_DRAW_POINTS = 20000;
const MAX_STROKE_POINTS = 4000;

/** Normalize a drag in either direction and clip it to the visible page. */
export function selectionRect(start, end, width, height) {
  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  const left = clamp(Math.min(start.x, end.x), width);
  const top = clamp(Math.min(start.y, end.y), height);
  const right = clamp(Math.max(start.x, end.x), width);
  const bottom = clamp(Math.max(start.y, end.y), height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Bound drawing history without retaining a bitmap for every undo step. */
export class StrokeStore {
  constructor() {
    this.strokes = [];
    this.current = null;
    this.points = 0;
  }

  begin(x, y) {
    this.finish();
    if (this.strokes.length >= MAX_DRAW_STROKES || this.points >= MAX_DRAW_POINTS) return false;
    this.current = { points: [{ x, y }] };
    this.strokes.push(this.current);
    this.points += 1;
    return true;
  }

  append(x, y) {
    if (!this.current) return "idle";
    const points = this.current.points;
    const last = points.at(-1);
    if (Math.hypot(x - last.x, y - last.y) < 1.5) return "unchanged";
    if (points.length >= MAX_STROKE_POINTS || this.points >= MAX_DRAW_POINTS) return "limit";
    points.push({ x, y });
    this.points += 1;
    return "added";
  }

  finish() { this.current = null; }

  undo() {
    this.finish();
    const removed = this.strokes.pop();
    if (removed) this.points -= removed.points.length;
  }

  clear() {
    this.strokes.length = 0;
    this.current = null;
    this.points = 0;
  }

  snapshot() {
    return this.strokes.map((stroke) => ({ points: stroke.points.slice() }));
  }
}

/** Paint vectors over a viewport or screenshot using its document origin. */
export function paintStrokes(context, strokes, { x = 0, y = 0, scaleX = 1, scaleY = scaleX } = {}) {
  context.save();
  context.scale(scaleX, scaleY);
  context.translate(-x, -y);
  context.strokeStyle = context.fillStyle = DRAW_COLOR;
  context.lineWidth = DRAW_WIDTH;
  context.lineCap = context.lineJoin = "round";
  for (const stroke of strokes) {
    const points = stroke.points;
    if (!points.length) continue;
    context.beginPath();
    if (points.length === 1) {
      context.arc(points[0].x, points[0].y, DRAW_WIDTH / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) context.lineTo(points[i].x, points[i].y);
      context.stroke();
    }
  }
  context.restore();
}

/** Install a single viewport-sized overlay, independent of editable source. */
export function createAnnotations({ document, onState, onShortcut }) {
  const win = document.defaultView;
  const store = new StrokeStore();
  const host = document.createElement("div");
  host.setAttribute("data-eh-ui", "annotations");
  host.setAttribute("contenteditable", "false");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .surface { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; outline: none; user-select: none; }
      .surface[data-mode] { pointer-events: auto; }
      .surface[data-mode=draw] { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14'%3E%3Ccircle cx='7' cy='7' r='4' fill='%23e23d37' stroke='white'/%3E%3C/svg%3E") 7 7, crosshair; touch-action: none; }
      .surface[data-mode=select] { cursor: crosshair; touch-action: none; }
      .surface[data-mode=busy] { cursor: wait; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
      .region { display: none; position: absolute; box-sizing: border-box; border: 2px solid #e23d37; box-shadow: 0 0 0 200vmax rgba(0,0,0,.2); pointer-events: none; }
      .hint { display: none; position: absolute; top: 12px; left: 50%; transform: translateX(-50%); padding: 7px 12px; border-radius: 6px; color: #fff; background: #1b1a16; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; pointer-events: none; white-space: nowrap; }
      [data-mode=select] .hint, [data-mode=draw] .hint { display: block; }
    </style>
    <div class="surface" tabindex="-1" aria-label="Review drawing and area selection">
      <canvas width="0" height="0" aria-hidden="true"></canvas>
      <div class="region"></div><div class="hint"></div>
    </div>`;
  document.documentElement.append(host);
  const surface = shadow.querySelector(".surface");
  const canvas = shadow.querySelector("canvas");
  const box = shadow.querySelector(".region");
  const hint = shadow.querySelector(".hint");
  const cleanups = [];
  let context = null;
  let active = false;
  let busy = false;
  let disposed = false;
  let pointer = null;
  let selection = null;
  let frame = null;
  let view = null;

  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };
  const notify = (error) => {
    if (!disposed) onState({ active, canUndo: store.strokes.length > 0, count: store.strokes.length, ...(error ? { error } : {}) });
  };
  const mode = () => {
    const value = selection ? "select" : busy ? "busy" : active ? "draw" : "";
    if (value) surface.dataset.mode = value;
    else delete surface.dataset.mode;
    hint.textContent = selection ? "Drag to select an area. Esc to cancel." : "Red pencil. Click for a dot. Esc to finish.";
    if (value && value !== "busy") surface.focus({ preventScroll: true });
  };
  const stopPointer = () => {
    const id = pointer?.id;
    pointer = null;
    store.finish();
    try { if (id !== undefined && surface.hasPointerCapture?.(id)) surface.releasePointerCapture(id); } catch {}
  };
  const releaseCanvas = () => {
    canvas.width = canvas.height = 0;
    context = view = null;
  };
  const redraw = () => {
    frame = null;
    if (disposed) return;
    if (!store.strokes.length) { releaseCanvas(); return; }
    const width = win.innerWidth;
    const height = win.innerHeight;
    const scale = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (width * height)), 16384 / width, 16384 / height);
    const bitmapWidth = Math.max(1, Math.floor(width * scale));
    const bitmapHeight = Math.max(1, Math.floor(height * scale));
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
    }
    context ||= canvas.getContext("2d");
    if (!context) throw new Error("Drawing is not supported in this browser.");
    context.clearRect(0, 0, canvas.width, canvas.height);
    view = { x: win.scrollX, y: win.scrollY, scaleX: canvas.width / width, scaleY: canvas.height / height };
    paintStrokes(context, store.strokes, view);
  };
  const queueRedraw = () => {
    if (frame === null && !disposed && store.strokes.length) frame = win.requestAnimationFrame(redraw);
  };
  const cancelSelection = () => selection?.settle(null);
  const setDrawing = (enabled) => {
    if (disposed || selection || busy) return;
    stopPointer();
    active = Boolean(enabled);
    mode();
    notify();
  };
  const undo = () => {
    if (busy || selection || disposed) return;
    stopPointer();
    store.undo();
    redraw();
    notify();
  };
  const clear = () => {
    if (busy || selection || disposed) return;
    stopPointer();
    store.clear();
    releaseCanvas();
    notify();
  };
  const limit = () => {
    setDrawing(false);
    notify("Drawing limit reached. Clear drawings to continue.");
  };
  const localPoint = (event) => ({ x: Math.max(0, Math.min(win.innerWidth, event.clientX)), y: Math.max(0, Math.min(win.innerHeight, event.clientY)) });
  const showRegion = (rect) => {
    box.style.display = "block";
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  };

  listen(surface, "pointerdown", (event) => {
    if ((!active && !selection) || event.button !== 0 || pointer) return;
    event.preventDefault();
    event.stopPropagation();
    const point = localPoint(event);
    if (active && !selection && !store.begin(point.x + win.scrollX, point.y + win.scrollY)) { limit(); return; }
    pointer = { id: event.pointerId, start: point, scrollX: win.scrollX, scrollY: win.scrollY };
    try { surface.setPointerCapture(event.pointerId); } catch {}
    if (selection) showRegion(selectionRect(point, point, win.innerWidth, win.innerHeight));
    else {
      try { redraw(); } catch (error) { store.undo(); releaseCanvas(); setDrawing(false); notify(error.message); }
    }
  });
  const move = (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = localPoint(event);
    if (selection) { showRegion(selectionRect(pointer.start, point, win.innerWidth, win.innerHeight)); return; }
    const previous = store.current?.points.at(-1);
    const result = store.append(point.x + win.scrollX, point.y + win.scrollY);
    if (result === "limit") { limit(); return; }
    if (result === "added") {
      if (!view || view.x !== win.scrollX || view.y !== win.scrollY) redraw();
      else paintStrokes(context, [{ points: [previous, store.current.points.at(-1)] }], view);
    }
  };
  listen(surface, "pointermove", move);
  listen(surface, "pointerup", (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    move(event);
    if (!pointer) return;
    const start = pointer.start;
    stopPointer();
    if (selection) {
      const rect = selectionRect(start, localPoint(event), win.innerWidth, win.innerHeight);
      if (rect.width < 3 || rect.height < 3) {
        box.style.display = "none";
        hint.textContent = "Drag an area at least 3 × 3 pixels. Esc to cancel.";
      } else selection.settle(rect);
    } else notify();
  });
  listen(surface, "pointercancel", () => {
    if (pointer && !selection) store.undo();
    stopPointer();
    box.style.display = "none";
    redraw();
    notify();
  });
  listen(surface, "lostpointercapture", () => {
    if (!pointer) return;
    stopPointer();
    box.style.display = "none";
    notify();
  });
  // Mouse compatibility events must not create a comment for the overlay.
  for (const type of ["mousedown", "mouseup", "click", "dblclick", "contextmenu"]) listen(surface, type, (event) => { event.preventDefault(); event.stopPropagation(); });
  listen(surface, "wheel", (event) => {
    if (selection || busy || pointer) event.preventDefault();
  }, { passive: false });
  listen(win, "scroll", () => {
    if (selection && pointer && (pointer.scrollX !== win.scrollX || pointer.scrollY !== win.scrollY)) {
      stopPointer();
      box.style.display = "none";
      hint.textContent = "Page moved. Drag to select again. Esc to cancel.";
    }
    queueRedraw();
  }, { passive: true });
  listen(win, "resize", () => {
    if (selection) cancelSelection();
    queueRedraw();
  });
  listen(win, "keydown", (event) => {
    if (!active && !selection && !busy) return;
    const meta = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      cancelSelection();
      if (busy) onShortcut("cancel");
      else setDrawing(false);
    } else if (meta && event.key.toLowerCase() === "z" && active && !selection && !busy) undo();
    else if (meta && event.shiftKey && event.key.toLowerCase() === "s" && !selection && !busy) onShortcut("capture");
    else if (meta && event.key === "Enter" && !event.isComposing && !selection && !busy) onShortcut("send");
    else if (event.key === "Tab") return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  const selectRegion = (signal) => {
    if (disposed || selection || signal?.aborted) return Promise.resolve(null);
    stopPointer();
    active = false;
    notify();
    return new Promise((resolve) => {
      const abort = () => cancelSelection();
      selection = { settle(rect) {
        if (!selection) return;
        selection = null;
        signal?.removeEventListener("abort", abort);
        stopPointer();
        box.style.display = "none";
        mode();
        resolve(rect);
      } };
      signal?.addEventListener("abort", abort, { once: true });
      mode();
    });
  };

  notify();
  return {
    get active() { return active; },
    setDrawing, undo, clear, selectRegion,
    snapshot: () => store.snapshot(),
    setBusy(value) { busy = Boolean(value); stopPointer(); active = false; mode(); notify(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelSelection();
      stopPointer();
      if (frame !== null) win.cancelAnimationFrame(frame);
      frame = null;
      for (const cleanup of cleanups.splice(0)) cleanup();
      store.clear();
      releaseCanvas();
      host.remove();
    },
  };
}
