import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";

import { createServer } from "../src/server.js";
import { shellQuote } from "../src/setup.js";

test("a review keeps the CLI invocation resolved when its server starts", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "human-review-command-"));
  const originalStateDir = process.env.HUMAN_REVIEW_STATE_DIR;
  const originalCommand = process.env.HUMAN_REVIEW_COMMAND;
  const state = path.join(tmp, "state");
  const file = path.join(tmp, "review.html");
  const initialCommand = path.join(tmp, "managed human-review");
  const laterCommand = path.join(tmp, "different human-review");

  fs.writeFileSync(file, "<p>Review me</p>");

  process.env.HUMAN_REVIEW_STATE_DIR = state;
  process.env.HUMAN_REVIEW_COMMAND = initialCommand;
  const review = createServer();
  review.server.listen(0, "127.0.0.1");
  await once(review.server, "listening");

  try {
    process.env.HUMAN_REVIEW_COMMAND = laterCommand;
    const port = review.server.address().port;
    const headers = { "x-human-review-token": review.token, "content-type": "application/json" };
    const opened = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ file }),
    }).then((response) => response.json());
    const stateResponse = await fetch(`http://127.0.0.1:${port}/api/session/${opened.sessionId}/page`, { headers }).then((response) =>
      response.json(),
    );

    assert.ok(stateResponse.page.pollCommand.startsWith(`${shellQuote(initialCommand)} poll `));
  } finally {
    const closed = once(review.server, "close");
    review.dispose();
    await closed;
    if (originalStateDir === undefined) delete process.env.HUMAN_REVIEW_STATE_DIR;
    else process.env.HUMAN_REVIEW_STATE_DIR = originalStateDir;
    if (originalCommand === undefined) delete process.env.HUMAN_REVIEW_COMMAND;
    else process.env.HUMAN_REVIEW_COMMAND = originalCommand;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
