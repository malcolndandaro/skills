import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { targetKey } from "../src/paths.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "human-review-runtime-"));
process.env.HUMAN_REVIEW_STATE_DIR = path.join(tmp, "state");
process.env.HUMAN_REVIEW_NO_REVIEW_GRACE_MS = "40";
const { start } = await import("../src/server.js");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function request(port, token, { method = "GET", route, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.isBuffer(body) ? body : body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port, method, path: route, headers: { "x-human-review-token": token, ...(bytes ? { "content-length": String(bytes.length) } : {}), ...headers } }, (res) => {
      const parts = [];
      res.on("data", (part) => parts.push(part));
      res.on("end", () => resolve({ status: res.statusCode, raw: Buffer.concat(parts) }));
    });
    req.on("error", reject);
    if (bytes) req.write(bytes);
    req.end();
  });
}

const json = (response) => JSON.parse(response.raw.toString());

function ackAndAbandon(port, token, target) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: `/api/poll?target=${encodeURIComponent(target)}&ack=1`, headers: { "x-human-review-token": token } }, (res) => {
      res.resume();
      setTimeout(() => { req.destroy(); resolve(); }, 20);
    });
    req.on("error", resolve);
  });
}

/** Keep an SSE or long-poll response open until the server explicitly closes it. */
function heldRequest(port, token, route) {
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let settled = false;
  const done = new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: route, headers: token ? { "x-human-review-token": token } : {} }, (res) => {
      const parts = [];
      res.on("data", (part) => parts.push(part));
      res.on("end", () => {
        settled = true;
        resolve({ status: res.statusCode, raw: Buffer.concat(parts) });
      });
      res.on("error", reject);
      resolveReady();
    });
    req.on("error", (error) => {
      if (!settled) {
        rejectReady(error);
        reject(error);
      }
    });
  });
  return { ready, done };
}

test("screenshots are private, validated, delivered, and reclaimed after ack", async (t) => {
  const review = await start();
  t.after(() => review.dispose());
  const file = path.join(tmp, "screen.html");
  fs.writeFileSync(file, "<p>Screen</p>");
  const opened = json(await request(review.port, review.token, { method: "POST", route: "/api/session", body: { file }, headers: { "content-type": "application/json" } }));
  const rejected = await request(review.port, review.token, { method: "POST", route: `/api/page/${opened.key}/screenshot?width=2&height=1`, body: PNG, headers: { "content-type": "image/png" } });
  assert.equal(rejected.status, 400);
  const upload = json(await request(review.port, review.token, { method: "POST", route: `/api/page/${opened.key}/screenshot?width=1&height=1&mode=region`, body: PNG, headers: { "content-type": "image/png" } }));
  assert.equal(upload.screenshot.mode, "region");
  assert.equal((await request(review.port, "", { route: upload.preview })).status, 401);
  assert.equal((await request(review.port, review.token, { method: "POST", route: `/api/page/${opened.key}/comment`, body: { kind: "screenshot", quote: "screen", feedback: "Inspect", screenshot: "ss_wrong" }, headers: { "content-type": "application/json" } })).status, 400);
  const comment = json(await request(review.port, review.token, { method: "POST", route: `/api/page/${opened.key}/comment`, body: { kind: "screenshot", quote: "screen", feedback: "Inspect", screenshot: upload.screenshot.id }, headers: { "content-type": "application/json" } }));
  assert.equal(comment.comment.screenshot.id, upload.screenshot.id);
  await request(review.port, review.token, { method: "POST", route: `/api/page/${opened.key}/send`, body: { sessionId: opened.sessionId, note: "" }, headers: { "content-type": "application/json" } });
  const batch = json(await request(review.port, review.token, { route: `/api/poll?target=${encodeURIComponent(file)}` }));
  assert.equal(batch.pages[0].comments[0].screenshot.path, upload.screenshot.path);
  assert.equal(batch.pages[0].comments[0].screenshot.mode, "region");
  await request(review.port, review.token, { method: "DELETE", route: `/api/page/${opened.key}/comment/${comment.comment.id}` });
  assert.equal(fs.existsSync(upload.screenshot.path), true, "a sent batch retains its capture even if the browser removes the comment");
  assert.equal((await request(review.port, review.token, { method: "DELETE", route: `/api/page/${opened.key}/screenshot/${upload.screenshot.id}` })).status, 409);
  await ackAndAbandon(review.port, review.token, file);
  assert.equal(fs.existsSync(upload.screenshot.path), false);
});

test("direct dispose closes live SSE and poll handles while keeping feedback durable", async (t) => {
  const review = await start();
  t.after(() => review.dispose());
  const file = path.join(tmp, "dispose-live.html");
  fs.writeFileSync(file, "<p>Keep this feedback</p>");
  const opened = json(await request(review.port, review.token, {
    method: "POST",
    route: "/api/session",
    body: { file },
    headers: { "content-type": "application/json" },
  }));
  await request(review.port, review.token, {
    method: "POST",
    route: `/api/page/${opened.key}/comment`,
    body: { kind: "selection", quote: "Keep this feedback", feedback: "Persist across shutdown" },
    headers: { "content-type": "application/json" },
  });

  const stream = heldRequest(review.port, "", `/events/${opened.sessionId}`);
  const poll = heldRequest(review.port, review.token, `/api/poll?target=${encodeURIComponent(file)}`);
  await Promise.all([stream.ready, poll.ready]);
  const active = json(await request(review.port, review.token, { route: "/api/diagnostics" }));
  assert.deepEqual({ sessions: active.sessions, connections: active.connections, pollers: active.pollers }, { sessions: 1, connections: 1, pollers: 1 });

  const closed = new Promise((resolve) => review.server.once("close", resolve));
  review.dispose();
  review.dispose();
  const [sseResult, pollResult] = await Promise.all([stream.done, poll.done]);
  await closed;
  assert.equal(sseResult.status, 200);
  assert.equal(pollResult.status, 200);
  assert.equal(review.server.listening, false);

  const replacement = await start();
  t.after(() => replacement.dispose());
  const page = json(await request(replacement.port, replacement.token, { route: `/api/page/${opened.key}` }));
  assert.equal(page.comments.length, 1, "dispose must not discard unsent feedback");
  assert.equal(page.comments[0].feedback, "Persist across shutdown");

  // Leave the shared runtime state as this test found it so the bounded-state
  // check below measures only its own navigation cycle.
  const cleanup = json(await request(replacement.port, replacement.token, {
    method: "POST",
    route: "/api/session",
    body: { file },
    headers: { "content-type": "application/json" },
  }));
  await request(replacement.port, replacement.token, { method: "POST", route: `/api/page/${opened.key}/discard` });
  await request(replacement.port, replacement.token, { method: "POST", route: `/api/session/${cleanup.sessionId}/end` });
});

test("navigation and closed polls return server diagnostics to a bounded baseline", async (t) => {
  const review = await start();
  t.after(() => review.dispose());
  const large = "x".repeat(512 * 1024);
  const files = Array.from({ length: 14 }, (_, index) => path.join(tmp, `page-${index}.html`));
  files.forEach((file, index) => fs.writeFileSync(file, `<html><body><p>Page ${index}</p>${large}<a href="page-${Math.min(index + 1, files.length - 1)}.html">next</a></body></html>`));
  const opened = json(await request(review.port, review.token, { method: "POST", route: "/api/session", body: { file: files[0] }, headers: { "content-type": "application/json" } }));
  for (let index = 1; index < files.length; index += 1) {
    await request(review.port, review.token, { method: "POST", route: `/api/session/${opened.sessionId}/navigate`, body: { href: `page-${index}.html` }, headers: { "content-type": "application/json" } });
    const metrics = json(await request(review.port, review.token, { route: "/api/diagnostics" }));
    assert.ok(metrics.watchedPages <= 2, `watched pages grew to ${metrics.watchedPages}`);
    assert.ok(metrics.heapUsed > 0 && metrics.rss > 0);
  }
  const historical = files[4];
  const restored = json(await request(review.port, review.token, {
    method: "POST",
    route: `/api/session/${opened.sessionId}/goto`,
    body: { key: targetKey(historical), target: historical },
    headers: { "content-type": "application/json" },
  }));
  assert.equal(restored.key, targetKey(historical));
  const restoredRaw = json(await request(review.port, review.token, { route: `/api/page/${restored.key}/raw` }));
  assert.match(restoredRaw.html, /Page 4/);
  assert.ok(json(await request(review.port, review.token, { route: "/api/diagnostics" })).watchedPages <= 2);
  const polls = await Promise.all(Array.from({ length: 12 }, (_, index) => request(review.port, review.token, { route: `/api/poll?target=${encodeURIComponent(`${files[0]}.${index}`)}` })));
  assert.ok(polls.every((response) => response.status === 200));
  await request(review.port, review.token, { method: "POST", route: `/api/session/${opened.sessionId}/end` });
  const metrics = json(await request(review.port, review.token, { route: "/api/diagnostics" }));
  assert.deepEqual({ sessions: metrics.sessions, pollers: metrics.pollers, pollTargets: metrics.pollTargets, watchedPages: metrics.watchedPages }, { sessions: 0, pollers: 0, pollTargets: 0, watchedPages: 0 });
  const state = JSON.parse(fs.readFileSync(path.join(process.env.HUMAN_REVIEW_STATE_DIR, "state.json"), "utf8"));
  assert.equal(Object.keys(state.pages).length, 0);
});

test("file reviews reject documents above the same 24MB cap as localhost pages", async (t) => {
  const review = await start();
  t.after(() => review.dispose());
  const file = path.join(tmp, "too-large.html");
  fs.writeFileSync(file, Buffer.alloc(24 * 1024 * 1024 + 1, 0x20));
  const response = await request(review.port, review.token, {
    method: "POST",
    route: "/api/session",
    body: { file },
    headers: { "content-type": "application/json" },
  });
  assert.equal(response.status, 413);
  assert.match(json(response).error, /larger than 24MB/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
