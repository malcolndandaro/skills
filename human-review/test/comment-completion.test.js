import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "human-review-completion-"));
process.env.HUMAN_REVIEW_STATE_DIR = path.join(tmp, "state");

const { start } = await import("../src/server.js");
const run = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function request(port, token, { method = "GET", route, body } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: "127.0.0.1",
      port,
      method,
      path: route,
      headers: {
        "x-human-review-token": token,
        ...(bytes ? { "content-type": "application/json", "content-length": String(bytes.length) } : {}),
      },
    }, (res) => {
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

async function open(review, file) {
  return json(await request(review.port, review.token, { method: "POST", route: "/api/session", body: { file } }));
}

async function addComment(review, key, quote, feedback) {
  return json(await request(review.port, review.token, {
    method: "POST",
    route: `/api/page/${key}/comment`,
    body: { kind: "selection", quote, feedback },
  }));
}

async function send(review, key, sessionId) {
  return request(review.port, review.token, { method: "POST", route: `/api/page/${key}/send`, body: { sessionId, note: "" } });
}

async function acknowledge(review, target) {
  return request(review.port, review.token, { method: "POST", route: "/api/ack", body: { target } });
}

async function page(review, key) {
  return json(await request(review.port, review.token, { route: `/api/page/${key}` }));
}

test("acknowledging delivered feedback archives a resolved comment and clears the active item", async (t) => {
  const review = await start();
  t.after(() => review.dispose());
  const file = path.join(tmp, "resolved-comment.html");
  fs.writeFileSync(file, "<p>Remove this sentence.</p>");

  const opened = await open(review, file);
  const added = await addComment(review, opened.key, "Remove this sentence.", "Delete this sentence.");
  await send(review, opened.key, opened.sessionId);
  const delivered = json(await request(review.port, review.token, { route: `/api/poll?target=${encodeURIComponent(file)}` }));
  assert.equal(delivered.pages[0].comments[0].id, added.comment.id);

  fs.writeFileSync(file, "<p>Replacement text.</p>");
  const beforeAcknowledgement = await page(review, opened.key);
  assert.equal(beforeAcknowledgement.comments[0].id, added.comment.id, "rewriting a file must not complete feedback on its own");
  assert.equal(beforeAcknowledgement.comments[0].sent, true);
  assert.deepEqual(beforeAcknowledgement.completedComments, []);

  const acknowledgement = await acknowledge(review, file);
  assert.equal(acknowledgement.status, 200);
  assert.equal(json(acknowledgement).status, "acknowledged");

  const current = await page(review, opened.key);
  assert.deepEqual(current.comments, []);
  assert.equal(current.completedComments.length, 1);
  assert.equal(current.completedComments[0].id, added.comment.id);
  assert.equal(current.completedComments[0].feedback, "Delete this sentence.");
  assert.ok(Number.isFinite(current.completedComments[0].resolvedAt));
});

test("acknowledging undelivered feedback leaves it active and deliverable", async (t) => {
  const review = await start();
  t.after(() => review.dispose());
  const file = path.join(tmp, "undelivered-comment.html");
  fs.writeFileSync(file, "<p>Still pending.</p>");
  const opened = await open(review, file);
  const added = await addComment(review, opened.key, "Still pending.", "Handle this later.");

  const acknowledgement = await acknowledge(review, file);
  assert.equal(acknowledgement.status, 200);
  assert.equal(json(acknowledgement).status, "nothing-to-acknowledge");
  const beforeSend = await page(review, opened.key);
  assert.equal(beforeSend.comments[0].id, added.comment.id);
  assert.equal(beforeSend.comments[0].sent, false);
  assert.deepEqual(beforeSend.completedComments, []);

  await send(review, opened.key, opened.sessionId);
  const delivered = json(await request(review.port, review.token, { route: `/api/poll?target=${encodeURIComponent(file)}` }));
  assert.equal(delivered.pages[0].comments[0].id, added.comment.id);
});

test("acknowledging a queued follow-up archives only the applied delivery", async (t) => {
  const review = await start();
  t.after(() => review.dispose());
  const file = path.join(tmp, "queued-comment.html");
  fs.writeFileSync(file, "<p>First sentence.</p><p>Second sentence.</p>");
  const opened = await open(review, file);
  const first = await addComment(review, opened.key, "First sentence.", "Remove the first sentence.");
  await send(review, opened.key, opened.sessionId);
  const firstBatch = json(await request(review.port, review.token, { route: `/api/poll?target=${encodeURIComponent(file)}` }));
  assert.equal(firstBatch.pages[0].comments[0].id, first.comment.id);

  const second = await addComment(review, opened.key, "Second sentence.", "Rework the second sentence.");
  await send(review, opened.key, opened.sessionId);
  fs.writeFileSync(file, "<p>Second sentence.</p>");

  const acknowledgement = await acknowledge(review, file);
  assert.equal(acknowledgement.status, 200);
  assert.equal(json(acknowledgement).status, "acknowledged");
  const current = await page(review, opened.key);
  assert.deepEqual(current.completedComments.map((comment) => comment.id), [first.comment.id]);
  assert.deepEqual(current.comments.map((comment) => comment.id), [second.comment.id]);
  assert.equal(current.comments[0].sent, true, "the queued follow-up is already in durable transport");

  const followUp = json(await request(review.port, review.token, { route: `/api/poll?target=${encodeURIComponent(file)}` }));
  assert.deepEqual(followUp.pages[0].comments.map((comment) => comment.id), [second.comment.id]);
});

test("a revision after delivery keeps the original completed id and the rewritten feedback active", async (t) => {
  const review = await start();
  t.after(() => review.dispose());
  const file = path.join(tmp, "revised-comment.html");
  fs.writeFileSync(file, "<p>Original sentence.</p>");
  const opened = await open(review, file);
  const added = await addComment(review, opened.key, "Original sentence.", "Remove it.");
  await send(review, opened.key, opened.sessionId);
  await request(review.port, review.token, { route: `/api/poll?target=${encodeURIComponent(file)}` });

  const revision = json(await request(review.port, review.token, {
    method: "PATCH",
    route: `/api/page/${opened.key}/comment/${added.comment.id}`,
    body: { feedback: "Instead, rewrite it." },
  }));
  assert.equal(revision.delivery, "resend");
  const revisionId = revision.page.comments[0].id;
  assert.notEqual(revisionId, added.comment.id);
  fs.writeFileSync(file, "<p>Replacement sentence.</p>");

  const acknowledgement = await acknowledge(review, file);
  assert.equal(acknowledgement.status, 200);
  const current = await page(review, opened.key);
  assert.deepEqual(current.completedComments.map((comment) => comment.id), [added.comment.id]);
  assert.deepEqual(current.comments.map((comment) => comment.id), [revisionId]);
  assert.equal(current.comments[0].feedback, "Instead, rewrite it.");
});

test("completed history keeps the newest fifty comments and survives a server reload", async (t) => {
  let review = await start();
  t.after(() => review.dispose());
  const file = path.join(tmp, "bounded-history.html");
  const sentences = Array.from({ length: 51 }, (_, index) => `Sentence ${index}.`);
  fs.writeFileSync(file, sentences.map((sentence) => `<p>${sentence}</p>`).join(""));
  const opened = await open(review, file);
  const added = [];
  for (const sentence of sentences) added.push(await addComment(review, opened.key, sentence, `Resolve ${sentence}`));
  await send(review, opened.key, opened.sessionId);
  const delivered = json(await request(review.port, review.token, { route: `/api/poll?target=${encodeURIComponent(file)}` }));
  assert.equal(delivered.pages[0].comments.length, 51);
  fs.writeFileSync(file, "<p>All resolved.</p>");
  const acknowledgement = await acknowledge(review, file);
  assert.equal(acknowledgement.status, 200);
  let current = await page(review, opened.key);
  assert.equal(current.completedComments.length, 50);
  assert.deepEqual(current.completedComments.map((comment) => comment.id), added.slice(1).map((result) => result.comment.id));

  review.dispose();
  review = await start();
  current = await page(review, opened.key);
  assert.equal(current.completedComments.length, 50);
  assert.deepEqual(current.completedComments.map((comment) => comment.id), added.slice(1).map((result) => result.comment.id));
});

test("CLI ack exits immediately without starting a stopped server", async () => {
  const state = path.join(tmp, "cli-ack-state");
  const file = path.join(tmp, "cli-ack.html");
  fs.writeFileSync(file, "<p>Nothing to acknowledge.</p>");
  const { stdout } = await run(process.execPath, [cli, "ack", file], {
    env: { ...process.env, HUMAN_REVIEW_STATE_DIR: state },
  });
  assert.equal(JSON.parse(stdout).status, "nothing-to-acknowledge");
  assert.equal(fs.existsSync(path.join(state, "server.json")), false);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
