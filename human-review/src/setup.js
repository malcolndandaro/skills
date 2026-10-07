import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, "..");
const CANONICAL_COMMAND = "~/.local/bin/human-review";

/** The local package always has a usable CLI, even before it is installed. */
export function bundledInvocation() {
  return `${shellQuote(process.execPath)} ${shellQuote(path.join(here, "cli.js"))}`;
}

/**
 * Use the maintained package that is currently running setup. An explicit
 * wrapper command wins, but a PATH command may be an upstream installation.
 */
export function invocation() {
  if (process.env.HUMAN_REVIEW_COMMAND) return shellQuote(process.env.HUMAN_REVIEW_COMMAND);
  return bundledInvocation();
}

/**
 * True for a bin that exists only for one command or only inside one project.
 * Every transient channel routes through a `node_modules` directory: `npx`,
 * `pnpm dlx`, `yarn dlx`, `bunx`, and a plain project-local dependency. npm's
 * npx cache additionally sits under `_npx`, which is worth keeping as its own
 * check because npm may relocate the bin inside it. Durable installs resolve
 * through a bin directory with neither segment: `npm i -g`, `npm link`, volta,
 * nvm, asdf, and the pnpm and yarn globals.
 *
 * A durable path that happens to contain either segment uses this package's
 * own CLI, which works from every checkout without contacting npm.
 */
export function isTransientBin(binPath) {
  const segments = binPath.split(/[\\/]/);
  return segments.includes("_npx") || segments.includes("node_modules");
}

/**
 * Quote a path for copy-paste into any shell. JSON.stringify would double
 * Windows backslashes; plain double quotes work in bash, zsh, cmd and
 * PowerShell alike, and paths cannot legally contain a double quote on Windows.
 */
export function shellQuote(arg) {
  const text = String(arg);
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `"${text.replaceAll('"', '\\"')}"`;
}

/** The canonical skill lives beside the runtime package. */
export const readSkill = () => fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");

export const skillFor = (cmd) => readSkill().replaceAll(CANONICAL_COMMAND, cmd);

function isCanonicalSkill(destination) {
  try {
    return fs.realpathSync(destination) === fs.realpathSync(skillRoot);
  } catch {
    return false;
  }
}

const CODEX_BLOCK = `
## Reviewing files and localhost pages with human-review

After writing an HTML or Markdown file the user will read, open it for them with
\`npx -y human-review <file.html>\`. For a locally running web page, open the real
route with \`npx -y human-review http://localhost:3000/path\` instead of recreating
it as a static file. Then run
\`npx -y human-review poll <target>\` in the foreground, inside your active
turn, and stay on it until it prints \`{"status":"feedback"}\` or
\`{"status":"closed"}\`. Do not detach it or start it as a background
session: nothing wakes you when a detached command finishes. While the review
is active, answer any incoming user message as commentary and immediately
resume the foreground poll in the same turn; do not send a final response
until the poll returns feedback or closed, because a final response ends the
turn and kills the wait. If your shell tool caps command duration, pass
\`--timeout\` a little under the cap and run bounded polls back to back in
the same active turn. Apply the entire batch, then run
\`npx -y human-review ack <target>\` before ending your turn, even when no further
review is needed. Use the exact \`ack_command\` from the batch when present.
This confirms completion immediately in the browser. Then poll again; \`poll --ack\`
can confirm and wait together. Waiting is reliable only while the turn stays active: a turn that
already ended is not woken by Send, and the user has to message you, after
which \`status\` and \`poll\` pick the batch up.
\`{"status":"closed"}\` means the review is over (ended, tab closed, or none
open); do not poll again, and if its \`unsent\` counts are not zero, tell the user
in one line. \`{"status":"superseded"}\` means a newer poll of yours owns the
wait; stop this one silently. \`npx -y human-review status <target>\` reports
instantly whether feedback is already waiting, without blocking.

The batch groups feedback by page under \`pages\`, so fix every page listed. Items
under \`edits\` are changes the user already made: \`after\` is their exact wording,
so carry it across verbatim and never revert it — and if the HTML was generated
from MDX or Markdown, apply it to the source too. Markdown files open rendered
and are never written by human-review: apply their comments and edits to the
Markdown source, keeping its syntax. There is no reply channel; the user sees
your work when the page reloads. For a localhost page, direct edits and deletions
arrive with \`kind: "url"\`; find and update the matching MDX, TSX, template, or
component source. Never write the rendered HTTP response over project source.
A page with \`edits_saved: true\` already has those edits on disk: re-read the
file and make targeted changes only, never regenerate it from an older copy.
`;

const BLOCK_START = "<!-- human-review:start -->";
const BLOCK_END = "<!-- human-review:end -->";
/** The heading an older setup wrote, before the block carried markers. */
const LEGACY_HEADING = "## Reviewing files and localhost pages with human-review";

/**
 * Put the current Codex block into AGENTS.md, replacing whatever an earlier
 * setup left there. Instructions in this file used to be written once and
 * never touched again, so projects set up months ago kept telling Codex to
 * do things the tool no longer does. Marker comments make the block ours
 * to rewrite; a project that mentions human-review in its own words is left
 * alone.
 */
export function mergeAgentsBlock(existing, block) {
  const marked = `${BLOCK_START}\n${block.trim()}\n${BLOCK_END}\n`;
  if (!existing) return { text: marked, action: "created" };
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END, start === -1 ? 0 : start);
  if (start !== -1 && end !== -1) {
    const tail = existing.slice(end + BLOCK_END.length).replace(/^\n/, "");
    const text = `${existing.slice(0, start)}${marked}${tail}`;
    return { text, action: text === existing ? "current" : "updated" };
  }
  const head = existing.indexOf(LEGACY_HEADING);
  if (head !== -1) {
    const next = existing.indexOf("\n## ", head + LEGACY_HEADING.length);
    const stop = next === -1 ? existing.length : next + 1;
    return { text: `${existing.slice(0, head)}${marked}${existing.slice(stop)}`, action: "updated" };
  }
  if (existing.includes("human-review")) return { text: existing, action: "custom" };
  return { text: `${existing.trimEnd()}\n\n${marked}`, action: "updated" };
}

export function installSkills(cwd, { global: isGlobal = false, home = os.homedir(), command = invocation() } = {}) {
  const done = [];
  const cmd = command;

  const skillRoots = isGlobal
    ? [
        ["Claude Code", path.join(home, ".claude")],
        ["Codex", path.join(home, ".codex")],
        ["Shared agents", path.join(home, ".agents")],
      ]
    : [["Claude Code", path.join(cwd, ".claude")]];

  for (const [agent, base] of skillRoots) {
    const skillDir = path.join(base, "skills", "human-review");
    const skillFile = path.join(skillDir, "SKILL.md");
    if (isCanonicalSkill(skillDir)) {
      done.push(`${agent} skill linked  ${skillDir}${isGlobal ? "   (all projects)" : ""}`);
      continue;
    }
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(skillFile, skillFor(cmd));
    done.push(`${agent} skill  ${skillFile}${isGlobal ? "   (all projects)" : ""}`);
  }

  if (!isGlobal) {
    const agents = path.join(cwd, "AGENTS.md");
    const existing = fs.existsSync(agents) ? fs.readFileSync(agents, "utf8") : "";
    const { text, action } = mergeAgentsBlock(existing, CODEX_BLOCK.replaceAll("npx -y human-review", cmd));
    if (action === "custom") done.push("AGENTS.md mentions human-review in its own words — left it alone");
    else if (action === "current") done.push("AGENTS.md already current   (Codex)");
    else {
      fs.writeFileSync(agents, text);
      done.push(`${action === "created" ? "Created" : "Updated"} AGENTS.md   (Codex)`);
    }
  }

  done.push("", `Agents will be told to run: ${cmd}`);
  done.push("Any other agent works too — see the JSON contract in SKILL.md.");
  return done;
}
