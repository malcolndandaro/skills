import test from "node:test";
import assert from "node:assert/strict";

import { StrokeStore, createAnnotations, paintStrokes, selectionRect } from "../src/annotations.js";

let JSDOM = null;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {}
const skip = JSDOM ? false : "jsdom unavailable on this Node version";

function contextSpy() {
  const calls = [];
  const context = {};
  for (const name of ["save", "restore", "scale", "translate", "beginPath", "arc", "fill", "moveTo", "lineTo", "stroke", "clearRect"]) {
    context[name] = (...args) => calls.push([name, ...args]);
  }
  return { context, calls };
}

function pointer(window, type, { id = 1, x = 0, y = 0 } = {}) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: id });
  return event;
}

test("selection rectangles normalize reversed drags and keep the capture inside the page", () => {
  assert.deepEqual(
    selectionRect({ x: 280, y: 190 }, { x: -40, y: 20 }, 240, 160),
    { x: 0, y: 20, width: 240, height: 140 },
  );
  assert.deepEqual(selectionRect({ x: -9, y: 12 }, { x: -2, y: 90 }, 240, 160), { x: 0, y: 12, width: 0, height: 78 });
});

test("drawing history remains bounded and undo or clear frees room for new marks", () => {
  const store = new StrokeStore();
  for (let index = 0; index < 200; index += 1) {
    assert.equal(store.begin(index * 2, 0), true);
    store.finish();
  }
  assert.equal(store.begin(999, 0), false, "the review cannot retain unlimited strokes");
  store.undo();
  assert.equal(store.begin(999, 0), true, "undo makes room for a replacement stroke");
  store.clear();
  assert.deepEqual(store.snapshot(), []);
  assert.equal(store.begin(1, 1), true, "clear releases the bounded history");
});

test("paintStrokes draws dots and lines at document coordinates relative to the captured origin", () => {
  const { context, calls } = contextSpy();
  paintStrokes(context, [
    { points: [{ x: 110, y: 220 }] },
    { points: [{ x: 120, y: 240 }, { x: 160, y: 280 }] },
  ], { x: 100, y: 200, scaleX: 0.5, scaleY: 0.25 });

  assert.deepEqual(calls.slice(0, 3), [["save"], ["scale", 0.5, 0.25], ["translate", -100, -200]]);
  assert.ok(calls.some(([name, x, y]) => name === "arc" && x === 110 && y === 220), "a click produces a visible dot");
  assert.ok(calls.some(([name, x, y]) => name === "moveTo" && x === 120 && y === 240));
  assert.ok(calls.some(([name, x, y]) => name === "lineTo" && x === 160 && y === 280));
  assert.deepEqual(calls.at(-1), ["restore"]);
});

test("Escape cancels area selection, document-space strokes survive scroll, and dispose releases overlay resources", { skip }, async () => {
  const dom = new JSDOM("<!doctype html><html><body><p>Review</p></body></html>", { pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperties(window, {
    innerWidth: { configurable: true, value: 320 },
    innerHeight: { configurable: true, value: 200 },
    scrollX: { configurable: true, writable: true, value: 40 },
    scrollY: { configurable: true, writable: true, value: 80 },
    devicePixelRatio: { configurable: true, value: 1 },
  });
  const canvasContexts = new Map();
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!canvasContexts.has(this)) canvasContexts.set(this, contextSpy());
    return canvasContexts.get(this).context;
  };

  const states = [];
  const shortcuts = [];
  const tool = createAnnotations({
    document: window.document,
    onState: (state) => states.push(state),
    onShortcut: (action) => shortcuts.push(action),
  });
  const host = window.document.querySelector("[data-eh-ui=annotations]");
  const shadow = host.shadowRoot;
  const surface = shadow.querySelector(".surface");
  const canvas = shadow.querySelector("canvas");

  const selection = tool.selectRegion();
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(await selection, null);
  assert.equal(surface.dataset.mode, undefined);

  tool.setDrawing(true);
  surface.dispatchEvent(pointer(window, "pointerdown", { x: 10, y: 20 }));
  surface.dispatchEvent(pointer(window, "pointermove", { x: 46, y: 54 }));
  surface.dispatchEvent(pointer(window, "pointerup", { x: 46, y: 54 }));
  assert.deepEqual(tool.snapshot()[0].points, [{ x: 50, y: 100 }, { x: 86, y: 134 }]);

  window.scrollY = 120;
  window.dispatchEvent(new window.Event("scroll"));
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  const paintCalls = canvasContexts.get(canvas).calls;
  assert.ok(paintCalls.some(([name, x, y]) => name === "translate" && x === -40 && y === -120), "redraw offsets document-space strokes by the new scroll origin");

  tool.dispose();
  assert.equal(window.document.querySelector("[data-eh-ui=annotations]"), null);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "s", metaKey: true, shiftKey: true, bubbles: true }));
  assert.deepEqual(shortcuts, []);
  assert.ok(states.length > 0);
});
