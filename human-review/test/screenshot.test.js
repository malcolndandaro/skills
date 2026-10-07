import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { bitmapRegion, captureSize } from "../src/screenshot.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function withCaptureDom(run) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://artifact.test/" });
  const saved = new Map();
  for (const key of ["window", "document", "DOMException", "getComputedStyle"]) {
    saved.set(key, { exists: Object.prototype.hasOwnProperty.call(globalThis, key), value: globalThis[key] });
  }
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMException = dom.window.DOMException;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperties(dom.window, {
    innerWidth: { configurable: true, value: 240 },
    innerHeight: { configurable: true, value: 160 },
    devicePixelRatio: { configurable: true, value: 1 },
  });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    save() {}, scale() {}, translate() {}, restore() {},
    beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {},
  });
  dom.window.HTMLCanvasElement.prototype.toBlob = function toBlob(done) {
    done(new Blob(["capture"], { type: "image/png" }));
  };
  try {
    await run(dom.window);
  } finally {
    dom.window.close();
    for (const [key, value] of saved) {
      if (value.exists) globalThis[key] = value.value;
      else delete globalThis[key];
    }
  }
}

async function freshScreenshotModule() {
  const url = new URL("../src/screenshot.js", import.meta.url);
  url.searchParams.set("test", `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function installRenderer(window, renderer) {
  const append = window.document.head.append.bind(window.document.head);
  let loads = 0;
  window.document.head.append = (...nodes) => {
    for (const node of nodes) {
      if (node.tagName !== "SCRIPT" || !node.src.includes("html-to-image.js")) continue;
      loads += 1;
      window.htmlToImage = renderer();
      queueMicrotask(() => node.onload?.());
    }
    return append(...nodes);
  };
  return () => loads;
}

test("large screenshot bitmaps stay under the pixel and browser edge limits", () => {
  for (const [width, height] of [[1440, 900], [1920, 100000], [100000, 100000]]) {
    const size = captureSize(width, height, 3);
    assert.ok(width * size.scale * height * size.scale <= 12_000_000.01);
    assert.ok(Math.max(width, height) * size.scale <= 16384);
  }
  assert.throws(() => captureSize(0, 20), /no capture area/);
  assert.throws(() => captureSize(Infinity, 20), /no capture area/);
});

test("region crops round outward after DPR downsampling and never exceed bitmap bounds", () => {
  assert.deepEqual(
    bitmapRegion({ x: 951.1, y: 1900.2, width: 300, height: 300 }, 1200, 2400, 600, 1200),
    { x: 475, y: 950, width: 125, height: 151 },
  );
  assert.throws(
    () => bitmapRegion({ x: 1500, y: 10, width: 20, height: 20 }, 1200, 2400, 600, 1200),
    /outside the page/,
  );
});

test("screenshot renderer releases its cached vendor namespace and reloads cleanly", { concurrency: false }, async () => {
  await withCaptureDom(async (window) => {
    const artifactNamespace = { artifact: true };
    window.htmlToImage = artifactNamespace;
    const canvases = [];
    const loads = installRenderer(window, () => ({
      toCanvas: async () => {
        const canvas = window.document.createElement("canvas");
        canvas.width = 240;
        canvas.height = 160;
        canvases.push(canvas);
        return canvas;
      },
    }));
    const { capturePage } = await freshScreenshotModule();

    await capturePage();
    assert.equal(window.htmlToImage, artifactNamespace, "restores the artifact namespace after success");
    assert.equal(window.document.querySelectorAll("script[data-eh-sdk]").length, 0, "removes the injected vendor script");
    assert.deepEqual(canvases.map((canvas) => [canvas.width, canvas.height]), [[0, 0]], "releases the rendered bitmap after success");

    await capturePage();
    assert.equal(loads(), 2, "loads a new renderer for each capture instead of retaining its cache");
    assert.equal(window.htmlToImage, artifactNamespace);
  });
});

test("screenshot renderer releases vendor references after abort and load error", { concurrency: false }, async () => {
  await withCaptureDom(async (window) => {
    const artifactNamespace = { artifact: true };
    window.htmlToImage = artifactNamespace;
    const started = deferred();
    const finish = deferred();
    let broken = false;
    const loads = installRenderer(window, () => broken ? {} : ({
      toCanvas: async () => {
        started.resolve();
        return finish.promise;
      },
    }));
    const { capturePage } = await freshScreenshotModule();
    const controller = new AbortController();
    const pending = capturePage("viewport", { signal: controller.signal });
    await started.promise;
    controller.abort();
    const canvas = window.document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 160;
    finish.resolve(canvas);
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(window.htmlToImage, artifactNamespace, "restores the artifact namespace after abort");
    assert.equal(window.document.querySelectorAll("script[data-eh-sdk]").length, 0);
    assert.deepEqual([canvas.width, canvas.height], [0, 0], "releases the rendered bitmap after abort");

    broken = true;
    await assert.rejects(capturePage(), /renderer could not be loaded/);
    assert.equal(loads(), 2, "the failed load did not reuse the aborted renderer");
    assert.equal(window.htmlToImage, artifactNamespace, "restores the artifact namespace after a load error");
    assert.equal(window.document.querySelectorAll("script[data-eh-sdk]").length, 0);
  });
});

test("a renderer that never settles gives up on abort and on timeout", { concurrency: false }, async () => {
  await withCaptureDom(async (window) => {
    const started = [];
    installRenderer(window, () => ({
      // Like html-to-image when an image decode rejects: the promise never settles.
      toCanvas: () => {
        started.push(Date.now());
        return new Promise(() => {});
      },
    }));
    const { capturePage } = await freshScreenshotModule();

    const controller = new AbortController();
    const pending = capturePage("viewport", { signal: controller.signal });
    while (!started.length) await new Promise((done) => setTimeout(done, 5));
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" }, "cancel settles without waiting on the renderer");
    assert.equal(window.document.querySelectorAll("script[data-eh-sdk]").length, 0);

    const t0 = Date.now();
    await assert.rejects(capturePage("viewport", { renderTimeoutMs: 50 }), /took too long to render/);
    assert.ok(Date.now() - t0 < 2000, "the timeout ends the capture");
    assert.equal(window.document.querySelectorAll("script[data-eh-sdk]").length, 0);
  });
});

test("a canvas that arrives after the capture gave up is released", { concurrency: false }, async () => {
  await withCaptureDom(async (window) => {
    const finish = deferred();
    installRenderer(window, () => ({ toCanvas: () => finish.promise }));
    const { capturePage } = await freshScreenshotModule();

    await assert.rejects(capturePage("viewport", { renderTimeoutMs: 20 }), /took too long/);
    const canvas = window.document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 160;
    finish.resolve(canvas);
    await new Promise((done) => setTimeout(done, 0));
    assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  });
});
