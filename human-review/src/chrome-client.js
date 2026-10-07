/**
 * human-review chrome. Owns the rail UI and every call to the local server.
 * It never touches the artifact DOM directly — the SDK does that, over
 * postMessage, because the artifact iframe lives on the other loopback
 * hostname: a separate origin that can never reach this page or its token.
 */
import { tidy } from "./anchor-text.js";
import { pageUrl, replacePage } from "./chrome-session.js";
import { normalizeHref } from "./editing.js";
import { framePolicy } from "./frame-policy.js";

/**
 * True when an "Enter" keydown is really an IME confirming its composition
 * (e.g. finalizing kanji conversion), not the user asking to submit.
 */
function isImeCommitEnter(event) {
  return Boolean(event.isComposing || event.keyCode === 229);
}

const $ = (id) => document.getElementById(id);
const frame = $("frame");
const EMPTY_COMPLETED = Object.freeze([]);
let captureHintDismiss = null;

const state = {
  sessionId: document.body.dataset.session,
  token: document.body.dataset.token,
  key: null,
  page: null,
  compose: null,
  active: null,
  agent: "idle",
  save: "idle",
  savedAt: "",
  sent: false,
  orphans: new Set(),
  pollCommand: "",
  editsExpanded: false,
  others: [],
  scroll: { x: 0, y: 0 },
  reloading: false,
  dynamic: false,
  framePolicy: null,
  artifactToken: "",
  leftover: null,
  mode: "edit",
  find: { open: false, query: "", count: 0, index: 0 },
  captures: new Map(),
  drawing: { active: false, canUndo: false, count: 0 },
  screenshotUrls: new Map(),
  screenshotControllers: new Set(),
  sending: false,
  commentDraft: null,
  completedSource: undefined,
};

/**
 * Most reviewers drive an agent from a chat (Claude Code, Codex, Cursor), not
 * a bare terminal — so the handoff is a prompt the agent can act on, with the
 * poll command embedded for anyone who does live in a shell.
 */
function handoffPrompt(pollCommand) {
  const cmd = String(pollCommand || "").trim();
  if (!cmd) return "";
  return `Run \`${cmd}\` and wait for my feedback. In Claude Code, use a background task. In Codex, keep the turn active while waiting. Apply the feedback, then repeat with --ack.`;
}

// ------------------------------------------------------------------- server

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", "x-human-review-token": state.token, ...(options && options.headers) },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const error = new Error(detail.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// The SDK posts a flush acknowledgement after it has handed each debounced
// write to this shell. Keep track of those fetches so Send and page changes
// cannot race ahead of their persistence.
const pendingWrites = new Set();
function trackWrite(request) {
  pendingWrites.add(request);
  request.finally(() => pendingWrites.delete(request)).catch(() => {});
  return request;
}
function writeApi(path, options) {
  return trackWrite(api(path, options));
}

async function waitForWrites() {
  while (pendingWrites.size) await Promise.allSettled([...pendingWrites]);
}

// Keep the reviewed app on a different loopback origin from the review shell.
// This gives route-aware frameworks a real origin without exposing the parent UI.
const ARTIFACT_HOST = location.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
const ARTIFACT_ORIGIN = `${location.protocol}//${ARTIFACT_HOST}:${location.port}`;

// URL reviews keep a real origin. File reviews use an opaque sandbox origin,
// so postMessage requires "*" while the source-window check remains exact.
const toFrame = (message) =>
  frame.contentWindow && frame.contentWindow.postMessage(message, state.framePolicy?.targetOrigin || ARTIFACT_ORIGIN);

/**
 * Point the frame at a page without adding a history entry of its own.
 * Setting `src` records each artifact load in the window's history, so Back
 * would step through frame loads instead of review pages.
 */
function showInFrame(url) {
  try {
    if (frame.contentWindow) {
      frame.contentWindow.location.replace(url);
      return;
    }
  } catch {}
  frame.src = url;
}

function artifactUrl(key, bust = false) {
  const query = bust ? `?t=${Date.now()}` : "";
  return `${ARTIFACT_ORIGIN}/artifact/${state.artifactToken}/${key}/index.html${query}`;
}

/**
 * The server forgot this session — it restarted, or the tab was away longer
 * than the session lives. Open a fresh session on the same target so the
 * page keeps working instead of turning into a dead tab that looks alive.
 */
async function rebootstrap() {
  const target = state.page ? state.page.url || state.page.file : "";
  if (!target) return false;
  try {
    const fresh = await api("/api/session", { method: "POST", body: JSON.stringify({ target }) });
    state.sessionId = fresh.sessionId;
    state.artifactToken = fresh.artifactToken || state.artifactToken;
    history.replaceState({ key: state.key, target }, "", `${fresh.path}?key=${encodeURIComponent(state.key)}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the SDK to ship anything still sitting in its debounce windows, and
 * wait until it has. Navigating away without this drops the last moments of
 * typing. The timeout covers a torn-down or never-booted frame.
 */
const flushWaiters = new Set();
function flushFrame() {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      flushWaiters.delete(settle);
      resolve();
    };
    const timeout = setTimeout(settle, 700);
    flushWaiters.add(settle);
    toFrame({ type: "eh:flush" });
  });
}

function settleFlushes() {
  for (const settle of [...flushWaiters]) settle();
}

async function flushAndPersist() {
  await flushFrame();
  await waitForWrites();
}

function cancelCaptures() {
  const hadCapture = state.captures.size > 0;
  for (const capture of state.captures.values()) toFrame({ type: "eh:captureCancel", id: capture.id });
  state.captures.clear();
  clearCaptureHint();
  if (hadCapture) dismissEmptyScreenshotCompose();
  // Send reads state.captures too; renderToolbar alone left it on "Capturing".
  render();
  renderToolbar();
}

function resetDrawing({ notifyFrame = false } = {}) {
  if (notifyFrame && state.drawing.active) toFrame({ type: "eh:draw", action: "off" });
  state.drawing = { active: false, canUndo: false, count: 0 };
  renderToolbar();
}

function stopDrawing() {
  if (!state.drawing.active) return;
  toFrame({ type: "eh:draw", action: "off" });
  state.drawing = { ...state.drawing, active: false };
  renderToolbar();
}

function cleanupScreenshotUrls() {
  for (const entry of state.screenshotUrls.values()) URL.revokeObjectURL(entry.url);
  state.screenshotUrls.clear();
  for (const controller of state.screenshotControllers) controller.abort();
  state.screenshotControllers.clear();
}

async function loadPage(key, { reload = true } = {}) {
  const returning = state.page;
  if (state.key && key !== state.key) {
    cancelCaptures();
    resetDrawing({ notifyFrame: true });
    if (state.compose?.screenshot) discardScreenshot(state.compose.screenshot, state.key);
    cleanupScreenshotUrls();
  }
  state.key = key;
  replacePage(state, await api(pageUrl(key, state.sessionId)));
  state.framePolicy = framePolicy(state.page, ARTIFACT_ORIGIN);
  frame.setAttribute("sandbox", state.framePolicy.sandbox);
  state.orphans = new Set();
  state.compose = null;
  state.active = null;
  state.sent = false;
  state.dynamic = false;
  state.baseHash = null;
  clearTimeout(retryTimer);
  if (reload) {
    state.reloading = true;
    showInFrame(artifactUrl(key));
  }
  render();
  // Coming back to a dev-server page shows the app's own copy again, without
  // the direct edits — which reads as data loss unless we say what happened.
  const edits = state.page.edits ? state.page.edits.length : 0;
  if (returning && state.page.feedbackOnly && edits > 0) {
    toast(`This page renders from your dev server — ${edits} ${edits === 1 ? "edit is" : "edits are"} queued for the agent`);
  }
}

// ------------------------------------------------------------------ history

/**
 * Each page shown in this window is a history entry, so Back returns to the
 * previous page of the review instead of leaving it. The server's idea of
 * the active page follows along, so a reload lands on the same page.
 */
function pushHistory(key, target = "") {
  try {
    history.pushState({ key, target }, "", `/s/${state.sessionId}?key=${encodeURIComponent(key)}`);
  } catch {}
}

window.addEventListener("popstate", async (event) => {
  const key = event.state && event.state.key;
  if (!key || key === state.key || document.querySelector(".ended")) return;
  await flushAndPersist();
  try {
    await writeApi(`/api/session/${state.sessionId}/goto`, { method: "POST", body: JSON.stringify({ key, target: event.state.target }) });
  } catch (err) {
    toast(err.message);
    return;
  }
  state.scroll = { x: 0, y: 0 };
  await loadPage(key);
});

// -------------------------------------------------------------------- clock

function ago(ts) {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const clock = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// -------------------------------------------------------------------- render

function render() {
  const page = state.page;
  if (!page) return;
  document.title = page.filename || 'human-review';

  const comments = page.comments || [];
  const edits = page.edits || [];

  $("count").textContent = String(comments.length);
  $("empty").hidden = comments.length > 0 || !!state.compose;

  // --- compose
  const composeWrap = $("compose");
  if (state.compose) {
    composeWrap.hidden = false;
    $("composeKind").textContent = state.compose.kind === "screenshot" ? "Screenshot" : state.compose.kind === "element" ? "Element" : "Selection";
    $("composeQuote").textContent = tidy(state.compose.quote, 260);
    renderComposeScreenshot();
  } else {
    composeWrap.hidden = true;
    $("composeText").value = "";
    $("composeScreenshot").hidden = true;
  }

  renderToolbar();

  // --- comment cards
  const list = $("cards");
  list.textContent = "";
  for (const comment of comments) {
    const card = document.createElement("div");
    card.className = `comment${state.active === comment.id ? " active" : ""}`;
    card.dataset.id = comment.id;

    const head = document.createElement("div");
    head.className = "comment-head";

    const who = document.createElement("span");
    who.className = "who";
    who.append("You");
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "·";
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = ago(comment.updatedAt || comment.createdAt);
    who.append(sep, when);

    if (comment.sent) {
      const badge = document.createElement("span");
      badge.className = "badge sent";
      badge.textContent = "sent";
      who.append(badge);
    } else if (comment.updatedAt) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "edited";
      who.append(badge);
    }

    if (state.orphans.has(comment.id)) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Text changed";
      badge.title = "The original quoted text can no longer be located. It remains pending until the agent confirms completion.";
      who.append(badge);
    }

    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "jump";
    jump.textContent = "Jump to";
    jump.addEventListener("click", (event) => {
      event.stopPropagation();
      setActive(comment.id, true);
    });

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "jump edit-comment";
    edit.textContent = "Edit";
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      editComment(card, body, comment);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.title = "Delete comment";
    remove.setAttribute("aria-label", "Delete comment");
    remove.textContent = "✕";
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      toFrame({ type: "eh:remove", id: comment.id });
      state.page = (await writeApi(`/api/page/${state.key}/comment/${comment.id}`, { method: "DELETE" })).page;
      if (comment.screenshot) revokeScreenshot(comment.screenshot.id);
      render();
    });

    const quote = document.createElement("p");
    quote.className = "quote";
    quote.textContent = tidy(comment.quote, 140);

    const body = document.createElement("p");
    body.className = "body";
    body.textContent = comment.feedback;
    body.title = "Click to edit";
    body.addEventListener("click", (event) => {
      event.stopPropagation();
      editComment(card, body, comment);
    });

    head.append(who, jump, edit, remove);
    card.append(head, quote, body);
    card.addEventListener("click", () => setActive(comment.id, false));
    list.append(card);
    if (state.commentDraft?.id === comment.id) editComment(card, body, comment, { focus: false });
  }

  renderCompletedComments(Array.isArray(page.completedComments) ? page.completedComments : EMPTY_COMPLETED);

  // --- your edits
  const box = $("editsBox");
  box.hidden = edits.length === 0;
  if (edits.length) {
    $("editCount").textContent = String(edits.length);
    const rows = $("editList");
    rows.textContent = "";
    const LIMIT = 5;
    const shown = state.editsExpanded ? edits : edits.slice(0, LIMIT);
    for (const edit of shown) {
      const row = document.createElement("div");
      row.className = `edit-row${edit.kind === "deleted" ? " deleted" : ""}${edit.sent ? " sent" : ""}`;
      const pip = document.createElement("span");
      pip.className = "pip";
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = edit.label;
      const kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = edit.sent ? `${edit.kind} · sent` : edit.kind;
      row.append(pip, label, kind);
      if (!edit.sent && (edit.kind === "deleted" || edit.kind === "moved")) {
        const undo = document.createElement("button");
        undo.type = "button";
        undo.className = "row-undo";
        undo.textContent = "Undo";
        undo.title = edit.kind === "moved" ? "Put this block back where it was" : "Restore this block";
        undo.addEventListener("click", (event) => {
          event.stopPropagation();
          undoBlock(edit.label, edit.kind);
        });
        row.append(undo);
      }
      rows.append(row);
    }
    if (edits.length > LIMIT) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "edit-more";
      more.textContent = state.editsExpanded ? "Show fewer" : `${edits.length - LIMIT} more…`;
      more.addEventListener("click", () => {
        state.editsExpanded = !state.editsExpanded;
        render();
      });
      rows.append(more);
    }
    renderSave();
  }

  // --- pages you left feedback on but are not looking at
  const others = state.others || [];
  const othersBox = $("othersBox");
  othersBox.hidden = others.length === 0;
  if (others.length) {
    $("othersCount").textContent = String(others.length);
    const list = $("othersList");
    list.textContent = "";
    for (const other of others) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "edit-row other-row";
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = other.filename;
      const count = document.createElement("span");
      count.className = "kind";
      count.textContent = String(other.count);
      row.append(label, count);
      row.addEventListener("click", async () => {
        if (state.captures.size) {
          toast("Wait for the screenshot capture to finish before switching pages");
          return;
        }
        await flushAndPersist();
        await writeApi(`/api/session/${state.sessionId}/goto`, {
          method: "POST",
          body: JSON.stringify({ key: other.key }),
        });
        state.scroll = { x: 0, y: 0 };
        pushHistory(other.key);
        await loadPage(other.key);
      });
      list.append(row);
    }
  }

  // --- send: only what the agent does not have yet counts. Items from a
  // batch that is delivered or queued stay listed until the ack, marked sent.
  const otherTotal = others.reduce((sum, o) => sum + o.count, 0);
  const unsent = page.unsent || { comments: comments.length, edits: edits.length };
  const total = unsent.comments + unsent.edits + otherTotal;
  // An overall note is sendable on its own — the server already accepts
  // note-only batches; the button must not stay dead while one is typed.
  const hasNote = $("note").value.trim().length > 0;
  const send = $("send");
  const delivered = state.agent === "working";
  const queued = state.agent === "queued";
  const stranded = state.agent === "stranded";
  // While the agent works, anything new can still be sent: it queues behind
  // the batch in flight and ships with the agent's next poll.
  const nothingNew = total === 0 && !hasNote;
  const busy = stranded || state.sent || state.sending || state.captures.size || (queued && nothingNew);
  send.disabled = nothingNew || busy;
  send.textContent = stranded
    ? "Sent — agent is not listening"
    : state.sending
      ? "Saving your feedback…"
      : state.captures.size
        ? "Capturing screenshot…"
        : state.sent || (nothingNew && (delivered || queued))
      ? queued
        ? "Sent — queued for the agent"
        : delivered
          ? "Feedback delivered"
          : "Sent — waiting for agent"
      : total
        ? `Send ${total} to agent`
        : hasNote
          ? "Send note to agent"
          : "Nothing to send yet";
  if (!send.disabled) {
    const key = document.createElement("span");
    key.className = "key";
    key.textContent = "⌘⏎";
    send.append(" ", key);
  }

  // After sending, say what happens next. If nothing is polling, the loop would
  // otherwise dead-end silently, so hand over the exact command to run.
  $("agentLine").hidden = !(delivered || queued);
  $("agentText").textContent = queued
    ? "Agent is still on your last batch — this one ships with its next poll"
    : "Feedback delivered — page reloads when fixes land";

  // --- feedback left over from an earlier review of this page
  const leftover = state.leftover;
  const leftoverBox = $("leftover");
  const leftoverTotal = leftover ? leftover.comments + leftover.edits : 0;
  leftoverBox.hidden = !leftoverTotal;
  if (leftoverTotal) {
    const parts = [];
    if (leftover.comments) parts.push(`${leftover.comments} ${leftover.comments === 1 ? "comment" : "comments"}`);
    if (leftover.edits) parts.push(`${leftover.edits} ${leftover.edits === 1 ? "edit" : "edits"}`);
    const savedNote = page.kind === "file" && !page.markdown ? " Text edits are already in the file; Discard puts the agent's version back." : "";
    $("leftoverText").textContent = `${parts.join(" and ")} from your last review never went to the agent.${savedNote}`;
  }

  // Server-authoritative, so it survives a browser refresh.
  $("handoff").hidden = !stranded;
  if (stranded) $("handoffCmd").textContent = handoffPrompt(state.pollCommand || page.pollCommand);
}

/** Completed feedback is passive history. Rebuild it only when page data changes. */
function renderCompletedComments(completed) {
  const box = $("completedBox");
  if (state.completedSource === completed) return;
  state.completedSource = completed;
  box.hidden = completed.length === 0;
  $("completedCount").textContent = String(completed.length);
  const list = $("completedCards");
  list.textContent = "";
  for (const comment of completed) {
    const card = document.createElement("article");
    card.className = "comment completed-comment";
    const head = document.createElement("div");
    head.className = "comment-head";
    const badge = document.createElement("span");
    badge.className = "badge completed";
    badge.textContent = "Completed";
    const when = document.createElement("time");
    when.className = "completed-time";
    const resolvedAt = Number(comment.resolvedAt);
    when.textContent = Number.isFinite(resolvedAt) && resolvedAt > 0 ? ago(resolvedAt) : "";
    if (Number.isFinite(resolvedAt) && resolvedAt > 0) when.dateTime = new Date(resolvedAt).toISOString();
    head.append(badge, when);
    const quote = document.createElement("p");
    quote.className = "quote";
    quote.textContent = tidy(comment.quote, 140);
    const body = document.createElement("p");
    body.className = "body";
    body.textContent = comment.feedback;
    card.append(head, quote, body);
    list.append(card);
  }
}

function renderToolbar() {
  const edit = state.mode === "edit";
  $("modeEdit").classList.toggle("active", edit);
  $("modeRead").classList.toggle("active", !edit);
  $("modeEdit").setAttribute("aria-pressed", String(edit));
  $("modeRead").setAttribute("aria-pressed", String(!edit));
  document.querySelectorAll(".format-btn").forEach((button) => {
    button.disabled = !edit;
  });

  const drawing = state.drawing;
  $("pencilToggle").classList.toggle("active", drawing.active);
  $("pencilToggle").setAttribute("aria-pressed", String(drawing.active));
  $("pencilToggle").setAttribute("aria-label", drawing.active ? "Stop drawing" : "Draw on the page with a red pencil");
  $("pencilToggle").title = drawing.active ? "Stop drawing" : "Draw on the page with a red pencil";
  const showDrawingActions = drawing.active || drawing.count > 0;
  $("drawingUndo").hidden = !showDrawingActions;
  $("drawingClear").hidden = !showDrawingActions;
  $("drawingUndo").disabled = !drawing.canUndo;
  $("drawingClear").disabled = !drawing.count;

  const capturing = state.captures.size > 0;
  $("captureRegion").disabled = capturing;
  $("captureViewport").disabled = capturing;
  $("captureFullpage").disabled = capturing;

  $("findBar").hidden = !state.find.open;
  $("findInput").value = state.find.query;
  const { count, index, query } = state.find;
  $("findCount").textContent = query ? (count ? `${index}/${count}` : "No matches") : "";
}

function renderComposeScreenshot() {
  const screenshot = state.compose && state.compose.screenshot;
  const box = $("composeScreenshot");
  if (!screenshot) {
    box.hidden = true;
    $("composeScreenshotImage").removeAttribute("src");
    return;
  }
  box.hidden = false;
  const mode = screenshot.mode === "region" ? "selected area" : screenshot.mode === "full" ? "full page" : "viewport";
  $("composeScreenshotLabel").textContent = `Screenshot (${mode}) · ${screenshot.width || "?"}×${screenshot.height || "?"}`;
  const image = $("composeScreenshotImage");
  image.removeAttribute("src");
  loadScreenshotThumbnail(screenshot, state.key).then((url) => {
    if (url && state.compose && state.compose.screenshot?.id === screenshot.id) image.src = url;
  });
}

function renderSave() {
  const line = $("saveLine");
  if (state.page && state.page.kind === "url") {
    line.className = "save-line dynamic";
    $("saveText").textContent = "Localhost page — your direct edits go to the agent for source updates";
    return;
  }
  if (state.page && state.page.markdown) {
    line.className = "save-line dynamic";
    $("saveText").textContent = "Markdown source — edits go to the agent as feedback";
    return;
  }
  if (state.dynamic) {
    // The page's own scripts render it, so writing the live DOM back would
    // corrupt the file. Edits still reach the agent as feedback.
    line.className = "save-line dynamic";
    $("saveText").textContent = "Live page — edits go to the agent, the file is left alone";
    return;
  }
  line.className = `save-line ${state.save === "saving" ? "saving" : state.save === "failed" ? "failed" : ""}`;
  const name = state.page ? state.page.filename : "";
  if (state.save === "saving") $("saveText").textContent = `Saving to ${name}…`;
  else if (state.save === "failed") $("saveText").textContent = "Couldn't save — retrying…";
  else $("saveText").textContent = state.savedAt ? `Saved to ${name} · ${state.savedAt}` : `Saved to ${name}`;
}

/** Swap a comment's text for a textarea until the new wording is committed. */
function editComment(card, body, comment, { focus = true } = {}) {
  if (card.querySelector("textarea")) return;
  const input = document.createElement("textarea");
  input.className = "body-edit";
  input.rows = 3;
  state.commentDraft = state.commentDraft?.id === comment.id ? state.commentDraft : { id: comment.id, value: comment.feedback };
  input.value = state.commentDraft.value;
  let done = false;
  const finish = () => {
    done = true;
    state.commentDraft = null;
    render();
  };
  const commit = async () => {
    if (done) return;
    done = true;
    state.commentDraft = null;
    const feedback = input.value.trim();
    if (!feedback || feedback === comment.feedback) return render();
    try {
      const result = await writeApi(`/api/page/${state.key}/comment/${comment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ feedback }),
      });
      state.page = result.page;
      if (result.delivery === "updated-pending") toast("Updated the feedback waiting for your agent");
      else if (result.delivery === "resend") {
        state.sent = false;
        toast("The agent already has the old wording — this version ships with your next Send");
        // The retired id no longer marks anything; the new one takes over.
        toFrame({ type: "eh:remove", id: comment.id });
        toFrame({ type: "eh:anchors", comments: state.page.comments });
      } else state.sent = false;
    } catch (err) {
      toast(err.message);
    }
    render();
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) {
      if (isImeCommitEnter(event)) return;
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
    }
  });
  input.addEventListener("blur", commit);
  input.addEventListener("input", () => {
    state.commentDraft = { id: comment.id, value: input.value };
  });
  input.addEventListener("click", (event) => event.stopPropagation());
  body.replaceWith(input);
  if (focus) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function toast(message, { action = "", onAction = null, ms = 3200 } = {}) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  if (action && onAction) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action;
    button.addEventListener("click", () => {
      el.remove();
      onAction();
    });
    el.append(button);
  }
  document.body.append(el);
  const dismiss = () => {
    toastTimers.delete(timer);
    el.remove();
  };
  const timer = setTimeout(dismiss, ms);
  toastTimers.add(timer);
  return () => {
    clearTimeout(timer);
    dismiss();
  };
}

function clearCaptureHint() {
  const dismiss = captureHintDismiss;
  captureHintDismiss = null;
  if (dismiss) dismiss();
}

function showCaptureHint() {
  clearCaptureHint();
  captureHintDismiss = toast("Drag to select an area. Esc to cancel.", { ms: 95_000 });
}

/**
 * Edit rows post asynchronously; an undo must land after the row it reverses,
 * or the DELETE clears nothing and the row ships anyway.
 */
let editChain = Promise.resolve();

/** Ask the editor to put the block back; the row is dropped once it confirms (eh:undone). */
function undoBlock(label, kind) {
  toFrame({ type: "eh:undo", label, kind });
}

function dropEditRow(label, kind) {
  editChain = editChain.then(async () => {
    try {
      state.page = (await writeApi(`/api/page/${state.key}/edit`, { method: "DELETE", body: JSON.stringify({ label, kind }) })).page;
      render();
    } catch (err) {
      toast(err.message);
    }
  });
}

function setActive(id, scroll) {
  state.active = id;
  toFrame({ type: "eh:activate", id, scroll: !!scroll });
  render();
}

// ------------------------------------------------------------------ compose

function screenshotUrl(id) {
  return `/api/page/${encodeURIComponent(state.key)}/screenshot/${encodeURIComponent(id)}`;
}

function revokeScreenshot(id) {
  const entry = state.screenshotUrls.get(id);
  if (!entry) return;
  URL.revokeObjectURL(entry.url);
  state.screenshotUrls.delete(id);
}

function discardScreenshot(screenshot, key = state.key) {
  if (!screenshot?.id || !key) return;
  revokeScreenshot(screenshot.id);
  writeApi(`/api/page/${encodeURIComponent(key)}/screenshot/${encodeURIComponent(screenshot.id)}`, { method: "DELETE" }).catch(() => {});
}

async function loadScreenshotThumbnail(screenshot, key) {
  const requestKey = `${key}:${screenshot?.id || ""}`;
  if (previewRequests.has(requestKey)) return previewRequests.get(requestKey);
  const pending = fetchScreenshotThumbnail(screenshot, key);
  previewRequests.set(requestKey, pending);
  try { return await pending; } finally {
    if (previewRequests.get(requestKey) === pending) previewRequests.delete(requestKey);
  }
}

const previewRequests = new Map();
async function fetchScreenshotThumbnail(screenshot, key) {
  if (!screenshot?.id || key !== state.key) return "";
  const cached = state.screenshotUrls.get(screenshot.id);
  if (cached && cached.key === key) return cached.url;
  const controller = new AbortController();
  state.screenshotControllers.add(controller);
  try {
    const response = await fetch(screenshotUrl(screenshot.id), {
      headers: { "x-human-review-token": state.token },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Could not load the screenshot preview");
    const url = URL.createObjectURL(await response.blob());
    if (finished || key !== state.key || state.compose?.screenshot?.id !== screenshot.id) {
      URL.revokeObjectURL(url);
      return "";
    }
    const existing = state.screenshotUrls.get(screenshot.id);
    if (existing) URL.revokeObjectURL(existing.url);
    state.screenshotUrls.set(screenshot.id, { url, key });
    // Composer previews normally retain one URL. Keep a small hard bound in
    // case quick rerenders or future card thumbnails ask for several at once.
    while (state.screenshotUrls.size > 3) {
      const oldest = state.screenshotUrls.keys().next().value;
      revokeScreenshot(oldest);
    }
    return url;
  } catch (err) {
    if (err.name !== "AbortError") toast(err.message);
    return "";
  } finally {
    state.screenshotControllers.delete(controller);
  }
}

function screenshotId() {
  return globalThis.crypto?.randomUUID?.() || `shot_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function screenshotCompose(mode) {
  if (!state.compose) {
    const label = mode === "region" ? "selected area" : mode === "fullpage" || mode === "full" ? "full page" : "viewport";
    state.compose = {
      kind: "screenshot",
      quote: `Screenshot (${label})`,
      anchor: null,
      screenshot: null,
    };
    render();
  }
  return state.compose;
}

function validCaptureSize(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width * height <= 12_000_000;
}

function startCapture(mode) {
  if (finished || state.captures.size) {
    if (state.captures.size) toast("A screenshot capture is already in progress");
    return;
  }
  // A capture drag must not become another pencil stroke. Keep existing marks
  // as feedback, but exit drawing before handing the pointer to capture.
  stopDrawing();
  screenshotCompose(mode);
  const id = screenshotId();
  state.captures.set(id, { id, key: state.key, mode });
  render();
  renderToolbar();
  if (mode === "region") showCaptureHint();
  toFrame({ type: "eh:capture", id, mode });
}

async function saveScreenshot(bytes, { width, height, mode, type = "" }, key = state.key) {
  if (!validCaptureSize(width, height)) throw new Error("Screenshot is too large; captures are limited to 12 megapixels");
  const persistedMode = mode === "region" ? "region" : mode === "fullpage" || mode === "full" ? "full" : "viewport";
  const params = new URLSearchParams({ width: String(Math.round(width)), height: String(Math.round(height)), mode: persistedMode });
  if (type) params.set("type", type);
  const response = await trackWrite(fetch(`/api/page/${encodeURIComponent(key)}/screenshot?${params}`, {
    method: "POST",
    headers: { "content-type": type || "application/octet-stream", "x-human-review-token": state.token },
    body: bytes,
  }));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not save screenshot");
  if (!data.screenshot?.id) throw new Error("Screenshot server response was incomplete");
  return data.screenshot;
}

async function receiveCapture(message) {
  const capture = state.captures.get(message.id);
  if (!capture) return;
  state.captures.delete(message.id);
  clearCaptureHint();
  render();
  renderToolbar();
  if (capture.key !== state.key) return;
  if (message.cancelled) {
    dismissEmptyScreenshotCompose();
    return;
  }
  if (message.error) {
    toast(message.error);
    return;
  }
  if (!(message.bytes instanceof ArrayBuffer)) {
    toast("The page did not return screenshot bytes");
    return;
  }
  try {
    const screenshot = await saveScreenshot(message.bytes, {
      width: Number(message.width),
      height: Number(message.height),
      mode: message.mode || capture.mode,
    });
    if (finished || capture.key !== state.key || !state.compose) {
      discardScreenshot(screenshot, capture.key);
      return;
    }
    if (state.compose.screenshot) discardScreenshot(state.compose.screenshot);
    state.compose.screenshot = screenshot;
    render();
    focusComposeInput(state.compose);
  } catch (err) {
    toast(err.message);
  }
}

async function imageDimensions(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not read that screenshot"));
    });
    image.src = url;
    await loaded;
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadScreenshot(file) {
  if (!file) return;
  if (!/^(image\/png|image\/jpeg)$/.test(file.type)) {
    toast("Choose a PNG or JPEG screenshot");
    return;
  }
  const key = state.key;
  screenshotCompose("upload");
  try {
    const { width, height } = await imageDimensions(file);
    const screenshot = await saveScreenshot(await file.arrayBuffer(), { width, height, mode: "viewport", type: file.type }, key);
    if (finished || key !== state.key || !state.compose) {
      discardScreenshot(screenshot, key);
      return;
    }
    if (state.compose.screenshot) discardScreenshot(state.compose.screenshot);
    state.compose.screenshot = screenshot;
    render();
    focusComposeInput(state.compose);
  } catch (err) {
    toast(err.message);
  }
}

function clearComposeScreenshot() {
  if (!state.compose?.screenshot) return;
  discardScreenshot(state.compose.screenshot);
  state.compose.screenshot = null;
  render();
}

function dismissEmptyScreenshotCompose() {
  const compose = state.compose;
  if (compose?.kind !== "screenshot" || compose.screenshot || $("composeText").value.trim()) return;
  state.compose = null;
  render();
}

/** Opened selection and element comments focus the composer once; ordinary
 * renders still leave an existing draft and caret alone. */
async function openCompose(detail) {
  if (state.compose && $("composeText").value.trim()) await commitCompose();
  if (state.compose?.screenshot) {
    toast("Finish or cancel the screenshot comment before starting another one");
    return;
  }
  state.compose = detail;
  render();
  toFrame({ type: "eh:composeOpen" });
  $("composeText").value = "";
  if (detail.kind === "selection" || detail.kind === "element") focusComposeInput(detail);
}

/** Focus only for a newly opened comment. Regular renders must never move a
 * user's caret away from an existing draft. */
function focusComposeInput(compose) {
  requestAnimationFrame(() => {
    if (state.compose !== compose) return;
    const input = $("composeText");
    if (document.activeElement !== input) input.focus();
  });
}

function cancelCompose() {
  if (!state.compose) return;
  if (state.compose.screenshot) discardScreenshot(state.compose.screenshot);
  cancelCaptures();
  state.compose = null;
  toFrame({ type: "eh:cancel" });
  render();
}

async function commitCompose() {
  const compose = state.compose;
  const feedback = $("composeText").value.trim();
  if (!compose || !feedback) return;
  try {
    const payload = { kind: compose.kind, quote: compose.quote, anchor: compose.anchor, feedback };
    if (compose.screenshot?.id) payload.screenshot = compose.screenshot.id;
    const result = await writeApi(`/api/page/${state.key}/comment`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    toFrame({ type: "eh:commit", id: result.comment.id });
    if (compose.screenshot) revokeScreenshot(compose.screenshot.id);
    state.compose = null;
    state.page = result.page;
    state.active = result.comment.id;
    state.sent = false;
    // A capture still running belonged to this comment, which is saved now.
    // Left alone, it would hold Send on "Capturing" with nowhere to land.
    if (state.captures.size) {
      cancelCaptures();
      toast("Comment added without the screenshot, which was not captured yet");
    }
    render();
  } catch (err) {
    toast(err.message);
  }
}

// -------------------------------------------------------------------- saving

let retryTimer = null;
let saveAttempts = 0;

/** A fresh serialization from the SDK always starts a fresh attempt budget. */
function saveNow(html) {
  saveAttempts = 0;
  return saveHtml(html, state.key);
}

async function saveHtml(html, key) {
  clearTimeout(retryTimer);
  // A retry that outlived a page switch must never write into the new page.
  if (key !== state.key) return;
  if (!state.baseHash) {
    // The on-disk baseline hasn't arrived yet; wait for it rather than write blind.
    saveAttempts += 1;
    if (saveAttempts <= 20) retryTimer = setTimeout(() => saveHtml(html, key), 500);
    else {
      state.save = "failed";
      renderSave();
    }
    return;
  }
  try {
    const result = await writeApi(`/api/page/${key}/save`, { method: "POST", body: JSON.stringify({ html, baseHash: state.baseHash }) });
    state.baseHash = result.hash || null;
    state.save = "saved";
    state.savedAt = clock();
    saveAttempts = 0;
  } catch (err) {
    if (err.status === 409) {
      // Someone else — usually the agent — wrote the file first. Their version
      // arrives via the reload event; this save is abandoned, not retried.
      state.baseHash = null;
      state.save = "idle";
      saveAttempts = 0;
      renderSave();
      return;
    }
    saveAttempts += 1;
    state.save = "failed";
    if (saveAttempts < 5) retryTimer = setTimeout(() => saveHtml(html, key), 2000);
    else toast("Couldn't save — your edits still reach the agent as feedback");
  }
  renderSave();
}

// ------------------------------------------------------------ frame messages

window.addEventListener("message", async (event) => {
  if (!frame.contentWindow || event.source !== frame.contentWindow) return;
  if (!state.framePolicy || event.origin !== state.framePolicy.incomingOrigin) return;
  const msg = event.data || {};

  switch (msg.type) {
    case "eh:ready": {
      // Drawing exists only in the review overlay. A newly loaded iframe has
      // none of the prior page's canvas or pointer listeners.
      resetDrawing();
      toFrame({ type: "eh:anchors", comments: state.page ? state.page.comments : [] });
      toFrame({ type: "eh:mode", mode: state.mode });
      if (state.find.query) toFrame({ type: "eh:find", query: state.find.query, direction: 0 });
      if (state.reloading) {
        toFrame({ type: "eh:restoreScroll", x: state.scroll.x, y: state.scroll.y });
        state.reloading = false;
      }
      if (state.page && (state.page.markdown || state.page.feedbackOnly)) {
        // Rendered sources are editable here but never serialized over their source.
        toFrame({ type: "eh:feedbackOnly" });
      } else {
        // Hand the SDK the on-disk HTML so it can spot self-rendering pages.
        api(`/api/page/${state.key}/raw`)
          .then((raw) => {
            state.baseHash = raw.hash || null;
            toFrame({ type: "eh:raw", html: raw.html });
          })
          .catch(() => {});
      }
      break;
    }
    case "eh:findResult":
      state.find.count = Math.max(0, Number(msg.count) || 0);
      state.find.index = Math.max(0, Number(msg.index) || 0);
      renderToolbar();
      break;
    case "eh:findRequest":
      openFind();
      break;
    case "eh:captureRequest":
      startCapture("region");
      break;
    case "eh:sendRequest":
      if (!$("send").disabled) $("send").click();
      break;
    case "eh:error":
      toast(msg.error || "The reviewed page could not complete that action");
      break;
    case "eh:captured":
      await receiveCapture(msg);
      break;
    case "eh:drawState": {
      state.drawing = {
        active: Boolean(msg.active),
        canUndo: Boolean(msg.canUndo),
        count: Math.max(0, Number(msg.count) || 0),
      };
      renderToolbar();
      if (msg.error) toast(msg.error);
      break;
    }
    case "eh:compose":
      await openCompose({ kind: msg.kind, quote: msg.quote, anchor: msg.anchor });
      break;
    case "eh:dismiss":
      if (!$("composeText").value.trim()) cancelCompose();
      break;
    case "eh:activate":
      setActive(msg.id, false);
      break;
    case "eh:anchorStatus":
      state.orphans = new Set(msg.orphaned || []);
      render();
      break;
    case "eh:notInView":
      toast("That comment is not visible in this view");
      break;
    case "eh:edit":
      editChain = editChain.then(async () => {
        state.page = (await writeApi(`/api/page/${state.key}/edit`, {
          method: "POST",
          body: JSON.stringify({
            label: msg.label,
            kind: msg.kind,
            before: msg.before,
            after: msg.after,
            before_html: msg.before_html,
            after_html: msg.after_html,
            moved_after: msg.moved_after,
            moved_before: msg.moved_before,
            staged_assets: msg.staged_assets,
          }),
        })).page;
        state.sent = false;
        render();
      });
      await editChain.catch((err) => toast(err.message));
      break;
    case "eh:undoable":
      toast(msg.kind === "moved" ? `Moved “${tidy(msg.label, 40)}” — ⌘Z or Undo to put it back` : `Deleted “${tidy(msg.label, 40)}” — ⌘Z or Undo to restore`, {
        action: "Undo",
        ms: 8000,
        onAction: () => undoBlock(msg.label, msg.kind),
      });
      break;
    case "eh:undone":
      document.querySelectorAll(".toast").forEach((el) => el.remove());
      dropEditRow(String(msg.label || ""), String(msg.kind || ""));
      break;
    case "eh:undoFailed":
      toast(msg.kind === "moved" ? "Can't put that one back after a reload — drag it where you want it" : "Can't restore that one after a reload");
      break;
    case "eh:asset":
      try {
        const saved = await trackWrite(fetch(`/api/page/${state.key}/asset?type=${encodeURIComponent(msg.assetType || "")}`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream", "x-human-review-token": state.token },
          body: msg.bytes,
        }));
        const data = await saved.json();
        if (!saved.ok) throw new Error(data.error || "could not save the pasted image");
        toFrame({ type: "eh:assetSaved", id: msg.id, src: data.src, stagedId: data.stagedId });
      } catch (err) {
        toast(err.message);
        toFrame({ type: "eh:assetFailed", id: msg.id });
      }
      break;
    case "eh:saving":
      state.save = "saving";
      renderSave();
      break;
    case "eh:html":
      await saveNow(msg.html);
      break;
    case "eh:clean":
      // Serialization matched what is already on disk; nothing to write.
      state.save = state.savedAt ? "saved" : "idle";
      renderSave();
      break;
    case "eh:dynamic":
      if (!state.dynamic) {
        state.dynamic = true;
        // The batch says whether edits are on disk; a self-rendering page's are not.
        writeApi(`/api/page/${state.key}/mode`, { method: "POST", body: JSON.stringify({ dynamic: true }) }).catch(() => {});
      }
      renderSave();
      break;
    case "eh:flushed":
      settleFlushes();
      break;
    case "eh:scroll":
      state.scroll = { x: msg.x, y: msg.y };
      break;
    case "eh:external": {
      // This side is what actually calls window.open, so it re-checks the
      // scheme rather than trusting the frame: a javascript: or data: URL
      // arriving here would run on this origin, next to the token.
      const external = normalizeHref(msg.href);
      if (external) window.open(external, "_blank", "noopener");
      break;
    }
    case "eh:navigate":
      try {
        if (state.captures.size) {
          toast("Wait for the screenshot capture to finish before opening another page");
          return;
        }
        await flushAndPersist();
        const result = await writeApi(`/api/session/${state.sessionId}/navigate`, {
          method: "POST",
          body: JSON.stringify({ href: msg.href }),
        });
        state.scroll = { x: 0, y: 0 };
        pushHistory(result.key, result.page?.url || result.page?.file || "");
        await loadPage(result.key);
      } catch (err) {
        toast(err.message);
      }
      break;
    default:
      break;
  }
});

// ---------------------------------------------------------------- rail wiring

function setMode(mode) {
  state.mode = mode === "read" ? "read" : "edit";
  toFrame({ type: "eh:mode", mode: state.mode });
  renderToolbar();
}

function openFind() {
  state.find.open = true;
  $("helpPanel").hidden = true;
  renderToolbar();
  requestAnimationFrame(() => {
    $("findInput").focus();
    $("findInput").select();
  });
}

function closeFind() {
  state.find.open = false;
  state.find.count = 0;
  state.find.index = 0;
  toFrame({ type: "eh:find", query: "", direction: "clear" });
  renderToolbar();
}

function find(direction = 0) {
  const query = $("findInput").value;
  state.find.query = query;
  toFrame({ type: "eh:find", query, direction });
  renderToolbar();
}

$("modeEdit").addEventListener("click", () => setMode("edit"));
$("modeRead").addEventListener("click", () => setMode("read"));
document.querySelectorAll(".format-btn").forEach((button) => {
  button.addEventListener("click", () => toFrame({ type: "eh:format", command: button.dataset.format }));
});
$("findToggle").addEventListener("click", openFind);
$("findPrevious").addEventListener("click", () => find(-1));
$("findNext").addEventListener("click", () => find(1));
$("findClose").addEventListener("click", closeFind);
$("findInput").addEventListener("input", () => find(0));
$("findInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    find(event.shiftKey ? -1 : 1);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeFind();
  }
});
$("helpToggle").addEventListener("click", () => {
  $("helpPanel").hidden = !$("helpPanel").hidden;
});
$("pencilToggle").addEventListener("click", () => toFrame({ type: "eh:draw", action: "toggle" }));
$("drawingUndo").addEventListener("click", () => toFrame({ type: "eh:draw", action: "undo" }));
$("drawingClear").addEventListener("click", () => toFrame({ type: "eh:draw", action: "clear" }));
$("captureRegion").addEventListener("click", () => startCapture("region"));
$("captureViewport").addEventListener("click", () => startCapture("viewport"));
$("captureFullpage").addEventListener("click", () => startCapture("full"));
$("uploadScreenshot").addEventListener("click", () => $("screenshotFile").click());
$("screenshotFile").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  await uploadScreenshot(input.files?.[0]);
  input.value = "";
});
$("composeScreenshotRemove").addEventListener("click", clearComposeScreenshot);

$("composeAdd").addEventListener("click", commitCompose);
$("composeCancel").addEventListener("click", cancelCompose);

// Clicking anywhere on the card is the "I meant to comment" gesture.
$("compose").addEventListener("mousedown", (event) => {
  // The textarea handles its own clicks — swallowing them would pin the caret
  // to the end and make repositioning it impossible.
  if (event.target.closest("button, textarea")) return;
  event.preventDefault();
  $("composeText").focus();
});

$("composeText").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    if (isImeCommitEnter(event)) return;
    event.preventDefault();
    commitCompose();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancelCompose();
  }
});

$("send").addEventListener("click", async () => {
  if (state.sending || state.captures.size) return;
  state.sending = true;
  render();
  try {
    await flushAndPersist();
    await writeApi(`/api/page/${state.key}/send`, {
      method: "POST",
      body: JSON.stringify({ sessionId: state.sessionId, note: $("note").value.trim() }),
    });
    $("note").value = "";
    state.sent = true;
    render();
  } catch (err) {
    toast(err.message);
  } finally {
    state.sending = false;
    render();
  }
});

$("revert").addEventListener("click", async () => {
  const count = state.page.edits.length;
  if (!window.confirm(`Discard all ${count} of your edits?`)) return;
  // Stop the SDK's debounced save and our own retries first, so a queued save
  // can't land after the revert and write the edits straight back.
  toFrame({ type: "eh:abortSave" });
  clearTimeout(retryTimer);
  state.baseHash = null;
  try {
    state.page = (await writeApi(`/api/page/${state.key}/revert`, { method: "POST" })).page;
    state.save = "idle";
    state.savedAt = "";
    render();
  } catch (err) {
    toast(err.message);
  }
});

$("leftoverKeep").addEventListener("click", () => {
  state.leftover = null;
  render();
});

$("leftoverDiscard").addEventListener("click", async () => {
  try {
    await writeApi(`/api/page/${state.key}/discard`, { method: "POST" });
    state.leftover = null;
    await loadPage(state.key);
  } catch (err) {
    toast(err.message);
  }
});

/** Once the review is over or the tab is leaving, nothing may open a new session. */
let finished = false;
let ending = false;
const toastTimers = new Set();

function cancelShellTimers() {
  clearTimeout(retryTimer);
  for (const timer of toastTimers) clearTimeout(timer);
  toastTimers.clear();
}

/** The session is over: freeze the page and say so. Feedback is already safe. */
function showEnded(message) {
  finished = true;
  if (ending || document.querySelector(".ended")) return;
  ending = true;
  if (events) events.close();
  events = null;
  cancelShellTimers();
  cancelCaptures();
  if (state.compose?.screenshot) discardScreenshot(state.compose.screenshot);
  cleanupScreenshotUrls();
  const overlay = document.createElement("div");
  overlay.className = "ended";
  const title = document.createElement("h2");
  title.textContent = "Review ended";
  const line = document.createElement("p");
  line.textContent = message || "Unsent feedback is kept; next time you open this page you can restore or discard it. You can close this tab.";
  overlay.append(title, line);
  document.body.append(overlay);
  // Give debounced editor messages one final chance to reach the server before
  // destroying the iframe. Multiple callers safely share the flush waiters.
  void flushAndPersist().finally(() => {
    toFrame({ type: "eh:dispose" });
    frame.src = "about:blank";
  });
}

// A closing tab says so, and the review ends unless it comes right back (a
// reload). keepalive lets the request outlive the page; sendBeacon cannot
// carry the token header.
window.addEventListener("pagehide", () => {
  finished = true;
  if (events) events.close();
  events = null;
  cancelShellTimers();
  cancelCaptures();
  if (state.compose?.screenshot) discardScreenshot(state.compose.screenshot);
  cleanupScreenshotUrls();
  toFrame({ type: "eh:dispose" });
  try {
    fetch(`/api/session/${state.sessionId}/away`, {
      method: "POST",
      keepalive: true,
      headers: { "x-human-review-token": state.token },
    }).catch(() => {});
  } catch {}
});

$("endReview").addEventListener("click", async () => {
  const page = state.page;
  const otherTotal = (state.others || []).reduce((sum, o) => sum + o.count, 0);
  const unsent = page ? (page.comments || []).length + (page.edits || []).length + otherTotal : 0;
  const message = unsent
    ? `End this review? ${unsent} unsent ${unsent === 1 ? "item" : "items"} will be kept for next time.`
    : "End this review? The waiting agent will be told to stop polling.";
  if (!window.confirm(message)) return;
  // Ship anything still sitting in the SDK's debounce windows first.
  await flushAndPersist();
  try {
    await writeApi(`/api/session/${state.sessionId}/end`, { method: "POST" });
    showEnded();
  } catch (err) {
    toast(err.message);
  }
});

$("handoffCopy").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText($("handoffCmd").textContent);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy prompt";
    }, 1600);
  } catch {
    toast("Couldn't copy — select the prompt and copy it manually");
  }
});

$("note").addEventListener("input", (event) => {
  const el = event.target;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight + 2, window.innerHeight * 0.4)}px`;
  // Rebuilding the cards steals a live comment editor. Its page already has
  // feedback, so Send remains available while this draft is open.
  if (!state.commentDraft) render(); // keep the send button in step with note-only feedback
});

$("handle").addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("collapsed");
  const handle = $("handle");
  handle.textContent = collapsed ? "‹" : "›";
  handle.title = collapsed ? "Show comments panel" : "Hide comments panel";
  handle.setAttribute("aria-label", handle.title);
  try {
    localStorage.setItem("human-review:collapsed", collapsed ? "1" : "0");
  } catch {}
});

$("theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  applyTheme(dark);
  try {
    localStorage.setItem("human-review:theme", dark ? "dark" : "light");
  } catch {}
});

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const button = $("theme");
  button.textContent = dark ? "☀" : "☾";
  button.title = dark ? "Switch chrome to light" : "Switch chrome to dark";
  button.setAttribute("aria-label", button.title);
}

document.addEventListener("keydown", (event) => {
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === "f") {
    event.preventDefault();
    toFrame({ type: "eh:findRequest" });
    openFind();
    return;
  }
  if (meta && event.shiftKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    startCapture("region");
    return;
  }
  if (meta && event.key === "Enter") {
    if (isImeCommitEnter(event)) return;
    event.preventDefault();
    if (!$("send").disabled) $("send").click();
    return;
  }
  // ⌘S is reassurance only: flush pending keystrokes, never a state change.
  if (meta && event.key.toLowerCase() === "s") {
    event.preventDefault();
    toFrame({ type: "eh:flush" });
    renderSave();
    return;
  }
  if (event.key === "Escape" && state.captures.size) {
    event.preventDefault();
    cancelCaptures();
    return;
  }
  if (event.key === "Escape" && state.drawing.active) {
    event.preventDefault();
    stopDrawing();
    return;
  }
  if (event.key === "Escape" && state.find.open) {
    closeFind();
    return;
  }
  if (event.key === "Escape" && state.compose) cancelCompose();
});

// ------------------------------------------------------------------ events

let events = null;

function connect() {
  const source = new EventSource(`/events/${state.sessionId}`);
  events = source;
  // Another window on this session hit End review, or the server gave up on
  // a tab that never came back.
  source.addEventListener("ended", (event) => {
    let reason = "ended";
    try {
      reason = JSON.parse(event.data).reason || reason;
    } catch {}
    showEnded(reason === "window_closed" ? "This tab was away too long, so the review ended. Unsent feedback is kept; reopen the page to restore or discard it." : undefined);
  });
  source.addEventListener("reload", () => {
    const hadEdits = state.page ? state.page.edits.length : 0;
    state.reloading = true;
    state.dynamic = false;
    // The file on disk changed: queued saves are based on the old version.
    state.baseHash = null;
    clearTimeout(retryTimer);
    showInFrame(artifactUrl(state.key, true));
    api(pageUrl(state.key, state.sessionId)).then((page) => {
      replacePage(state, page);
      state.save = "idle";
      state.savedAt = "";
      render();
      // The agent's version wins, so say so rather than losing the rows silently.
      if (hadEdits && page.edits.length === 0) {
        toast(`Agent rewrote ${hadEdits} ${hadEdits === 1 ? "block" : "blocks"} you had edited`);
      }
    });
  });
  source.addEventListener("agent", (event) => {
    state.agent = JSON.parse(event.data).state;
    render();
  });
  source.addEventListener("refresh", async () => {
    replacePage(state, await api(pageUrl(state.key, state.sessionId)));
    state.sent = false;
    render();
  });
  source.onerror = () => {
    // A dropped connection reconnects on its own. A refused one (the server
    // forgot this session) never will, so open a fresh session instead.
    if (source.readyState !== EventSource.CLOSED || finished) return;
    source.close();
    rebootstrap().then((ok) => {
      if (finished) return;
      if (ok) connect();
      else showEnded("This review session expired. Run human-review on this page again to reopen it.");
    });
  };
}

// -------------------------------------------------------------------- start

(async function start() {
  try {
    applyTheme(localStorage.getItem("human-review:theme") === "dark");
    if (localStorage.getItem("human-review:collapsed") === "1") $("handle").click();
  } catch {}

  const bootstrap = await api(`/api/session/${state.sessionId}/page`).catch(() => null);
  if (!bootstrap) {
    showEnded("This review session has ended. Run human-review on the page again to reopen it.");
    return;
  }
  if (bootstrap.page) state.pollCommand = bootstrap.page.pollCommand;
  state.artifactToken = bootstrap.artifactToken || "";
  const leftover = bootstrap.leftover || { comments: 0, edits: 0 };
  state.leftover = leftover.comments + leftover.edits ? leftover : null;
  try {
    history.replaceState({ key: bootstrap.key, target: state.page.url || state.page.file }, "", `/s/${state.sessionId}?key=${encodeURIComponent(bootstrap.key)}`);
  } catch {}
  await loadPage(bootstrap.key);
  connect();
})();
