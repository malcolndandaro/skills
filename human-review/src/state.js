import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalTarget, ensureStateDir, pageKey, realFile, stateDir, statePath, targetKey } from "./paths.js";

/**
 * The agent's copy of each page is the revert target. It is whole documents,
 * so it lives in its own file per page rather than inside state.json, which
 * every edit flush rewrites in full.
 */
const pristineDir = () => path.join(stateDir(), "pristine");
const pristinePath = (key) => path.join(pristineDir(), `${key}.html`);
const digest = (text) => crypto.createHash("sha1").update(text).digest("hex");
export const MAX_COMPLETED_COMMENTS = 50;

function readPristine(key) {
  try {
    return fs.readFileSync(pristinePath(key), "utf8");
  } catch {
    return "";
  }
}

function dropPristine(key) {
  try {
    fs.unlinkSync(pristinePath(key));
  } catch {}
}

/** Anything untouched this long is review debris, not work in progress. */
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const fresh = (entry, now) => !!entry && now - (entry.updatedAt || 0) < PRUNE_AGE_MS;

/**
 * Windows lets a virus scanner or indexer hold a brief handle on a file the
 * moment it is created, and a rename against that handle fails with EPERM,
 * EACCES or EBUSY. The handle is gone within a few milliseconds, so the write
 * is not really lost -- it just has to be asked for again. Measured on a box
 * running McAfee real-time protection, ~4% of renames failed on the first try
 * and none survived a short backoff.
 */
const RETRYABLE_RENAME = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_TRIES = 5;

/** Sleep without going async: atomicWrite is synchronous by contract. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Drop the temp file after a failed write. The handle that blocked the rename
 * blocks the unlink for exactly as long, so a single attempt would strand the
 * file in the state directory -- and nothing else ever sweeps it. Give up
 * quietly once the retries are spent: the caller is already throwing the error
 * that matters, and a leftover temp file must not mask it.
 */
function discardTmp(tmp, unlink, sleep) {
  try {
    for (let attempt = 0; attempt < RENAME_TRIES; attempt++) {
      try {
        unlink(tmp);
        return;
      } catch (err) {
        if (err.code === "ENOENT" || !RETRYABLE_RENAME.has(err.code)) return;
        // Nothing waits on the last attempt: no attempt follows it.
        if (attempt === RENAME_TRIES - 1) return;
        sleep(2 ** attempt);
      }
    }
  } catch {
    // Best effort by definition. Whatever failed in here -- including the
    // sleep -- must never escape and replace the write error the caller is
    // already throwing.
  }
}

/**
 * Atomic write via a unique sibling tmp file. The name is unguessable and the
 * create is exclusive, so a pre-planted symlink can never redirect the write,
 * and a failed rename never leaves a predictable orphan behind.
 */
export function atomicWrite(file, data) {
  return writeThroughTmp(file, data, REAL);
}

/**
 * The real calls, looked up at call time rather than captured here, so a test
 * can drive the exported atomicWrite through its retry by patching fs.
 */
const REAL = {
  rename: (from, to) => fs.renameSync(from, to),
  unlink: (target) => fs.unlinkSync(target),
  sleep: (ms) => sleepSync(ms),
};

/**
 * atomicWrite's body. Private: nothing outside this module may hand it a
 * rename that quietly does nothing and reports a successful write. Tests
 * reach the retry by patching fs, which REAL looks up at call time.
 */
function writeThroughTmp(file, data, overrides) {
  // Merged per key, so a test can replace one call and still exercise the
  // real implementations of the others.
  const { rename, unlink, sleep } = { ...REAL, ...overrides };
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.human-review.tmp`;
  fs.writeFileSync(tmp, data, { flag: "wx" });
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        rename(tmp, file);
        return;
      } catch (err) {
        if (attempt >= RENAME_TRIES - 1 || !RETRYABLE_RENAME.has(err.code)) throw err;
        try {
          sleep(2 ** attempt);
        } catch {
          // A broken sleeper is not the failure worth reporting.
          throw err;
        }
      }
    }
  } catch (err) {
    discardTmp(tmp, unlink, sleep);
    throw err;
  }
}

/**
 * All durable state lives in one JSON file. No database, no network.
 *
 * Shape:
 *   {
 *     pages:   { <key>: { key, file, pristine, dynamic, comments[], edits[], updatedAt } },
 *     batches: { <entryKey>: { batch, cleanup, delivered, priorCleanup, updatedAt } },
 *   }
 *
 * Pages are fully independent: no page ever references another. Batches are
 * feedback the user sent that no agent has acknowledged yet; persisting them
 * means "your feedback is safe" stays true across server restarts.
 */
export class Store {
  constructor() {
    this.data = { pages: {}, batches: {} };
    /** Pages this process retired; save() must not revive their on-disk snapshots. */
    this.clearedPages = new Set();
    /** Batches this process acked; save() must not resurrect them from disk. */
    this.clearedBatches = new Set();
    /** Digest of the pristine copy already on disk per page; unchanged copies are not rewritten. */
    this.pristineWritten = new Map();
    /** Only new snapshots awaiting an atomic write are kept in memory. */
    this.pendingPristine = new Map();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(statePath(), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.pages) {
        this.data = { pages: parsed.pages, batches: parsed.batches || {} };
      }
    } catch {
      // Missing or unreadable state is not an error; start empty.
    }
    for (const [key, page] of Object.entries(this.data.pages)) {
      this.bindPristine(page, key);
    }
    this.prune();
    return this.data;
  }

  /** Preserve the page API while reading whole-document snapshots on demand. */
  bindPristine(page, key) {
    const descriptor = Object.getOwnPropertyDescriptor(page, "pristine");
    if (descriptor?.get) return;
    const inline = page.pristine;
    if (typeof inline === "string" && inline) this.pendingPristine.set(key, inline);
    delete page.pristine;
    Object.defineProperty(page, "pristine", {
      configurable: true,
      enumerable: false,
      get: () => this.pendingPristine.get(key) ?? readPristine(key),
      set: (html) => this.pendingPristine.set(key, String(html || "")),
    });
  }

  /** Check revert availability without loading a potentially large snapshot. */
  hasPristine(key) {
    if (this.pendingPristine.has(key)) return !!this.pendingPristine.get(key);
    try { return fs.statSync(pristinePath(key)).size > 0; } catch { return false; }
  }

  /** Drop pages whose file is gone or that nobody has touched in a month. */
  prune() {
    const now = Date.now();
    for (const [key, page] of Object.entries(this.data.pages)) {
      const missingFile = page.kind !== "url" && !fs.existsSync(page.file);
      if (!fresh(page, now) || missingFile) {
        delete this.data.pages[key];
        delete this.data.batches[key];
        this.pendingPristine.delete(key);
        this.pristineWritten.delete(key);
        dropPristine(key);
      }
    }
    for (const [key, batch] of Object.entries(this.data.batches)) {
      if (!fresh(batch, now)) delete this.data.batches[key];
    }
  }

  /**
   * Merge over whatever is on disk rather than overwriting it. If a second
   * server is ever running, a blind write would silently drop the pages and
   * comments it owns.
   */
  save() {
    ensureStateDir();
    const target = statePath();
    let onDisk = { pages: {}, batches: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
      if (parsed && parsed.pages) onDisk = { pages: parsed.pages, batches: parsed.batches || {} };
    } catch {
      // No readable state yet; ours becomes the file.
    }
    const stripped = {};
    for (const [key, page] of Object.entries(this.data.pages)) {
      stripped[key] = { ...page };
    }
    for (const [key, pristine] of this.pendingPristine) {
      if (!pristine) {
        dropPristine(key);
        this.pristineWritten.delete(key);
        this.pendingPristine.delete(key);
        continue;
      }
      const hash = digest(pristine);
      if (this.pristineWritten.get(key) !== hash) {
        fs.mkdirSync(pristineDir(), { recursive: true });
        atomicWrite(pristinePath(key), pristine);
        this.pristineWritten.set(key, hash);
      }
      this.pendingPristine.delete(key);
    }
    const merged = {
      pages: { ...onDisk.pages, ...stripped },
      batches: { ...onDisk.batches, ...this.data.batches },
    };
    for (const key of this.clearedPages) delete merged.pages[key];
    for (const key of this.clearedBatches) delete merged.batches[key];
    // Age-prune the merged result too, so the file cannot grow without bound.
    const now = Date.now();
    for (const [key, page] of Object.entries(merged.pages)) {
      if (!fresh(page, now)) {
        delete merged.pages[key];
        dropPristine(key);
      }
    }
    for (const [key, batch] of Object.entries(merged.batches)) {
      if (!fresh(batch, now)) delete merged.batches[key];
    }
    atomicWrite(target, JSON.stringify(merged, null, 2));
  }

  /** Register a file as a reviewable page, capturing the agent's version. */
  openPage(file, pristine) {
    const key = pageKey(file);
    const existing = this.data.pages[key];
    const page = existing || {
      key,
      kind: "file",
      file: realFile(file),
      pristine: "",
      comments: [],
      edits: [],
      screenshots: [],
      updatedAt: 0,
    };
    this.bindPristine(page, key);
    page.kind = "file";
    page.file = realFile(file);
    page.screenshots ||= [];
    delete page.url;
    if (!existing || typeof pristine === "string") {
      page.pristine = typeof pristine === "string" ? pristine : page.pristine;
    }
    page.updatedAt = Date.now();
    this.data.pages[key] = page;
    this.clearedPages.delete(key);
    this.save();
    return page;
  }

  /** Register a rendered localhost route. Browser edits are never written to it. */
  openUrl(url) {
    const target = canonicalTarget(url);
    if (target.kind !== "url") throw new Error("Expected a localhost URL.");
    const key = targetKey(target.value);
    const existing = this.data.pages[key];
    const page = existing || {
      key,
      kind: "url",
      url: target.value,
      pristine: "",
      comments: [],
      edits: [],
      screenshots: [],
      updatedAt: 0,
    };
    this.bindPristine(page, key);
    page.kind = "url";
    page.url = target.value;
    page.screenshots ||= [];
    delete page.file;
    page.updatedAt = Date.now();
    this.data.pages[key] = page;
    this.clearedPages.delete(key);
    this.save();
    return page;
  }

  page(key) {
    return this.data.pages[key] || null;
  }

  pageForFile(file) {
    return this.page(pageKey(file));
  }

  pageForTarget(target) {
    return this.page(targetKey(target));
  }

  /** Forget an inert page and its whole-document revert snapshot immediately. */
  forgetPage(key) {
    const page = this.data.pages[key];
    if (!page) return null;
    delete this.data.pages[key];
    this.clearedPages.add(key);
    this.pristineWritten.delete(key);
    this.pendingPristine.delete(key);
    dropPristine(key);
    this.save();
    return page;
  }

  update(key, mutate) {
    const page = this.page(key);
    if (!page) return null;
    mutate(page);
    page.updatedAt = Date.now();
    this.save();
    return page;
  }

  addComment(key, comment) {
    return this.update(key, (page) => {
      page.comments.push(comment);
    });
  }

  addScreenshot(key, screenshot) {
    return this.update(key, (page) => {
      page.screenshots ||= [];
      page.screenshots.push(screenshot);
    });
  }

  screenshot(key, id) {
    return this.page(key)?.screenshots?.find((screenshot) => screenshot.id === id) || null;
  }

  removeScreenshot(key, id) {
    let removed = null;
    this.update(key, (page) => {
      page.screenshots ||= [];
      const index = page.screenshots.findIndex((screenshot) => screenshot.id === id);
      if (index >= 0) removed = page.screenshots.splice(index, 1)[0];
    });
    return removed;
  }

  removeComment(key, id) {
    return this.update(key, (page) => {
      page.comments = page.comments.filter((c) => c.id !== id);
    });
  }

  /**
   * Reword feedback. A comment the agent already received keeps the old id in
   * that batch's cleanup, so the reworded one takes a fresh id (`newId`) and
   * survives the ack to ship with the next Send. Returns null for an unknown id.
   */
  updateComment(key, id, feedback, { newId = "" } = {}) {
    let found = false;
    const page = this.update(key, (p) => {
      const comment = p.comments.find((c) => c.id === id);
      if (comment) {
        comment.feedback = feedback;
        comment.updatedAt = Date.now();
        if (newId) comment.id = newId;
        found = true;
      }
    });
    return found ? page : null;
  }

  /** What human-review itself last wrote to the file, so a later open can tell the user's autosave from someone else's write. */
  setSavedHash(key, savedHash) {
    const page = this.page(key);
    if (!page || page.savedHash === savedHash) return page;
    return this.update(key, (p) => {
      p.savedHash = savedHash;
    });
  }

  /** Undo of a delete or move: the row for that block no longer describes anything. */
  removeEdit(key, label, kind) {
    return this.update(key, (page) => {
      page.edits = page.edits.filter((e) => !(e.label === label && e.kind === kind));
    });
  }

  /** The user abandoned leftover feedback from an earlier review of this page. */
  discardFeedback(key) {
    return this.update(key, (page) => {
      page.comments = [];
      page.edits = [];
    });
  }

  /**
   * A self-rendering HTML file: its scripts rewrite the DOM, so browser edits
   * are feedback only and never on disk. Remembered so the batch can say so.
   */
  setDynamic(key, dynamic) {
    const page = this.page(key);
    if (!page || !!page.dynamic === !!dynamic) return page;
    return this.update(key, (p) => {
      if (dynamic) p.dynamic = true;
      else delete p.dynamic;
    });
  }

  /**
   * Edits are deduped by label+kind so retyping one block stays one row, but
   * the text is refreshed every time so `after` is always the latest wording.
   */
  addEdit(key, label, kind, before, after, beforeHtml, afterHtml, extra) {
    return this.update(key, (page) => {
      const row = page.edits.find((e) => e.label === label && e.kind === kind);
      if (row) {
        if (after !== undefined) row.after = after;
        if (afterHtml !== undefined) row.after_html = afterHtml;
        // A re-move of the same block replaces its landing spot.
        if (extra) {
          if (extra.staged_assets) {
            const assets = [...(row.staged_assets || []), ...extra.staged_assets];
            extra = { ...extra, staged_assets: [...new Map(assets.map((asset) => [asset.path, asset])).values()] };
          }
          Object.assign(row, extra);
        }
        row.updatedAt = Date.now();
        return;
      }
      page.edits.push({ label, kind, before, after, before_html: beforeHtml, after_html: afterHtml, ...(extra || {}), at: Date.now(), updatedAt: Date.now() });
    });
  }

  clearEdits(key) {
    return this.update(key, (page) => {
      page.edits = [];
    });
  }

  /**
   * After the agent writes, its version becomes the new revert target. Edit
   * rows are dropped only when they were already written into the file: on a
   * Markdown or self-rendering page they are unsent feedback, and an external
   * write (an editor autosave, a formatter) must not throw them away.
   */
  setPristine(key, html, { keepEdits = false } = {}) {
    return this.update(key, (page) => {
      page.pristine = html;
      if (!keepEdits) page.edits = [];
    });
  }

  /**
   * Archive exactly the comments the agent confirms as applied, then drop the
   * acknowledged active feedback. Comments made after
   * Send have unknown ids; edits made (or retyped) after Send have a newer
   * timestamp than the batch. Both must survive for the next batch.
   */
  clearSent(key, ids, sentAt, snapshots = []) {
    return this.update(key, (page) => {
      const drop = new Set(ids);
      const resolvedAt = Date.now();
      const available = new Map(snapshots.map((comment) => [comment.id, comment]));
      for (const comment of page.comments) available.set(comment.id, comment);
      const completed = ids.map((id) => available.get(id)).filter(Boolean).map((comment) => {
        const { id, kind, quote, feedback, createdAt, updatedAt } = comment;
        return { id, kind, quote, feedback, createdAt, ...(updatedAt ? { updatedAt } : {}), resolvedAt };
      });
      // Keep a small text-only history. Temporary captures are still released
      // by acknowledgement and completed items never become sendable again.
      page.completedComments = [...(page.completedComments || []).filter((comment) => !drop.has(comment.id)), ...completed].slice(-MAX_COMPLETED_COMMENTS);
      page.comments = page.comments.filter((c) => !drop.has(c.id));
      // >= not >: an edit stamped the same millisecond as the send may not
      // have shipped — resending it is harmless, dropping it loses work.
      page.edits = typeof sentAt === "number" ? page.edits.filter((e) => (e.updatedAt || e.at || 0) >= sentAt) : [];
    });
  }

  // Sent-but-unacked feedback, keyed by the entry page the agent polls.

  batch(entryKey) {
    return this.data.batches[entryKey] || null;
  }

  allBatches() {
    return this.data.batches;
  }

  setBatch(entryKey, { batch, cleanup, delivered = false, priorCleanup = null }) {
    this.clearedBatches.delete(entryKey);
    this.data.batches[entryKey] = {
      batch,
      cleanup,
      delivered: !!delivered,
      ...(priorCleanup && priorCleanup.length ? { priorCleanup } : {}),
      updatedAt: Date.now(),
    };
    this.save();
  }

  /**
   * Delivery is durable: a server replaced between handing a batch out and
   * the agent's --ack must still honor that ack, not ship the batch twice.
   */
  markDelivered(entryKey) {
    const record = this.data.batches[entryKey];
    if (!record || record.delivered) return;
    record.delivered = true;
    record.updatedAt = Date.now();
    this.save();
  }

  /**
   * A batch another server process wrote (two servers briefly overlapping)
   * lives only on disk. Read it fresh so a poll here can still deliver it.
   */
  batchFromDisk(entryKey) {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8"));
      const record = parsed && parsed.batches ? parsed.batches[entryKey] : null;
      if (!record || this.clearedBatches.has(entryKey)) return null;
      this.data.batches[entryKey] = record;
      return record;
    } catch {
      return null;
    }
  }

  clearBatch(entryKey) {
    delete this.data.batches[entryKey];
    this.clearedBatches.add(entryKey);
    this.save();
  }
}

/** Resolve a sibling asset request without escaping the artifact's directory. */
export function resolveAsset(pageFile, relative) {
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const base = path.dirname(pageFile);
  const target = path.resolve(base, decoded);
  const contained = (candidate, root) => {
    const rel = path.relative(root, candidate);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  if (!contained(target, base)) return null;
  // The lexical check alone would follow a symlink out of the directory, so
  // the resolved filesystem path must land inside it too.
  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    // Nothing readable at that path — anything a symlink could point to would
    // have resolved. The caller's read fails with a plain 404.
    return target;
  }
  let realBase = base;
  try {
    realBase = fs.realpathSync(base);
  } catch {}
  if (!contained(real, realBase)) return null;
  return real;
}
