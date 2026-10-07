import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "human-review-concurrent-"));
process.env.HUMAN_REVIEW_STATE_DIR = path.join(tmp, "state");

const { Store } = await import("../src/state.js");

function page(name) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, `<p>${name}</p>`);
  return file;
}

test("a second server does not wipe the first server's comments", () => {
  const alpha = new Store();
  const a = alpha.openPage(page("alpha.html"), "<p>a</p>");
  alpha.addComment(a.key, { id: "c1", feedback: "from the first server" });

  // A second process starts, sees alpha's state, and adds a page of its own.
  const beta = new Store();
  const b = beta.openPage(page("beta.html"), "<p>b</p>");
  beta.addComment(b.key, { id: "c2", feedback: "from the second server" });

  // The first server keeps working against its own in-memory copy.
  alpha.addComment(a.key, { id: "c3", feedback: "still going" });

  const final = new Store();
  assert.ok(final.page(a.key), "the first server's page survived");
  assert.ok(final.page(b.key), "the second server's page survived");
  assert.deepEqual(
    final.page(a.key).comments.map((c) => c.id),
    ["c1", "c3"]
  );
  assert.deepEqual(
    final.page(b.key).comments.map((c) => c.id),
    ["c2"]
  );
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
