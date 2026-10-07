#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");
export const marker = "# Managed by human-review/scripts/install-local.mjs";

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isManagedWrapper(target) {
  const stat = lstatOrNull(target);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) return false;
  return fs.readFileSync(target, "utf8").includes(marker);
}

function isCanonicalSkill(destination, root) {
  try {
    return fs.realpathSync(destination) === fs.realpathSync(root);
  } catch {
    return false;
  }
}

function copyForBackup(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), destination);
    return;
  }
  if (stat.isDirectory()) {
    fs.cpSync(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true });
    return;
  }
  fs.copyFileSync(source, destination);
}

function backupDirectory(home) {
  // Backups must not live below the skill root. Agent skill discovery walks
  // that tree, so a prior SKILL.md would otherwise be offered as another
  // human-review skill after installation.
  const parent = path.join(home, ".local", "state", "human-review", "skill-backups");
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const base = new Date().toISOString().replace(/[.:]/g, "-");
  for (let suffix = 0; ; suffix += 1) {
    const candidate = path.join(parent, suffix ? `${base}-${suffix}` : base);
    if (!fs.existsSync(candidate)) {
      fs.mkdirSync(candidate, { mode: 0o700 });
      return candidate;
    }
  }
}

function wrapperText(bin, root, executable) {
  return `#!/bin/sh\n${marker}\nHUMAN_REVIEW_COMMAND=${quote(bin)} exec ${quote(executable)} ${quote(path.join(root, "src", "cli.js"))} "$@"\n`;
}

/**
 * Install the canonical runtime command and link every supported agent to the
 * one canonical skill directory. Arguments are injectable for isolated tests.
 */
export function installLocal({ root = defaultRoot, home = os.homedir(), executable = process.execPath } = {}) {
  const canonicalRoot = fs.realpathSync(root);
  const bin = path.join(home, ".local", "bin", "human-review");
  const wantedWrapper = wrapperText(bin, canonicalRoot, executable);
  const existingWrapper = lstatOrNull(bin);

  // Validate before creating a backup directory or replacing any skill. This
  // prevents a local command owned by another tool from being touched at all.
  if (existingWrapper && !isManagedWrapper(bin)) {
    throw new Error(`An existing command already owns ${bin}. Keep it and choose another local install path.`);
  }

  const skills = [".claude", ".codex", ".agents"].map((agent) => ({
    agent,
    destination: path.join(home, agent, "skills", "human-review"),
  }));
  const replacementSkills = skills.filter(({ destination }) => !isCanonicalSkill(destination, canonicalRoot));
  const wrapperNeedsUpdate = !existingWrapper || fs.readFileSync(bin, "utf8") !== wantedWrapper;
  if (!wrapperNeedsUpdate && replacementSkills.length === 0) {
    return { bin, backup: null, changed: false, messages: ["human-review is already installed from the canonical skill."] };
  }

  const backup = backupDirectory(home);
  if (wrapperNeedsUpdate && existingWrapper) copyForBackup(bin, path.join(backup, "human-review-wrapper"));
  for (const { agent, destination } of replacementSkills) {
    if (lstatOrNull(destination)) copyForBackup(destination, path.join(backup, `${agent.slice(1)}-human-review`));
  }

  if (wrapperNeedsUpdate) {
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, wantedWrapper, { mode: 0o755 });
    fs.chmodSync(bin, 0o755);
  }
  for (const { destination } of replacementSkills) {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(canonicalRoot, destination, "dir");
  }

  const messages = [
    `Local command: ${bin}`,
    ...skills.map(({ agent, destination }) => `${agent} skill: ${destination}${isCanonicalSkill(destination, canonicalRoot) ? " (linked)" : ""}`),
    `Previous install: ${backup}`,
  ];
  return { bin, backup, changed: true, messages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  try {
    console.log(installLocal().messages.join("\n"));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
