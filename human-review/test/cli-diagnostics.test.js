import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "human-review-doctor-"));
process.env.HUMAN_REVIEW_STATE_DIR = path.join(tmp, "state");
const { start } = await import("../src/server.js");
const { Store } = await import("../src/state.js");
const run = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

async function command(name) {
  const { stdout } = await run(process.execPath, [cli, name], { env: process.env });
  return JSON.parse(stdout);
}

test("doctor never starts a server and stop preserves pending feedback", async (t) => {
  assert.equal((await command("doctor")).server_running, false);
  assert.equal(fs.existsSync(process.env.HUMAN_REVIEW_STATE_DIR), false);
  const server = await start(0);
  t.after(() => server.dispose());
  const file = path.join(tmp, "review.html");
  fs.writeFileSync(file, "<p>Review this.</p>");
  const headers = { "x-human-review-token": server.token, "content-type": "application/json" };
  const opened = await (await fetch(`http://127.0.0.1:${server.port}/api/session`, { method: "POST", headers, body: JSON.stringify({ target: file }) })).json();
  await fetch(`http://127.0.0.1:${server.port}/api/page/${opened.key}/comment`, { method: "POST", headers, body: JSON.stringify({ quote: "Review this", feedback: "Make it shorter." }) });
  const doctor = await command("doctor");
  assert.equal(doctor.sessions, 1);
  assert.ok(doctor.rss_mib > 0);
  const recordPath = path.join(process.env.HUMAN_REVIEW_STATE_DIR, "server.json");
  const record = JSON.parse(fs.readFileSync(recordPath));
  fs.writeFileSync(recordPath, JSON.stringify({ ...record, protocol: 0 }));
  await assert.rejects(run(process.execPath, [cli, file], { env: process.env }), (error) => {
    assert.match(error.stderr, /older human-review server.*human-review stop/);
    return true;
  });
  assert.equal((await command("doctor")).sessions, 1, "an upgrade must leave active reviews and their stored feedback intact");
  fs.writeFileSync(recordPath, JSON.stringify(record));
  await command("stop");
  assert.equal((await command("doctor")).server_running, false);
  assert.equal(new Store().page(opened.key).comments[0].feedback, "Make it shorter.");
});
