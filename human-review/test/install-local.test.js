import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installLocal, marker } from "../scripts/install-local.mjs";

const commandPath = (home) => path.join(home, ".local", "bin", "human-review");
const skillPath = (home, agent) => path.join(home, agent, "skills", "human-review");
const backupRoot = (home) => path.join(home, ".local", "state", "human-review", "skill-backups");

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function makeCanonicalRoot(home) {
  const root = path.join(home, "canonical-human-review");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "SKILL.md"), "canonical skill\n");
  fs.writeFileSync(path.join(root, "src", "cli.js"), "// test CLI\n");
  return fs.realpathSync(root);
}

test("local installer backs up old skills, links the canonical skill, and is idempotent", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "human-review-install-"));
  try {
    const canonicalRoot = makeCanonicalRoot(home);
    const wrapper = commandPath(home);
    fs.mkdirSync(path.dirname(wrapper), { recursive: true });
    fs.writeFileSync(wrapper, `#!/bin/sh\n${marker}\nexec old-runtime\n`);

    const oldDirectory = skillPath(home, ".claude");
    fs.mkdirSync(oldDirectory, { recursive: true });
    fs.writeFileSync(path.join(oldDirectory, "SKILL.md"), "old Claude skill\n");
    const oldLinkTarget = path.join(home, "old-codex-skill");
    fs.mkdirSync(oldLinkTarget, { recursive: true });
    fs.writeFileSync(path.join(oldLinkTarget, "SKILL.md"), "old Codex skill\n");
    const oldLink = skillPath(home, ".codex");
    fs.mkdirSync(path.dirname(oldLink), { recursive: true });
    fs.symlinkSync(oldLinkTarget, oldLink, "dir");

    const result = installLocal({ root: canonicalRoot, home, executable: "/test/node" });
    assert.equal(result.changed, true);
    assert.ok(result.backup);
    assert.equal(isInside(result.backup, backupRoot(home)), true);
    assert.equal(isInside(result.backup, canonicalRoot), false, "backups must stay outside the discoverable skill source");
    assert.equal(fs.existsSync(path.join(canonicalRoot, "output", "skill-backups")), false);
    assert.match(fs.readFileSync(wrapper, "utf8"), /\/test\/node/);
    assert.match(fs.readFileSync(wrapper, "utf8"), new RegExp(`${canonicalRoot.replaceAll("/", "\\/")}\/src\/cli\\.js`));
    for (const agent of [".claude", ".codex", ".agents"]) {
      const installed = skillPath(home, agent);
      assert.equal(fs.lstatSync(installed).isSymbolicLink(), true);
      assert.equal(fs.realpathSync(installed), canonicalRoot);
    }
    assert.equal(fs.readFileSync(path.join(result.backup, "human-review-wrapper"), "utf8"), `#!/bin/sh\n${marker}\nexec old-runtime\n`);
    assert.equal(fs.readFileSync(path.join(result.backup, "claude-human-review", "SKILL.md"), "utf8"), "old Claude skill\n");
    assert.equal(fs.lstatSync(path.join(result.backup, "codex-human-review")).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(path.join(result.backup, "codex-human-review")), oldLinkTarget);

    const installedSkill = fs.readFileSync(path.join(canonicalRoot, "SKILL.md"), "utf8");
    const second = installLocal({ root: canonicalRoot, home, executable: "/test/node" });
    assert.equal(second.changed, false);
    assert.equal(second.backup, null);
    assert.equal(fs.readFileSync(path.join(canonicalRoot, "SKILL.md"), "utf8"), installedSkill);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("local installer refuses an unrelated command before touching existing skills", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "human-review-command-"));
  try {
    const canonicalRoot = makeCanonicalRoot(home);
    const wrapper = commandPath(home);
    fs.mkdirSync(path.dirname(wrapper), { recursive: true });
    fs.writeFileSync(wrapper, "#!/bin/sh\nexec another-tool\n");
    const oldSkill = skillPath(home, ".claude");
    fs.mkdirSync(oldSkill, { recursive: true });
    fs.writeFileSync(path.join(oldSkill, "SKILL.md"), "leave me alone\n");

    assert.throws(() => installLocal({ root: canonicalRoot, home }), /existing command already owns/);
    assert.equal(fs.readFileSync(wrapper, "utf8"), "#!/bin/sh\nexec another-tool\n");
    assert.equal(fs.readFileSync(path.join(oldSkill, "SKILL.md"), "utf8"), "leave me alone\n");
    assert.equal(fs.existsSync(backupRoot(home)), false, "a rejected command must not create a backup directory");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("local installer never replaces a canonical skill that is already a destination", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "human-review-source-skill-"));
  try {
    const canonicalRoot = skillPath(home, ".claude");
    fs.mkdirSync(path.join(canonicalRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(canonicalRoot, "SKILL.md"), "source stays canonical\n");
    fs.writeFileSync(path.join(canonicalRoot, "src", "cli.js"), "// test CLI\n");

    const result = installLocal({ root: canonicalRoot, home, executable: "/test/node" });
    const resolvedRoot = fs.realpathSync(canonicalRoot);
    assert.equal(fs.readFileSync(path.join(canonicalRoot, "SKILL.md"), "utf8"), "source stays canonical\n");
    assert.equal(fs.existsSync(path.join(result.backup, "claude-human-review")), false);
    assert.equal(fs.realpathSync(skillPath(home, ".claude")), resolvedRoot);
    for (const agent of [".codex", ".agents"]) {
      assert.equal(fs.realpathSync(skillPath(home, agent)), resolvedRoot);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
