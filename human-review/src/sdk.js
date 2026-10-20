/**
 * human-review artifact SDK.
 *
 * Runs inside the sandboxed iframe alongside the artifact. It owns the
 * document: editing, highlights, target resolution and serialization. It never
 * talks to the server — everything crosses to the chrome page by postMessage.
 */
import { buildAnchor, buildContext, findQuote, findSpan, LONG_PART, LONG_SELECTION, trimSpan } from "./anchor-text.js";
import { hashClickAction, inPageControl, navigationHref } from "./click-target.js";
import { linkStyleFixup, listCommandFor, listStyleFixup, normalizeHref } from "./editing.js";
import { keepBodyEditable, serializeDocument, UI_ATTR, MARK_ATTR } from "./serialize.js";
import { capturePage } from "./screenshot.js";
import { createAnnotations } from "./annotations.js";
import { readerSettings } from "./reader.js";

// A hot reload may inject the SDK twice without replacing the document.
// Release the previous instance before installing another set of handlers.
window.__humanReviewSdk?.dispose();
const disposers = [];
let disposed = false;
let editMode = true;
let capturing = false;
let captureTask = null;
let annotations = null;
let editableObserver = null;
let renderingObserver = null;
let renderingTimer = null;
let selectionRange = null;
let outlineObserver = null;

const timers = new Set();
const animationFrames = new Set();
function later(callback, delay) {
  const id = setTimeout(() => {
    timers.delete(id);
    if (!disposed) callback();
  }, delay);
  timers.add(id);
  return id;
}
function cancelLater(id) {
  clearTimeout(id);
  timers.delete(id);
}
function nextFrame(callback) {
  const id = requestAnimationFrame(() => {
    animationFrames.delete(id);
    if (!disposed) callback();
  });
  animationFrames.add(id);
  return id;
}

function listen(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  disposers.push(() => target.removeEventListener(type, handler, options));
}

function dispose() {
  if (disposed) return;
  disposed = true;
  captureTask?.controller.abort();
  annotations?.dispose();
  annotations = null;
  cancelLater(saveTimer);
  cancelLater(editTimer);
  cancelLater(renderingTimer);
  editableObserver?.disconnect();
  renderingObserver?.disconnect();
  outlineObserver?.disconnect();
  editableObserver = renderingObserver = outlineObserver = null;
  for (const name of [PENDING_HIGHLIGHT, SECTION_HIGHLIGHT, FLASH_HIGHLIGHT]) clearHighlight(name);
  sectionHeadings.clear();
  baseline = bootSnapshot = null;
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  for (const id of animationFrames) window.cancelAnimationFrame(id);
  animationFrames.clear();
  for (const cleanup of disposers.splice(0)) cleanup();
  editQueue.clear();
  selectionRange = pending = hoverTarget = hoverMedia = resizing = null;
  bubbleRange = bubbleEl = activeBoxEl = null;
  outline = [];
  host.remove();
  document.querySelectorAll("style[data-eh-sdk]").forEach((el) => el.remove());
  document.body?.removeAttribute("contenteditable");
}
window.__humanReviewSdk = { dispose };

/**
 * True when an "Enter" keydown is really an IME confirming its composition
 * (e.g. finalizing kanji conversion), not the user asking to submit.
 */
function isImeCommitEnter(event) {
  return Boolean(event.isComposing || event.keyCode === 229);
}

const SAVE_DEBOUNCE_MS = 700;
const EDIT_FLUSH_MS = 500;
const MEDIA = /^(img|svg|canvas|video|picture|iframe|hr|figure)$/i;

// The chrome page lives on the other loopback hostname (a separate origin, so
// the reviewed document can never touch it directly). Address it explicitly so
// nothing we post can be read by any other embedder.
const CHROME_ORIGIN = `${location.protocol}//${location.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1"}:${location.port}`;

const post = (type, payload) => {
  if (!disposed) parent.postMessage({ ...payload, type }, CHROME_ORIGIN);
};

let pending = null; // { id, marks } for an uncommitted highlight
let hoverTarget = null;
let hoverMedia = null; // the img/video under the cursor, resizable via the grip
let resizing = null; // live drag state while the grip is held
let suppressUntil = 0; // ignore the mouseup/click that ends a resize drag
let saveTimer = null;
let composeOpen = false;
let bubbleRange = null; // the live range a selection comment is about, while its bubble shows
let bubbleEl = null; // the block a block comment is about, while its bubble shows
let activeBoxEl = null; // what the dark outline marks: a pending block or the active comment
let presets = []; // quick comments, as the chrome defines them: { id, label, text, bubble }
/** True when the page's own scripts rewrote the DOM before any user edit. */
let dynamic = false;

// ------------------------------------------------------------------ overlay

const host = document.createElement("div");
host.setAttribute(UI_ATTR, "");
const shadow = host.attachShadow({ mode: "open" });
shadow.innerHTML = `
  <style>
    :host { all: initial; }
    .box { position: fixed; pointer-events: none; z-index: 2147483646; border-radius: 3px; display: none; }
    .outline { border: 1px solid #c2beb4; }
    .active { border: 1px solid #1b1a16; }
    .chips {
      position: fixed; z-index: 2147483647; display: none; gap: 4px;
      pointer-events: auto;
    }
    .chip {
      width: 23px; height: 23px; display: flex;
      align-items: center; justify-content: center; padding: 0;
      border: 1px solid #e4e2db; border-radius: 50%; background: #fff; color: #6b6862;
      font: 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer; box-shadow: 0 2px 8px rgba(27,26,22,.14);
    }
    .chip:hover { background: #1b1a16; color: #fff; border-color: #1b1a16; }
    .chip.danger { color: #b23b2e; }
    .chip.danger:hover { background: #b23b2e; color: #fff; border-color: #b23b2e; }
    .chips .chip { opacity: .6; transition: opacity 100ms ease; }
    .chips .chip:hover, .chips .chip:focus-visible { opacity: 1; }
    .grip {
      position: fixed; z-index: 2147483647; width: 13px; height: 13px;
      display: none; border: 1px solid #1b1a16; border-radius: 3px;
      background: #fff; cursor: nwse-resize; pointer-events: auto;
      box-shadow: 0 1px 4px rgba(27,26,22,.2);
    }
    .hint {
      position: fixed; z-index: 2147483647; display: none; padding: 3px 7px;
      border-radius: 5px; background: #1b1a16; color: #fbfaf7; white-space: nowrap;
      font: 11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: none;
    }
    .linkbox {
      position: fixed; z-index: 2147483647; display: none; gap: 4px; align-items: center;
      padding: 5px; border: 1px solid #e4e2db; border-radius: 9px; background: #fff;
      box-shadow: 0 4px 16px rgba(27,26,22,.16); pointer-events: auto;
    }
    .linkbox input {
      width: 224px; padding: 4px 7px; border: none; outline: none; background: none;
      font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1b1a16;
    }
    .linkbox input::placeholder { color: #a29f95; }
    .chip svg { width: 12px; height: 12px; }
    .bubble {
      position: fixed; z-index: 2147483647; display: none; flex-wrap: wrap; align-items: center; gap: 2px;
      max-width: min(780px, calc(100vw - 16px)); padding: 4px; border-radius: 9px;
      background: #1b1a16; color: #fbfaf7; pointer-events: auto; user-select: none;
      box-shadow: 0 6px 22px rgba(27,26,22,.28);
      font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .bubble button {
      padding: 6px 9px; border: 0; border-radius: 6px; background: transparent; color: inherit;
      font: inherit; white-space: nowrap; cursor: pointer;
    }
    .bubble button:hover, .bubble button:focus-visible { background: rgba(255,255,255,.15); outline: none; }
    .bubble .primary { font-weight: 600; }
    .bubble .sep { width: 1px; align-self: stretch; margin: 3px 2px; background: rgba(255,255,255,.2); }
    .bubble .presets { display: contents; }
    /* On a dark page the dark bar would vanish; invert it. */
    :host([data-eh-dark]) .bubble, :host([data-eh-dark]) .hint { background: #f4f1ea; color: #1b1a16; box-shadow: 0 6px 22px rgba(0,0,0,.5); }
    :host([data-eh-dark]) .bubble button:hover, :host([data-eh-dark]) .bubble button:focus-visible { background: rgba(27,26,22,.1); }
    :host([data-eh-dark]) .bubble .sep { background: rgba(27,26,22,.2); }
  </style>
  <div class="box outline" id="outline"></div>
  <div class="box active" id="activeBox"></div>
  <div class="chips" id="chips">
    <button class="chip" id="chipComment" title="Comment on this whole block" aria-label="Comment on this whole block"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg></button>
    <button class="chip danger" id="chipDelete" title="Delete this block" aria-label="Delete this block">&#10005;</button>
  </div>
  <div class="bubble" id="bubble" role="toolbar" aria-label="Comment on this">
    <button type="button" class="primary" id="bubbleComment" title="Write a comment">Comment</button>
    <span class="sep" id="bubbleSep"></span>
    <span class="presets" id="bubblePresets"></span>
  </div>
  <div class="grip" id="grip" title="Drag to resize"></div>
  <div class="hint" id="hint"></div>
  <div class="linkbox" id="linkbox">
    <input id="linkInput" type="text" placeholder="Link to&hellip;" spellcheck="false">
    <button class="chip" id="linkApply" title="Apply link (&#9166;)" aria-label="Apply link">&#8629;</button>
    <button class="chip danger" id="linkRemove" title="Remove link" aria-label="Remove link">&#10005;</button>
  </div>
`;

const els = {};
const mountOverlay = () => {
  if (!host.isConnected) document.documentElement.appendChild(host);
  els.outline = shadow.getElementById("outline");
  els.activeBox = shadow.getElementById("activeBox");
  els.chips = shadow.getElementById("chips");
  els.chipDelete = shadow.getElementById("chipDelete");
  els.chipComment = shadow.getElementById("chipComment");
  els.bubble = shadow.getElementById("bubble");
  els.bubbleComment = shadow.getElementById("bubbleComment");
  els.bubbleSep = shadow.getElementById("bubbleSep");
  els.bubblePresets = shadow.getElementById("bubblePresets");
  els.grip = shadow.getElementById("grip");
  els.hint = shadow.getElementById("hint");
  els.linkbox = shadow.getElementById("linkbox");
  els.linkInput = shadow.getElementById("linkInput");
  els.linkApply = shadow.getElementById("linkApply");
  els.linkRemove = shadow.getElementById("linkRemove");
};

function place(box, el, pad = 2) {
  if (!el || !el.isConnected) {
    box.style.display = "none";
    return;
  }
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  box.style.left = `${r.left - pad}px`;
  box.style.top = `${r.top - pad}px`;
  box.style.width = `${r.width + pad * 2}px`;
  box.style.height = `${r.height + pad * 2}px`;
}

/** Block chips: comment in both modes, delete only while editing. */
function showChip(el) {
  if (!el || !el.isConnected) {
    els.chips.style.display = "none";
    return;
  }
  els.chipDelete.style.display = editMode ? "" : "none";
  // On a heading the chip comments on everything under it, not just the title.
  const label = isHeading(el) ? "Comment on this whole section" : "Comment on this whole block";
  els.chipComment.title = label;
  els.chipComment.setAttribute("aria-label", label);
  const r = el.getBoundingClientRect();
  // A target in a collapsed tab has no box; don't strand the chips in a corner.
  if (!r.width && !r.height) {
    els.chips.style.display = "none";
    return;
  }
  els.chips.style.display = "flex";
  els.chips.style.left = `${Math.max(4, r.right - 11)}px`;
  els.chips.style.top = `${Math.max(4, r.top - 11)}px`;
}

function showGrip(el) {
  if (!editMode) el = null;
  if (!el || !el.isConnected) {
    els.grip.style.display = "none";
    return;
  }
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) {
    els.grip.style.display = "none";
    return;
  }
  els.grip.style.display = "block";
  els.grip.style.left = `${r.right - 7}px`;
  els.grip.style.top = `${r.bottom - 7}px`;
}

function showHint(text, x, y) {
  if (!text) {
    els.hint.style.display = "none";
    return;
  }
  els.hint.textContent = text;
  els.hint.style.display = "block";
  els.hint.style.left = `${x + 12}px`;
  els.hint.style.top = `${y + 16}px`;
}

// The review toolbar floats over the top of the page; nothing of ours may hide under it.
const TOOLBAR_GUARD = 56;

function renderPresets() {
  els.bubblePresets.textContent = "";
  const shown = presets.filter((preset) => preset.bubble);
  for (const preset of shown) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.preset = preset.id;
    button.textContent = preset.label;
    button.title = preset.text;
    els.bubblePresets.append(button);
  }
  els.bubbleSep.style.display = shown.length ? "" : "none";
}

/**
 * The bubble sits next to what is being commented on: above a selection's
 * first line, or below its last when the toolbar is in the way. It follows
 * scrolling and hides while its anchor is out of view.
 */
function showBubble() {
  const hide = () => {
    els.bubble.style.display = "none";
  };
  if (bubbleEl && !bubbleEl.isConnected) bubbleEl = null;
  if (!bubbleRange && !bubbleEl) return hide();
  const box = bubbleRange ? bubbleRange.getBoundingClientRect() : bubbleEl.getBoundingClientRect();
  if ((!box.width && !box.height) || box.bottom < 0 || box.top > window.innerHeight) return hide();
  const lines = bubbleRange ? [...bubbleRange.getClientRects()].filter((r) => r.width || r.height) : [];
  const first = lines[0] || box;
  const last = lines[lines.length - 1] || box;
  els.bubble.style.display = "flex";
  const width = els.bubble.offsetWidth;
  const height = els.bubble.offsetHeight;
  let top = first.top - height - 8;
  if (top < TOOLBAR_GUARD) top = Math.min((bubbleRange ? last.bottom : first.top) + 8, window.innerHeight - height - 8);
  els.bubble.style.top = `${Math.max(TOOLBAR_GUARD, top)}px`;
  els.bubble.style.left = `${Math.max(8, Math.min(first.left, window.innerWidth - width - 8))}px`;
  return undefined;
}

function hideBubble() {
  bubbleRange = bubbleEl = null;
  els.bubble.style.display = "none";
}

// Highlights paint ranges without touching the DOM, so they never reach
// serialization, edit rows, or the self-rendering check.
const PENDING_HIGHLIGHT = "eh-pending";
const SECTION_HIGHLIGHT = "eh-section";
const FLASH_HIGHLIGHT = "eh-flash";

function setHighlight(name, range) {
  try {
    if (range && window.Highlight && CSS.highlights) CSS.highlights.set(name, new window.Highlight(range));
    else clearHighlight(name);
  } catch {
    // Browsers without the Highlight API simply show no pending mark.
  }
}

function clearHighlight(name) {
  try {
    CSS.highlights?.delete(name);
  } catch {}
}

// ------------------------------------------------------------ text plumbing

const isOurs = (node) => {
  const el = node && node.nodeType === 1 ? node : node && node.parentElement;
  return !!(el && el.closest && el.closest(`[${UI_ATTR}]`));
};

/** Flatten the body's text nodes into one string plus an offset map. */
function flatten() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (isOurs(parent)) return NodeFilter.FILTER_REJECT;
      if (/^(script|style|noscript|template)$/i.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = "";
  const map = [];
  let node = walker.nextNode();
  while (node) {
    const start = text.length;
    text += node.nodeValue;
    map.push({ node, start, end: text.length });
    node = walker.nextNode();
  }
  return { text, map };
}

/**
 * The flattened-text offset of a range boundary. Inside a text node it maps
 * directly. Between nodes — a triple-click ends at the start of the next
 * paragraph, a drag past the line end stops on the block itself — it maps to
 * the first text node after the point. Those selections used to be rejected,
 * and the click then fell through to a comment on the whole block.
 */
function pointOffset(map, container, offset) {
  if (container.nodeType === 3) {
    const entry = map.find((item) => item.node === container);
    if (entry) return entry.start + Math.min(offset, entry.end - entry.start);
  }
  const probe = document.createRange();
  try {
    probe.setStart(container, offset);
  } catch {
    return null;
  }
  // The map is in document order, so the first text node at or after the
  // point is a binary search away.
  let lo = 0;
  let hi = map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (probe.comparePoint(map[mid].node, 0) < 0) lo = mid + 1;
    else hi = mid;
  }
  if (lo < map.length) return map[lo].start;
  return map.length ? map[map.length - 1].end : 0;
}

// ---------------------------------------------------------------- sections

const HEADINGS = "h1, h2, h3, h4, h5, h6";
const isHeading = (el) => !!(el && el.nodeType === 1 && /^h[1-6]$/i.test(el.tagName));
const headingLevel = (el) => Number(el.tagName[1]);
const pageHeadings = () => [...document.body.querySelectorAll(HEADINGS)].filter((el) => !isOurs(el));

/** Section comments by id, so activating one can paint all it covers. */
const sectionHeadings = new Map();

/** A heading and everything after it, up to the next heading of the same or a higher level. */
function sectionRange(heading) {
  const level = headingLevel(heading);
  const all = pageHeadings();
  const next = all.slice(all.indexOf(heading) + 1).find((el) => headingLevel(el) <= level);
  const range = document.createRange();
  range.setStartBefore(heading);
  if (next) range.setEndBefore(next);
  else range.setEnd(document.body, document.body.childNodes.length);
  return range;
}

/** The heading a section comment names, even after the page reloaded or moved it. */
function findHeading(anchor) {
  if (!anchor || !anchor.heading) return null;
  const same = (el) => clip(el.textContent, 200) === anchor.heading;
  let byPath = null;
  try {
    byPath = anchor.selector ? document.querySelector(anchor.selector) : null;
  } catch {}
  if (isHeading(byPath) && same(byPath)) return byPath;
  const matches = pageHeadings().filter(same);
  return matches.find((el) => headingLevel(el) === Number(anchor.level)) || matches[0] || null;
}

/** Mark a heading's own words, the visible handle of a section comment. */
function wrapElementText(el, id) {
  const { text, map } = flatten();
  const inside = map.filter((entry) => el.contains(entry.node));
  if (!inside.length) return [];
  const span = trimSpan(text, inside[0].start, inside[inside.length - 1].end);
  return span ? wrapOffsets(map, span.start, span.end, id) : [];
}

/** A live range over a flattened-text span, for highlighting and placement. */
function rangeFromOffsets(map, start, end) {
  const first = map.find((entry) => entry.end > start);
  let last = null;
  for (const entry of map) {
    if (entry.start >= end) break;
    last = entry;
  }
  if (!first || !last) return null;
  const range = document.createRange();
  try {
    range.setStart(first.node, Math.max(0, start - first.start));
    range.setEnd(last.node, Math.min(last.node.nodeValue.length, end - last.start));
  } catch {
    return null;
  }
  return range;
}

/** Wrap a global offset span in <mark> elements, one per text node touched. */
function wrapOffsets(map, start, end, id) {
  const marks = [];
  for (const entry of map) {
    if (entry.end <= start || entry.start >= end) continue;
    const from = Math.max(0, start - entry.start);
    const to = Math.min(entry.node.nodeValue.length, end - entry.start);
    if (to <= from) continue;
    const range = document.createRange();
    try {
      range.setStart(entry.node, from);
      range.setEnd(entry.node, to);
      const mark = document.createElement("mark");
      mark.setAttribute(MARK_ATTR, id);
      range.surroundContents(mark);
      marks.push(mark);
    } catch {
      // A node that shifted under us is skipped rather than corrupting the DOM.
    }
  }
  return marks;
}

function marksFor(id) {
  return [...document.querySelectorAll(`mark[${MARK_ATTR}="${CSS.escape(id)}"]`)];
}

function unwrap(id) {
  for (const mark of marksFor(id)) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

// ------------------------------------------------------- target resolution

function isBlock(el) {
  if (!el || el.nodeType !== 1) return false;
  const display = getComputedStyle(el).display;
  return /^(block|flex|grid|list-item|table|flow-root)$/.test(display);
}

function hasOwnText(el) {
  return [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
}

/** A body-anchored, fully indexed path, so it resolves to one element only. */
function cssPath(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== document.body && parts.length < 8) {
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      return parts.join(" > ");
    }
    const tag = node.tagName.toLowerCase();
    const twins = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : [];
    parts.unshift(twins.length > 1 ? `${tag}:nth-of-type(${twins.indexOf(node) + 1})` : tag);
    node = node.parentElement;
  }
  return ["body", ...parts].join(" > ");
}

/** The heading a block sits under, used to name edits in arbitrary HTML. */
function precedingHeading(el) {
  let node = el;
  while (node && node !== document.body) {
    let sib = node.previousElementSibling;
    while (sib) {
      if (/^h[1-6]$/i.test(sib.tagName) && sib.textContent.trim()) return sib.textContent.trim();
      const nested = sib.querySelectorAll ? sib.querySelectorAll("h1,h2,h3,h4,h5,h6") : [];
      for (let i = nested.length - 1; i >= 0; i -= 1) {
        if (nested[i].textContent.trim()) return nested[i].textContent.trim();
      }
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
  }
  return "";
}

const clip = (text, limit = 40) => {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
};

/**
 * A block's label is pinned the first time it is computed. Labels derived
 * from the block's own text or position would drift as the user types or
 * deletes siblings, splitting one block's edit into several contradictory
 * rows keyed on each intermediate wording.
 */
const pinnedLabels = new WeakMap();

/**
 * Sibling order as the page loaded. Ordinals in labels ("p 3") come from
 * here, so deleting a paragraph does not renumber the ones after it and hand
 * two different blocks the same label within one review.
 */
const bootChildren = new WeakMap();
function snapshotOrder() {
  for (const el of [document.body, ...document.body.querySelectorAll("*")]) {
    if (el.children.length > 1 && !isOurs(el)) bootChildren.set(el, [...el.children]);
  }
}

/** The block a hover/edit belongs to, plus a human label for the edit list. */
function targetFor(node) {
  const el = node && node.nodeType === 1 ? node : node && node.parentElement;
  if (!el || isOurs(el)) return null;

  const authored = el.closest("[data-container],[data-block]");
  if (authored) {
    const label = authored.getAttribute("data-container") || authored.getAttribute("data-block");
    return { el: authored, label: clip(label), authored: true };
  }

  let block = el;
  while (block && block !== document.body && !isBlock(block)) block = block.parentElement;
  if (!block || block === document.body || !block.textContent.trim()) {
    if (el !== document.body && MEDIA.test(el.tagName)) block = el;
    else return null;
  }

  if (!pinnedLabels.has(block)) {
    // A heading names itself; the heading before it would mislabel the edit.
    const heading = /^h[1-6]$/i.test(block.tagName) ? "" : precedingHeading(block);
    const tag = block.tagName.toLowerCase();
    // Siblings of the same tag would otherwise share a label and collapse into
    // one edit row, so number them — by their order at load, not right now.
    const parent = block.parentElement;
    const live = parent ? [...parent.children] : [];
    const booted = parent ? bootChildren.get(parent) : null;
    const siblings = booted && booted.includes(block) ? booted : live;
    const twins = siblings.filter((c) => c.tagName === block.tagName);
    const ordinal = twins.length > 1 ? ` ${twins.indexOf(block) + 1}` : "";
    pinnedLabels.set(block, heading ? `${clip(heading, 26)} · ${tag}${ordinal}` : clip(block.textContent, 40) || tag);
  }
  return { el: block, label: pinnedLabels.get(block), authored: false };
}

/**
 * The nearest rendered block around a node, ignoring authored data-block
 * containers. List conversion and drop targeting need the line the caret is
 * actually on, not the labeled region it reports edits under.
 */
function innermostBlock(node) {
  let el = node && node.nodeType === 1 ? node : node && node.parentElement;
  while (el && el !== document.body && !isBlock(el)) el = el.parentElement;
  return el && el !== document.body ? el : null;
}

/**
 * After a list command: hoist the fresh list out of the paragraph Chrome
 * sometimes nests it in (invalid HTML that a reparse would restructure), and
 * make sure the page's CSS reset can't hide it.
 */
function polishNewList(sel) {
  const node = sel && sel.anchorNode;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const item = el && el.closest ? el.closest("li") : null;
  const list = item ? item.closest("ul, ol") : null;
  if (!list) return;
  const wrap = list.parentElement;
  if (wrap && /^(p|h[1-6])$/i.test(wrap.tagName) && wrap.childNodes.length === 1) {
    wrap.replaceWith(list);
  }
  const patch = listStyleFixup(list.tagName, getComputedStyle(list));
  if (patch.listStyleType) list.style.listStyleType = patch.listStyleType;
  if (patch.paddingLeft) list.style.paddingLeft = patch.paddingLeft;
}

/** The caret position a drag at (x, y) would drop into. */
function caretRangeAt(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    return range;
  }
  return null;
}

// ------------------------------------------------------------ serialization

const serialize = () => serializeDocument(document);

/**
 * A single block's HTML with every review artifact removed. outerHTML, not
 * innerHTML: changes to the block's own attributes (an image's new width, for
 * one) live on the element itself, and a void element has no inner markup.
 */
function blockHtml(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll(`[${UI_ATTR}]`).forEach((n) => n.remove());
  clone.querySelectorAll(`mark[${MARK_ATTR}]`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
  clone.querySelectorAll("[data-eh-el]").forEach((n) => n.removeAttribute("data-eh-el"));
  clone.removeAttribute("data-eh-el");
  clone.normalize();
  return clone.outerHTML;
}

/**
 * Serialization is lossy about formatting, so a save that would not change the
 * document is skipped outright. Opening a file must never rewrite it.
 */
let baseline = null;
/** What the document looked like at boot, before any user edit. */
let bootSnapshot = null;

/**
 * Compare the live document against the file on disk (parsed the same way,
 * without running its scripts). A mismatch means the page renders itself —
 * writing the live DOM back would bake that output into the file, so saves
 * are disabled and edits travel to the agent as feedback only.
 */
function checkDynamic(diskHtml) {
  try {
    const parsed = new DOMParser().parseFromString(diskHtml, "text/html");
    if (serializeDocument(parsed) !== bootSnapshot) markDynamic();
  } catch {
    // If the comparison itself fails, keep saving as normal.
  }
}

function markDynamic() {
  if (dynamic) return;
  dynamic = true;
  cancelLater(saveTimer);
  post("eh:dynamic", {});
}

/** True once the user has actually edited, as opposed to the page's own scripts. */
let userEdited = false;

/**
 * The boot comparison only catches scripts that rewrote the DOM before this
 * module ran. Pages that render on load or after a fetch (charts, mermaid,
 * client-rendered apps) mutate later — watch for any serialization drift that
 * happens before the first real user edit and treat it the same way.
 */
function watchSelfRendering() {
  const observer = new MutationObserver((records) => {
    if (dynamic || userEdited) {
      observer.disconnect();
      return;
    }
    if (capturing || records.every((record) => {
      const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (el?.closest?.(`[${UI_ATTR}], [data-eh-sdk]`)) return true;
      if (record.type === "attributes" && /^(data-eh-|contenteditable|spellcheck)/.test(record.attributeName)) return true;
      return record.type === "childList" && [...record.addedNodes, ...record.removedNodes].every((node) => node.nodeType === 1 && (node.hasAttribute(UI_ATTR) || node.hasAttribute("data-eh-sdk")));
    })) return;
    cancelLater(renderingTimer);
    renderingTimer = later(() => {
      if (disposed || dynamic || userEdited || capturing) return;
      if (serialize() !== bootSnapshot) {
        observer.disconnect();
        markDynamic();
      }
    }, 100);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
  renderingObserver = observer;
}

function emitSave() {
  if (dynamic) {
    post("eh:dynamic", {});
    return;
  }
  const html = serialize();
  if (html === baseline) {
    post("eh:clean", {});
    return;
  }
  baseline = html;
  post("eh:html", { html });
}

function scheduleSave() {
  cancelLater(saveTimer);
  if (!dynamic) post("eh:saving", {});
  saveTimer = later(emitSave, SAVE_DEBOUNCE_MS);
}

function flushSave() {
  cancelLater(saveTimer);
  flushEdits();
  emitSave();
}

// ------------------------------------------------------------- edit tracking

/**
 * One POST per keystroke would hammer the server (each save rewrites the whole
 * state file), so edits queue up and flush together. The store dedupes on
 * label+kind and only the latest `after` matters, so coalescing loses nothing.
 */
const editQueue = new Map();
let editTimer = null;

function flushEdits() {
  cancelLater(editTimer);
  editTimer = null;
  for (const payload of editQueue.values()) post("eh:edit", payload);
  editQueue.clear();
}

function queueEdit(payload) {
  const key = `${payload.label}\u0000${payload.kind}`;
  const queued = editQueue.get(key);
  if (queued && (queued.staged_assets || payload.staged_assets)) {
    const assets = [...(queued.staged_assets || []), ...(payload.staged_assets || [])];
    payload.staged_assets = [...new Map(assets.map((asset) => [asset.path || asset.id, asset])).values()];
  }
  editQueue.set(key, payload);
  cancelLater(editTimer);
  editTimer = later(flushEdits, EDIT_FLUSH_MS);
}

// ------------------------------------------------------------- interactions

function markActive(el) {
  activeBoxEl = el && el.isConnected ? el : null;
  place(els.activeBox, activeBoxEl);
}

function clearPending() {
  if (pending && pending.kind === "section") clearHighlight(SECTION_HIGHLIGHT);
  pending = null;
  markActive(null);
  setHighlight(PENDING_HIGHLIGHT, null);
  hideBubble();
}

/**
 * A settled selection opens the compose card but is otherwise left completely
 * alone: still selected, still editable. Nothing is written into the document
 * until the comment is actually committed, so typing or Backspace behaves
 * exactly as it would in any editable page. The pending span is painted as a
 * highlight instead, so it stays visible once focus moves to the comment field.
 */
function settleSelection() {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const common = range.commonAncestorContainer;
  if (!document.body.contains(common) || isOurs(common)) return false;

  const { text, map } = flatten();
  const start = pointOffset(map, range.startContainer, range.startOffset);
  const end = pointOffset(map, range.endContainer, range.endOffset);
  const span = start === null || end === null ? null : trimSpan(text, start, end);
  if (!span) return false;

  const context = buildContext(text, span.start, span.end);
  if (pending && pending.kind === "section") clearHighlight(SECTION_HIGHLIGHT);
  pending = { kind: "selection", context, span };
  const marked = rangeFromOffsets(map, span.start, span.end);
  markActive(null);
  setHighlight(PENDING_HIGHLIGHT, marked);
  bubbleEl = null;
  bubbleRange = marked;
  showBubble();

  // A long passage quotes its opening and closing words, joined by […].
  const said = sel.toString().trim() || context.quote;
  const quote = said.length > LONG_SELECTION ? `${said.slice(0, LONG_PART).trimEnd()} […] ${said.slice(-LONG_PART).trimStart()}` : said;
  post("eh:compose", {
    kind: "selection",
    quote,
    anchor: { ...buildAnchor(text, span.start, span.end), selector: cssPath(common.nodeType === 1 ? common : common.parentElement || document.body) },
  });
  return true;
}

/** Comment on a heading's whole section: it, and everything under it. */
function openSectionCompose(heading, { focus = false } = {}) {
  if (pending && pending.kind === "section" && pending.heading === heading) {
    if (focus) post("eh:composeFocus", {});
    return;
  }
  clearPending();
  pending = { kind: "section", heading };
  setHighlight(SECTION_HIGHLIGHT, sectionRange(heading));
  bubbleEl = heading;
  showBubble();
  const title = clip(heading.textContent, 200);
  post("eh:compose", {
    kind: "section",
    quote: title,
    anchor: { heading: title, level: headingLevel(heading), selector: cssPath(heading) },
    focus,
  });
}

function openElementCompose(container, { focus = false } = {}) {
  if (pending && pending.element === container.el) {
    if (focus) post("eh:composeFocus", {});
    return;
  }
  if (pending && pending.kind === "section") clearHighlight(SECTION_HIGHLIGHT);
  pending = { kind: "element", element: container.el };
  setHighlight(PENDING_HIGHLIGHT, null);
  markActive(container.el);
  bubbleRange = null;
  bubbleEl = container.el;
  showBubble();
  post("eh:compose", {
    kind: "element",
    quote: container.label,
    anchor: { selector: cssPath(container.el), label: container.label },
    focus,
  });
}

const BLOCK_WITHOUT_TEXT = "img, svg, canvas, video, picture, iframe, figure, .diagram";

/**
 * A comment on a whole block takes a deliberate gesture: Alt-click, or the
 * block's comment chip. A plain click only does so where there is no text to
 * select (an image, a diagram) or on an authored data-container. Anywhere
 * else a click places the caret, and must not pull focus into the comment
 * field while the user is trying to edit.
 */
function blockCommentTarget(node, deliberate) {
  const el = node && node.nodeType === 1 ? node : node && node.parentElement;
  if (!el || !el.closest || isOurs(el)) return null;
  if (deliberate || el.closest("[data-container]")) return targetFor(el);
  const media = el.closest(BLOCK_WITHOUT_TEXT);
  return media ? targetFor(media) : null;
}

/** Commit turns the remembered range into real <mark> wrappers. */
function commitPending(id) {
  if (!pending) return;
  if (pending.kind === "section") {
    if (pending.heading.isConnected) {
      wrapElementText(pending.heading, id);
      sectionHeadings.set(id, pending.heading);
    }
  } else if (pending.kind === "element") {
    if (pending.element && pending.element.isConnected) pending.element.setAttribute("data-eh-el", id);
  } else {
    const { text, map } = flatten();
    // The settled span is exact while the text around it is unchanged; only
    // edits made since the selection need the quote to be searched again.
    const { span, context } = pending;
    const hit = span && text.slice(span.start, span.end) === context.quote ? span : findQuote(text, context);
    if (hit) wrapOffsets(map, hit.start, hit.end, id);
  }
  const sel = document.getSelection();
  if (sel) sel.removeAllRanges();
  clearPending();
}

function reanchor(comments) {
  const resolved = [];
  const orphaned = [];
  for (const comment of comments) {
    const existing = marksFor(comment.id);
    if (existing.length) {
      if (comment.kind === "section") sectionHeadings.set(comment.id, existing[0].closest(HEADINGS));
      resolved.push(comment.id);
      continue;
    }
    if (comment.kind === "section") {
      const heading = findHeading(comment.anchor);
      if (heading) {
        wrapElementText(heading, comment.id);
        sectionHeadings.set(comment.id, heading);
      }
      (heading ? resolved : orphaned).push(comment.id);
      continue;
    }
    if (comment.kind === "element") {
      const el = comment.anchor && comment.anchor.selector ? document.querySelector(comment.anchor.selector) : null;
      // Re-stamp the marker, or "Jump to" has nothing to find after a reload.
      if (el) el.setAttribute("data-eh-el", comment.id);
      (el ? resolved : orphaned).push(comment.id);
      continue;
    }
    const { text, map } = flatten();
    const hit = comment.anchor ? findSpan(text, comment.anchor) : null;
    if (!hit) {
      orphaned.push(comment.id);
      continue;
    }
    const marks = wrapOffsets(map, hit.start, hit.end, comment.id);
    (marks.length ? resolved : orphaned).push(comment.id);
  }
  post("eh:anchorStatus", { resolved, orphaned });
}

/** Open the collapsed tab or accordion a target sits in, when a control names it. */
function revealHidden(target) {
  let hidden = target.closest("[hidden]") || null;
  if (!hidden) {
    let probe = target.parentElement;
    while (probe && probe !== document.body) {
      if (getComputedStyle(probe).display === "none") {
        hidden = probe;
        break;
      }
      probe = probe.parentElement;
    }
  }
  if (hidden) {
    const control = hidden.id ? document.querySelector(`[aria-controls="${CSS.escape(hidden.id)}"]`) : null;
    if (control) control.click();
  }
}

function activate(id, scroll) {
  const marks = marksFor(id);
  let target = marks[0] || null;
  if (!target) {
    const el = document.querySelector(`[data-eh-el="${CSS.escape(id)}"]`);
    if (el) target = el;
  }
  for (const mark of document.querySelectorAll(`mark[${MARK_ATTR}]`)) mark.classList.remove("eh-active");
  for (const mark of marks) mark.classList.add("eh-active");
  markActive(target);
  const heading = sectionHeadings.get(id);
  if (heading && heading.isConnected) setHighlight(SECTION_HIGHLIGHT, sectionRange(heading));
  else if (!(pending && pending.kind === "section")) clearHighlight(SECTION_HIGHLIGHT);
  if (target && scroll) {
    revealHidden(target);
    const rect = target.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      post("eh:notInView", { id });
      return;
    }
    // scrollIntoView walks every scrollable ancestor, so targets inside an
    // app's inner scroll container are reached too, not just window-scrolled ones.
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

// ----------------------------------------------------------------- outline

/**
 * The page's headings, for the contents panel. The chrome only ever sees
 * levels and text; clicks come back as an index into this list, which is
 * rebuilt whenever the headings themselves change.
 */
const OUTLINE_LIMIT = 400;
let outline = [];
let outlineSignature = null;
let outlineActive = -1;
let outlineTimer = null;
let spyLockUntil = 0;
let flashTimer = null;
const WORDS_PER_MINUTE = 230;

function collectOutline() {
  const headings = [...document.body.querySelectorAll("h1, h2, h3, h4, h5, h6")]
    .filter((el) => !isOurs(el) && el.textContent.trim())
    .slice(0, OUTLINE_LIMIT);
  const items = headings.map((el) => ({ level: Number(el.tagName[1]), text: clip(el.textContent, 120) }));
  const signature = items.map((item) => `${item.level}:${item.text}`).join("\n");
  outline = headings;
  if (signature === outlineSignature) return;
  const first = outlineSignature === null;
  outlineSignature = signature;
  outlineActive = -1;
  // Reading time comes from the boot text; recounting on every keystroke
  // in a long document would cost more than the estimate is worth.
  const minutes = first ? Math.max(1, Math.round((flatten().text.match(/\S+/g) || []).length / WORDS_PER_MINUTE)) : undefined;
  post("eh:outline", { items, ...(minutes ? { minutes } : {}) });
  updateOutlineActive();
}

function scheduleOutline() {
  cancelLater(outlineTimer);
  outlineTimer = later(collectOutline, 400);
}

/** The heading being read: the last one that has scrolled past the toolbar. */
function updateOutlineActive() {
  if (!outline.length || Date.now() < spyLockUntil) return;
  const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  let index = -1;
  for (let i = 0; i < outline.length; i += 1) {
    const r = outline[i].getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (r.top <= TOOLBAR_GUARD + 40 || (atBottom && r.top < window.innerHeight)) index = i;
  }
  setOutlineActive(index);
}

function setOutlineActive(index) {
  if (index === outlineActive) return;
  outlineActive = index;
  post("eh:outlineActive", { index });
}

const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function goToHeading(index) {
  const el = outline[index];
  if (!el || !el.isConnected) return;
  revealHidden(el);
  const rect = el.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    post("eh:headingHidden", {});
    return;
  }
  // A smooth scroll passes every heading on the way; report the destination.
  spyLockUntil = Date.now() + 900;
  setOutlineActive(index);
  el.scrollIntoView?.({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  const range = document.createRange();
  range.selectNodeContents(el);
  setHighlight(FLASH_HIGHLIGHT, range);
  cancelLater(flashTimer);
  flashTimer = later(() => clearHighlight(FLASH_HIGHLIGHT), 1600);
}

// ----------------------------------------------------------------- reading

/**
 * Reading settings apply to pages whose styling is ours — rendered Markdown,
 * which declares every variant itself. An HTML artifact styles itself and is
 * left exactly as authored.
 */
const readerPage = () => !!document.querySelector('meta[name="human-review-reader"]');

function applyReader(settings) {
  if (!readerPage()) return;
  for (const [name, value] of Object.entries(readerSettings(settings))) {
    document.documentElement.setAttribute(`data-eh-${name}`, value);
  }
  host.toggleAttribute("data-eh-dark", document.documentElement.getAttribute("data-eh-theme") === "dark");
}

function postScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  post("eh:scroll", {
    x: window.scrollX,
    y: window.scrollY,
    progress: max > 4 ? Math.min(1, Math.max(0, window.scrollY / max)) : null,
  });
}

// -------------------------------------------------------------------- boot

function boot() {
  mountOverlay();

  const style = document.createElement("style");
  style.setAttribute("data-eh-sdk", "");
  style.textContent = `
    mark[${MARK_ATTR}] { background: rgba(245,196,0,.32); border-radius: 2px; color: inherit; cursor: pointer; }
    mark[${MARK_ATTR}]:hover { background: rgba(243,176,0,.5); }
    mark[${MARK_ATTR}].eh-active { background: rgba(255,180,0,.55); }
    body[contenteditable]:focus { outline: none; }
    ::selection { background: rgba(245,196,0,.42); }
    ::highlight(eh-pending) { background-color: rgba(245,196,0,.34); text-decoration: underline 2px rgba(201,149,0,.85); }
    ::highlight(eh-section) { background-color: rgba(245,196,0,.16); }
    ::highlight(eh-flash) { background-color: rgba(245,196,0,.38); }
    :where(h1, h2, h3, h4, h5, h6) { scroll-margin-top: ${TOOLBAR_GUARD + 8}px; }
  `;
  document.head.appendChild(style);

  // React/Next.js hydration may remove an attribute that was added after the
  // server rendered the page. Keep edit mode on after hydration settles so a
  // real app stays directly editable, not just its initial HTML response.
  editableObserver = keepBodyEditable(document.body);
  document.body.spellcheck = false;
  snapshotOrder();
  baseline = serialize();
  bootSnapshot = baseline;
  watchSelfRendering();

  annotations = createAnnotations({
    document,
    onState: (state) => post("eh:drawState", state),
    onShortcut: (action) => {
      if (action === "cancel") captureTask?.controller.abort();
      else post(action === "capture" ? "eh:captureRequest" : "eh:sendRequest", {});
    },
  });

  // A new press starts a new interaction; the old bubble would point at nothing.
  listen(document, "mousedown", (event) => {
    if (!isOurs(event.target)) hideBubble();
  }, true);

  listen(document, "mouseup", (event) => {
    if (isOurs(event.target) || resizing || Date.now() < suppressUntil) return;
    const { target, altKey } = event;
    later(() => {
      if (settleSelection()) return;
      // Alt-click on a heading takes its whole section; anywhere else, the block.
      const el = target && target.nodeType === 1 ? target : target && target.parentElement;
      const heading = altKey && el ? el.closest(HEADINGS) : null;
      if (heading && !isOurs(heading)) {
        openSectionCompose(heading, { focus: true });
        return;
      }
      const block = blockCommentTarget(target, altKey);
      if (block) {
        openElementCompose(block, { focus: altKey });
        return;
      }
      post("eh:dismiss", {});
    }, 0);
  });

  listen(els.chipComment, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isHeading(hoverTarget)) {
      openSectionCompose(hoverTarget, { focus: true });
      return;
    }
    const target = hoverTarget ? targetFor(hoverTarget) : null;
    if (target) openElementCompose(target, { focus: true });
  });

  // Pressing a bubble button must not take the selection or focus with it.
  listen(els.bubble, "mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  listen(els.bubble, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const button = event.target.closest ? event.target.closest("button") : null;
    if (!button) return;
    if (button === els.bubbleComment) post("eh:composeFocus", {});
    else if (button.dataset.preset) {
      els.bubble.style.display = "none";
      post("eh:preset", { id: button.dataset.preset });
    }
  });

  // A selection made with the keyboard (Shift+arrows, Shift+Home/End) never
  // produces a mouseup, so settle it when the key is released instead. The
  // wait lets a selection being extended settle once, not on every keystroke.
  let keySelectTimer = null;
  listen(document,
    "keyup",
    (event) => {
      if (isOurs(event.target) || resizing || linkState) return;
      const extending = event.shiftKey && /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key);
      const selectAll = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a";
      if (event.key !== "Shift" && !extending && !selectAll) return;
      cancelLater(keySelectTimer);
      keySelectTimer = later(() => {
        if (Date.now() < suppressUntil || composeOpen) return;
        settleSelection();
      }, 250);
    },
    true
  );

  listen(document,
    "click",
    (event) => {
      if (isOurs(event.target)) return;
      const modified = event.metaKey || event.ctrlKey;
      const href = navigationHref(event.target);

      if (modified) {
        if (href) {
          event.preventDefault();
          event.stopPropagation();
          if (/^(https?:)?\/\//i.test(href) || /^mailto:/i.test(href)) post("eh:external", { href: new URL(href, document.baseURI).href });
          else if (href.startsWith("#")) {
            const action = hashClickAction(href, location.hash);
            if (action.kind === "scroll") {
              const el = document.getElementById(action.id) || document.getElementsByName(action.id)[0] || document.body;
              el.scrollIntoView({ behavior: "smooth" });
            } else {
              location.hash = action.hash;
            }
          }
          else {
            // This document is about to be torn down: anything still sitting in
            // the debounce windows must ship first or it is lost. Message order
            // is guaranteed, so the edits land before the navigation does.
            flushSave();
            post("eh:navigate", { href });
          }
        }
        return; // let the artifact's own handlers run
      }

      // Plain clicks belong to editing: never navigate, never fire artifact JS.
      // A <summary>, tab, or other in-page toggle keeps working: collapsed
      // content must stay reachable, and its text stays editable either way.
      const button = event.target.closest && event.target.closest("button, [role='button']");
      if (href || (button && !inPageControl(event.target))) {
        event.preventDefault();
        event.stopPropagation();
      }
      const mark = event.target.closest && event.target.closest(`mark[${MARK_ATTR}]`);
      if (mark) post("eh:activate", { id: mark.getAttribute(MARK_ATTR) });
    },
    true
  );

  listen(document, "submit", (event) => {
    if (!event.metaKey && !event.ctrlKey) event.preventDefault();
  }, true);

  listen(document, "mouseover", (event) => {
    if (isOurs(event.target) || resizing) return;
    const target = targetFor(event.target);
    hoverTarget = target ? target.el : null;
    hoverMedia = event.target.closest ? event.target.closest("img, video") : null;
    place(els.outline, hoverTarget);
    if (controlsAreSuppressed()) hideActionControls();
    else showChip(hoverTarget);
    showGrip(hoverMedia);
    const interactive = event.target.closest && event.target.closest("a[href], [data-href], button, [role='button']") && (navigationHref(event.target) || !inPageControl(event.target));
    const draggable = hoverMedia && hoverMedia.tagName === "IMG";
    showHint(interactive ? "⌘-click to open" : draggable ? "Drag to move" : "", event.clientX, event.clientY);
  });

  listen(document, "mouseleave", () => {
    if (resizing) return;
    hoverTarget = null;
    hoverMedia = null;
    place(els.outline, null);
    showChip(null);
    showGrip(null);
    showHint("");
  });

  // ------------------------------------------------------------ image resize

  listen(els.grip, "pointerdown", (event) => {
    if (!hoverMedia || !hoverMedia.isConnected) return;
    event.preventDefault();
    event.stopPropagation();
    // From here on, DOM changes are the human resizing, not the page rendering.
    userEdited = true;
    const target = targetFor(hoverMedia);
    const blockEl = target ? target.el : hoverMedia;
    resizing = {
      el: hoverMedia,
      startX: event.clientX,
      startWidth: hoverMedia.getBoundingClientRect().width,
      label: target ? target.label : "Image",
      blockEl,
      beforeText: blockEl.textContent,
      beforeHtml: blockHtml(blockEl),
    };
    if (els.grip.setPointerCapture) els.grip.setPointerCapture(event.pointerId);
  });

  listen(window, "pointermove", (event) => {
    if (!resizing) return;
    event.preventDefault();
    const width = Math.max(24, Math.round(resizing.startWidth + (event.clientX - resizing.startX)));
    resizing.el.style.width = `${width}px`;
    resizing.el.style.height = "auto";
    place(els.outline, hoverTarget);
    showGrip(resizing.el);
  });

  listen(window, "pointerup", () => {
    if (!resizing) return;
    const { blockEl, label, beforeText, beforeHtml } = resizing;
    resizing = null;
    suppressUntil = Date.now() + 250;
    queueEdit({
      label,
      kind: "edited",
      before: beforeText,
      after: blockEl.textContent,
      before_html: beforeHtml,
      after_html: blockHtml(blockEl),
    });
    scheduleSave();
  });

  /**
   * A block delete has no native undo, so every one stays restorable for the
   * life of the page: the element itself, detached, plus where it came from.
   * The chrome's per-row Undo and ⌘Z both come here.
   */
  const undoStack = []; // [{ kind, el, parent, next, label, at }]
  disposers.push(() => { undoStack.length = 0; });
  const remember = (entry) => {
    undoStack.push({ ...entry, at: Date.now() });
    if (undoStack.length > 50) undoStack.shift();
  };
  /** Timestamp of the last keystroke, so ⌘Z after typing stays the browser's own undo. */
  let lastInputAt = 0;

  listen(els.chipDelete, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!hoverTarget) return;
    userEdited = true;
    const target = targetFor(hoverTarget);
    const label = target ? target.label : "Element";
    const before = hoverTarget.textContent;
    remember({ kind: "deleted", el: hoverTarget, parent: hoverTarget.parentNode, prev: hoverTarget.previousSibling, next: hoverTarget.nextSibling, label });
    hoverTarget.remove();
    hoverTarget = null;
    place(els.outline, null);
    showChip(null);
    queueEdit({ label, kind: "deleted", before, after: "" });
    flushSave();
    post("eh:undoable", { label, kind: "deleted" });
  });

  const restoreBlock = (label, kind) => {
    let index = -1;
    for (let i = undoStack.length - 1; i >= 0; i -= 1) {
      if (undoStack[i].label === label && undoStack[i].kind === kind) {
        index = i;
        break;
      }
    }
    const undo = index === -1 ? null : undoStack[index];
    if (!undo || !undo.parent || !undo.parent.isConnected) {
      // Nothing to put back: the page reloaded since, or the spot is gone.
      post("eh:undoFailed", { label, kind });
      return false;
    }
    undoStack.splice(index, 1);
    // Either neighbor may have been deleted or moved since; use whichever is
    // still in place, and only fall back to the end when both are gone.
    const next = undo.next && undo.next.parentNode === undo.parent ? undo.next : null;
    const prev = undo.prev && undo.prev.parentNode === undo.parent ? undo.prev : null;
    undo.parent.insertBefore(undo.el, next || (prev ? prev.nextSibling : null));
    undo.el.style.opacity = "";
    // The chrome drops the row on eh:undone; the block is back to its captured
    // original, so there is nothing new to report — only the file to write again.
    flushSave();
    post("eh:undone", { label, kind });
    return true;
  };

  // beforeinput still sees the untouched wording, so capture it once per block.
  const originalText = new WeakMap();
  const originalHtml = new WeakMap();
  const captureOriginal = (el) => {
    if (!originalText.has(el)) {
      originalText.set(el, el.textContent);
      originalHtml.set(el, blockHtml(el));
    }
  };

  /**
   * A list command replaces the paragraph with fresh <li>/<ul> elements. They
   * inherit its label and captured original, so the edit row still reads
   * "this paragraph became a list" instead of a row for an unknown block with
   * no `before`.
   */
  const adoptIdentity = (source, created) => {
    if (!source || !created || created === source.el) return;
    // The input event fired inside execCommand, before this ran, and the
    // fresh element named itself ("li 3", no `before`). Retract that row.
    const stale = pinnedLabels.get(created);
    if (stale && stale !== source.label) editQueue.delete(`${stale}\u0000edited`);
    pinnedLabels.set(created, source.label);
    if (!originalText.has(created) && originalText.has(source.el)) {
      originalText.set(created, originalText.get(source.el));
      originalHtml.set(created, originalHtml.get(source.el));
    }
  };

  const afterListCommand = (source) => {
    const sel = document.getSelection();
    polishNewList(sel);
    if (!source || source.authored) return;
    const node = sel && sel.anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const item = el && el.closest ? el.closest("li") : null;
    const list = item ? item.closest("ul, ol") : null;
    adoptIdentity(source, item);
    adoptIdentity(source, list);
    if (item) emitBlockEdit(item, source.label);
  };

  /**
   * Every block a selection touches. Typing over a selection that runs from
   * one paragraph into the next changes both — the second may vanish
   * entirely — and each needs its own row.
   */
  const blocksInRange = (range) => {
    const found = [];
    const add = (node) => {
      const target = targetFor(node);
      if (target && !found.some((t) => t.el === target.el)) found.push(target);
    };
    add(range.startContainer);
    add(range.endContainer);
    if (range.collapsed) return found;
    const root = range.commonAncestorContainer;
    const scope = root.nodeType === 1 ? root : root.parentElement;
    if (!scope) return found;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (el) => (isOurs(el) || !range.intersectsNode(el) ? NodeFilter.FILTER_REJECT : isBlock(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    let el = walker.nextNode();
    let budget = 400;
    while (el && budget > 0) {
      add(el);
      el = walker.nextNode();
      budget -= 1;
    }
    return found;
  };
  let affected = null; // targets of a multi-block selection, until the input event reports them

  /** An edit row for a block changed outside the input-event flow (attribute
   * set, link removal, drag move) — the same shape the input listener emits. */
  const emitBlockEdit = (blockEl, fallbackLabel, extra = {}) => {
    const connected = blockEl.isConnected;
    const target = connected ? targetFor(blockEl) : null;
    queueEdit({
      label: (target && target.label) || fallbackLabel || "Document body",
      kind: "edited",
      before: originalText.get(blockEl),
      after: connected ? blockEl.textContent : "",
      before_html: originalHtml.get(blockEl),
      after_html: connected ? blockHtml(blockEl) : "",
      ...extra,
    });
  };

  let typingUntil = 0;
  let controlRestoreTimer = null;

  const selectionIsActive = () => {
    const sel = document.getSelection();
    return !!(sel && !sel.isCollapsed && sel.rangeCount && document.body.contains(sel.getRangeAt(0).commonAncestorContainer));
  };

  const controlsAreSuppressed = () => Date.now() < typingUntil || selectionIsActive();

  const hideActionControls = () => {
    showChip(null);
  };

  const restoreActionControls = () => {
    if (controlsAreSuppressed()) return;
    showChip(hoverTarget);
  };

  const suppressActionControlsWhileTyping = () => {
    typingUntil = Date.now() + 800;
    hideActionControls();
    cancelLater(controlRestoreTimer);
    controlRestoreTimer = later(restoreActionControls, 810);
  };
  listen(document,
    "beforeinput",
    (event) => {
      if (!editMode || isOurs(event.target)) return;
      suppressActionControlsWhileTyping();
      // From here on, DOM drift is the human typing, not the page rendering.
      userEdited = true;
      const sel = document.getSelection();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      const blocks = range ? blocksInRange(range) : [];
      const target = blocks[0] || targetFor(event.target);
      if (target) captureOriginal(target.el);
      for (const block of blocks) captureOriginal(block.el);
      affected = blocks.length > 1 ? blocks : null;
    },
    true
  );

  listen(document, "selectionchange", () => {
    const sel = document.getSelection();
    if (sel?.rangeCount && document.body.contains(sel.anchorNode) && !isOurs(sel.anchorNode)) {
      selectionRange = sel.getRangeAt(0).cloneRange();
    }
    if (selectionIsActive()) hideActionControls();
    else restoreActionControls();
  });

  const setEditMode = (mode) => {
    editMode = mode !== "read";
    editableObserver?.disconnect();
    editableObserver = editMode ? keepBodyEditable(document.body) : null;
    if (!editMode) document.body.setAttribute("contenteditable", "false");
    hideActionControls();
    showGrip(null);
    closeLinkbox(false);
  };

  const formatSelection = (command) => {
    if (!editMode || !["bold", "italic", "underline", "strikeThrough", "insertOrderedList", "insertUnorderedList", "undo", "redo"].includes(command)) return;
    const sel = document.getSelection();
    const range = selectionRange || (sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null);
    if (!range || !document.body.contains(range.commonAncestorContainer)) {
      post("eh:error", { error: "Place the cursor in the document or select text first." });
      return;
    }
    if (command === "undo") {
      const last = undoStack[undoStack.length - 1];
      if (last && last.at > lastInputAt) {
        restoreBlock(last.label, last.kind);
        return;
      }
    }
    document.body.focus();
    sel.removeAllRanges();
    sel.addRange(range);
    const targets = blocksInRange(range);
    const target = targetFor(range.startContainer);
    for (const block of targets) captureOriginal(block.el);
    if (target) captureOriginal(target.el);
    affected = targets.length > 1 ? targets : null;
    userEdited = true;
    document.execCommand(command);
    if (command === "insertOrderedList" || command === "insertUnorderedList") afterListCommand(target);
    else for (const block of targets.length ? targets : target ? [target] : []) emitBlockEdit(block.el, block.label);
    affected = null;
    scheduleSave();
    if (sel.rangeCount) selectionRange = sel.getRangeAt(0).cloneRange();
  };

  let findQuery = "";
  let findIndex = -1;
  const findText = (query, direction = 0) => {
    const value = String(query || "").slice(0, 500).toLowerCase();
    if (!value) {
      findQuery = "";
      findIndex = -1;
      post("eh:findResult", { count: 0, index: 0 });
      return;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const el = node.parentElement;
        if (!el || el.closest("script, style, noscript, textarea, [data-eh-ui]")) return NodeFilter.FILTER_REJECT;
        if (getComputedStyle(el).display === "none" || getComputedStyle(el).visibility === "hidden") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let text = "";
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({ node, start: text.length, end: text.length + node.length });
      text += node.textContent;
    }
    const lower = text.toLowerCase();
    const matches = [];
    let offset = 0;
    while (matches.length < 500 && (offset = lower.indexOf(value, offset)) !== -1) {
      matches.push(offset);
      offset += value.length;
    }
    if (findQuery !== value) findIndex = 0;
    else if (matches.length) findIndex = (Math.max(0, findIndex) + Number(direction || 0) + matches.length) % matches.length;
    findQuery = value;
    if (matches.length) {
      const start = matches[findIndex];
      const end = start + value.length;
      const a = nodes.find((entry) => entry.end > start);
      const b = nodes.find((entry) => entry.end >= end);
      if (a && b) {
        const range = document.createRange();
        range.setStart(a.node, start - a.start);
        range.setEnd(b.node, end - b.start);
        const sel = document.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        selectionRange = range.cloneRange();
        a.node.parentElement.scrollIntoView?.({ block: "center", behavior: "instant" });
      }
    } else findIndex = -1;
    post("eh:findResult", { count: matches.length, index: findIndex + 1, capped: matches.length === 500 });
  };

  // ------------------------------------------------------------------ links

  let linkState = null; // { range, anchor, blockEl, label } while the ⌘K popup is open

  function closeLinkbox(restoreSelection) {
    if (!linkState) return;
    const { range } = linkState;
    linkState = null;
    els.linkbox.style.display = "none";
    if (restoreSelection && range) {
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.body.focus({ preventScroll: true });
    }
  }

  function openLinkbox() {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return false;
    let range = sel.getRangeAt(0).cloneRange();
    const container = range.commonAncestorContainer;
    if (!document.body.contains(container) || isOurs(container)) return false;

    const caretEl = container.nodeType === 1 ? container : container.parentElement;
    const anchor = caretEl && caretEl.closest ? caretEl.closest("a") : null;
    if (sel.isCollapsed) {
      // A bare caret can only mean "edit the link I'm inside".
      if (!anchor) return false;
      range = document.createRange();
      range.selectNodeContents(anchor);
    }
    const target = targetFor(anchor || container);
    linkState = {
      range,
      anchor,
      blockEl: target ? target.el : null,
      label: target ? target.label : "Document body",
    };
    if (linkState.blockEl) captureOriginal(linkState.blockEl);

    // The compose card and the link popup fight over the same selection.
    clearPending();
    post("eh:dismiss", {});

    const r = range.getBoundingClientRect();
    const below = r.bottom + 44 < window.innerHeight;
    els.linkbox.style.display = "flex";
    els.linkbox.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 320))}px`;
    els.linkbox.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 44)}px`;
    els.linkRemove.style.display = anchor ? "" : "none";
    els.linkInput.value = anchor ? anchor.getAttribute("href") || "" : "";
    els.linkInput.focus();
    els.linkInput.select();
    return true;
  }

  function applyLink() {
    if (!linkState) return;
    const href = normalizeHref(els.linkInput.value);
    const { range, anchor, blockEl, label } = linkState;
    if (!href) {
      // Nothing typed → dismiss. Something unusable typed → stay open so the
      // input isn't silently thrown away.
      if (!els.linkInput.value.trim()) closeLinkbox(true);
      else els.linkInput.select();
      return;
    }
    userEdited = true;
    linkState = null;
    els.linkbox.style.display = "none";
    if (anchor && anchor.isConnected) {
      // Editing an existing link never rewraps — just retarget it.
      anchor.setAttribute("href", href);
      if (blockEl) emitBlockEdit(blockEl, label);
    } else {
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.body.focus({ preventScroll: true });
      document.execCommand("createLink", false, href);
      // On pages that reset anchor styling the new link looks like plain
      // prose — underline it so the user sees that it took.
      const node = sel.anchorNode;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      const created = el && el.closest ? el.closest("a") : null;
      if (created) {
        const patch = linkStyleFixup(
          getComputedStyle(created),
          created.parentElement ? getComputedStyle(created.parentElement) : null
        );
        if (patch.textDecoration) created.style.textDecoration = patch.textDecoration;
      }
    }
    scheduleSave();
  }

  function removeLink() {
    if (!linkState) return;
    const { anchor, blockEl, label } = linkState;
    linkState = null;
    els.linkbox.style.display = "none";
    if (!anchor || !anchor.isConnected) return;
    userEdited = true;
    const parent = anchor.parentNode;
    while (anchor.firstChild) parent.insertBefore(anchor.firstChild, anchor);
    parent.removeChild(anchor);
    parent.normalize();
    if (blockEl) emitBlockEdit(blockEl, label);
    scheduleSave();
  }

  listen(els.linkInput, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      if (isImeCommitEnter(event)) return;
      event.preventDefault();
      applyLink();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeLinkbox(true);
    }
  });
  listen(els.linkApply, "click", applyLink);
  listen(els.linkRemove, "click", removeLink);

  // A click anywhere in the page means the popup lost the argument.
  listen(document, "pointerdown", (event) => {
    if (linkState && !isOurs(event.target)) closeLinkbox(false);
  });

  // ------------------------------------------------------------------ lists

  // execCommand mutations fire `input` (so edit rows and saves flow as usual)
  // but not `beforeinput`, so originals are captured here by hand.
  listen(document,
    "keydown",
    (event) => {
      if (isOurs(event.target)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        post("eh:findRequest", {});
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        post("eh:captureRequest", {});
        return;
      }
      if (meta && event.key === "Enter" && !isImeCommitEnter(event)) {
        event.preventDefault();
        event.stopPropagation();
        post("eh:sendRequest", {});
        return;
      }
      // Focus usually sits in this frame while reading; Esc still has to
      // reach the chrome to dismiss a comment or leave focus mode.
      if (event.key === "Escape") {
        if (linkState) closeLinkbox(true);
        else {
          hideBubble();
          post("eh:escape", {});
        }
        return;
      }
      if (!editMode) return;
      const sel = document.getSelection();
      const anchor = sel ? sel.anchorNode : null;

      // ⌘Z right after a block delete or move undoes that, not the last
      // keystroke — unless typing came after it, which stays the browser's undo.
      if (meta && !event.shiftKey && !event.altKey && (event.key === "z" || event.key === "Z")) {
        const last = undoStack[undoStack.length - 1];
        if (last && last.at > lastInputAt) {
          event.preventDefault();
          event.stopPropagation();
          restoreBlock(last.label, last.kind);
        }
        return;
      }

      // ⌘K links the selection, like Docs, Word, and Notion.
      if (meta && !event.shiftKey && !event.altKey && (event.key === "k" || event.key === "K")) {
        if (openLinkbox()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      // ⌘⇧8 bulleted, ⌘⇧7 numbered — the shortcuts people know from Docs.
      if (meta && event.shiftKey && (event.code === "Digit7" || event.code === "Digit8")) {
        const target = targetFor(anchor || event.target);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        userEdited = true;
        captureOriginal(target.el);
        document.execCommand(event.code === "Digit7" ? "insertOrderedList" : "insertUnorderedList");
        afterListCommand(target);
        scheduleSave();
        return;
      }

      // Tab indents and Shift+Tab outdents inside a list, instead of leaving the page.
      if (event.key === "Tab" && anchor) {
        const el = anchor.nodeType === 1 ? anchor : anchor.parentElement;
        const item = el && el.closest ? el.closest("li") : null;
        if (!item || isOurs(item)) return;
        event.preventDefault();
        event.stopPropagation();
        userEdited = true;
        const target = targetFor(item);
        if (target) captureOriginal(target.el);
        document.execCommand(event.shiftKey ? "outdent" : "indent");
        polishNewList(document.getSelection());
        scheduleSave();
        return;
      }

      // "- ", "* ", "1. ", or "1) " at the start of a line becomes a list.
      // Only the text between the block's start and the caret matters, so this
      // works inside authored data-block containers and in front of existing
      // text — not just in blocks that hold nothing but the marker.
      if (event.key === " " && sel && sel.isCollapsed && anchor) {
        const host = anchor.nodeType === 1 ? anchor : anchor.parentElement;
        if (!host || host.closest("li, ul, ol")) return;
        const block = innermostBlock(anchor);
        // isBlock matches display:table but not table-cell, so a caret in a
        // table's first cell resolves the whole table — never convert that.
        if (block && /^(table|thead|tbody|tfoot|tr)$/i.test(block.tagName)) return;
        const lead = document.createRange();
        // Inline content directly under <body> (a bare text node beside an
        // image, say) has no block; the caret's own node is the line then.
        if (block) lead.selectNodeContents(block);
        else lead.setStart(anchor, 0);
        try {
          lead.setEnd(sel.anchorNode, sel.anchorOffset);
        } catch {
          return;
        }
        const command = listCommandFor(lead.toString());
        if (!command) return;
        const target = targetFor(anchor);
        event.preventDefault();
        event.stopPropagation();
        userEdited = true;
        if (target) captureOriginal(target.el);
        sel.removeAllRanges();
        sel.addRange(lead);
        document.execCommand("delete");
        document.execCommand(command);
        afterListCommand(target);
        scheduleSave();
      }
    },
    true
  );

  // ------------------------------------------------------------- image drag

  // Chromium moves an image dropped inside contenteditable on its own; this
  // code only aims the drop (indicator outline), blocks payloads that have
  // nowhere to go (files from the desktop), and writes the edit rows for the
  // block the image left and the block it landed in.
  let dragging = null; // { el, fromBlock, fromLabel, overBlock, dropped } during an image drag

  listen(document, "dragstart", (event) => {
    const img = event.target && event.target.nodeType === 1 && event.target.tagName === "IMG" ? event.target : null;
    if (!img || isOurs(img)) return;
    const target = targetFor(img);
    if (target) captureOriginal(target.el);
    dragging = {
      el: img,
      src: img.src,
      // The rendered size often comes from the container being left behind
      // (figure/card CSS); remember it so the move can't balloon the image.
      width: img.getBoundingClientRect().width,
      fromBlock: target ? target.el : null,
      fromLabel: target ? target.label : "Image",
      overBlock: null,
      dropped: false,
    };
  });

  listen(document, "dragover", (event) => {
    if (!dragging) {
      // External payloads would navigate the frame or paste file:// markup.
      if (event.dataTransfer && [...(event.dataTransfer.types || [])].includes("Files")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
      }
      return;
    }
    const range = caretRangeAt(event.clientX, event.clientY);
    const block = range ? innermostBlock(range.startContainer) : null;
    if (block && !isOurs(block)) {
      captureOriginal(block);
      dragging.overBlock = block;
    }
    place(els.outline, block && !isOurs(block) ? block : null);
  });

  const finalizeImageDrag = () => {
    const drag = dragging;
    if (!drag || !drag.dropped) return;
    dragging = null;
    place(els.outline, null);
    // Chrome re-inserts a copy on drop, so find the landed image by source,
    // then pin it to the size it had before the move — an image dragged out
    // of the container that was constraining it would otherwise render at
    // its natural size.
    let landed = drag.el.isConnected ? drag.el : null;
    if (!landed && drag.overBlock && drag.overBlock.isConnected) {
      landed = [...drag.overBlock.querySelectorAll("img")].find((i) => i.src === drag.src) || null;
    }
    if (landed && drag.width && Math.abs(landed.getBoundingClientRect().width - drag.width) > 1) {
      landed.style.width = `${Math.round(drag.width)}px`;
      landed.style.height = "auto";
      landed.style.maxWidth = "100%";
    }
    const rows = new Map();
    if (drag.fromBlock) rows.set(drag.fromBlock, drag.fromLabel);
    if (drag.overBlock && !rows.has(drag.overBlock)) rows.set(drag.overBlock, null);
    for (const [block, label] of rows) emitBlockEdit(block, label);
    scheduleSave();
  };

  listen(document, "drop", (event) => {
    if (dragging) {
      // The move itself is the drop's default action, so the edit rows can
      // only be read after it has run.
      userEdited = true;
      dragging.dropped = true;
      later(finalizeImageDrag, 0);
      return;
    }
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) event.preventDefault();
  });

  listen(document, "dragend", () => {
    // A cancelled drag (Esc, or dropped outside the page) still needs cleanup.
    if (dragging && !dragging.dropped) {
      dragging = null;
      place(els.outline, null);
    }
  });

  // ------------------------------------------------------------- image paste

  // Pasted images cross to the chrome page as bytes; the server writes them
  // into assets/ next to the reviewed file and the confirmed relative path
  // comes back to be inserted where the caret was.
  let pasteSeq = 0;
  const pendingPastes = new Map(); // id → collapsed caret range to insert at
  const pasteTimers = new Map();
  disposers.push(() => pendingPastes.clear());
  disposers.push(() => pasteTimers.clear());

  listen(document,
    "paste",
    (event) => {
      if (!editMode || isOurs(event.target)) return;
      const items = event.clipboardData ? [...event.clipboardData.items] : [];
      const images = items.filter((item) => item.kind === "file" && /^image\//.test(item.type));
      if (!images.length) return;
      event.preventDefault();
      event.stopPropagation();
      const sel = document.getSelection();
      const caret = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      for (const item of images) {
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > 8 * 1024 * 1024 || pendingPastes.size >= 20) {
          post("eh:error", { error: "Image paste exceeds the 8 MB or 20 pending images limit." });
          continue;
        }
        pasteSeq += 1;
        const id = `paste_${pasteSeq}`;
        pendingPastes.set(id, caret);
        const expiry = later(() => { pendingPastes.delete(id); pasteTimers.delete(id); }, 30000);
        pasteTimers.set(id, expiry);
        file.arrayBuffer().then((bytes) => post("eh:asset", { id, assetType: file.type, bytes })).catch(() => {
          pendingPastes.delete(id);
          cancelLater(expiry);
          pasteTimers.delete(id);
          post("eh:error", { error: "Could not read the pasted image." });
        });
      }
    },
    true
  );

  const insertPastedImage = (id, src, stagedId) => {
    if (!pendingPastes.has(id)) return;
    cancelLater(pasteTimers.get(id));
    pasteTimers.delete(id);
    const caret = pendingPastes.get(id);
    pendingPastes.delete(id);
    userEdited = true;
    const img = document.createElement("img");
    img.setAttribute("src", src);
    img.style.maxWidth = "100%";
    const anchored = caret && caret.startContainer && document.body.contains(caret.startContainer) && !isOurs(caret.startContainer);
    if (anchored) {
      const target = targetFor(caret.startContainer);
      if (target) captureOriginal(target.el);
      caret.collapse(false);
      caret.insertNode(img);
    } else {
      document.body.appendChild(img);
    }
    const landed = targetFor(img);
    emitBlockEdit(landed ? landed.el : img, landed ? landed.label : "Pasted image", {
      ...(stagedId ? { staged_assets: [{ id: stagedId, preview_src: src }] } : {}),
    });
    flushSave();
  };

  listen(document, "input", (event) => {
    if (!editMode || isOurs(event.target)) return;
    lastInputAt = Date.now();
    // A drop fires deleteByDrag/insertFromDrop input events whose selection
    // points anywhere; finalizeImageDrag writes the real rows instead.
    if (dragging) return;
    // Typing over a selection is an edit, not a comment: retire the card.
    if (pending) {
      clearPending();
      post("eh:dismiss", {});
    }
    if (affected) {
      // A selection spanning blocks: the first absorbed the rest, and any
      // block that is gone now is a deletion in its own right.
      const blocks = affected;
      affected = null;
      for (const block of blocks) {
        if (block.el.isConnected) emitBlockEdit(block.el, block.label);
        else queueEdit({ label: block.label, kind: "deleted", before: originalText.get(block.el), after: "", before_html: originalHtml.get(block.el), after_html: "" });
      }
      scheduleSave();
      return;
    }
    const sel = document.getSelection();
    const node = sel && sel.anchorNode ? sel.anchorNode : event.target;
    const target = targetFor(node);
    // Text alone loses formatting-only edits (bold, italic, underline change
    // markup, not textContent), so the block's cleaned HTML travels too.
    queueEdit({
      label: target ? target.label : "Document body",
      kind: "edited",
      before: target ? originalText.get(target.el) : undefined,
      after: target ? target.el.textContent : undefined,
      before_html: target ? originalHtml.get(target.el) : undefined,
      after_html: target ? blockHtml(target.el) : undefined,
    });
    scheduleSave();
  });

  const reposition = () => {
    place(els.outline, hoverTarget);
    place(els.activeBox, activeBoxEl);
    showBubble();
    showChip(hoverTarget);
    showGrip(resizing ? resizing.el : hoverMedia);
    // The popup is viewport-fixed; scrolled away from its text it just lies.
    if (linkState) closeLinkbox(false);
  };
  // getBoundingClientRect on every scroll event forces layout mid-scroll;
  // one reposition per frame is plenty.
  let repositionQueued = false;
  const scheduleReposition = () => {
    if (repositionQueued) return;
    repositionQueued = true;
    nextFrame(() => {
      repositionQueued = false;
      reposition();
    });
  };
  listen(window, "scroll", scheduleReposition, true);
  listen(window, "resize", scheduleReposition);

  let scrollQueued = false;
  listen(window,
    "scroll",
    () => {
      if (scrollQueued) return;
      scrollQueued = true;
      nextFrame(() => {
        scrollQueued = false;
        postScroll();
        updateOutlineActive();
      });
    },
    { passive: true }
  );
  listen(window, "scrollend", () => {
    spyLockUntil = 0;
    updateOutlineActive();
  });

  listen(window, "message", (event) => {
    // Only the chrome page may drive the SDK — not popups the artifact opened,
    // and not the artifact's own scripts.
    if (event.source !== window.parent || event.origin !== CHROME_ORIGIN) return;
    const msg = event.data || {};
    switch (msg.type) {
      case "eh:dispose":
        dispose();
        break;
      case "eh:mode":
        annotations?.setDrawing(false);
        setEditMode(msg.mode);
        break;
      case "eh:draw":
        if (msg.action === "toggle") {
          hideActionControls();
          showGrip(null);
          closeLinkbox(false);
          annotations?.setDrawing(!annotations.active);
        } else if (msg.action === "off") annotations?.setDrawing(false);
        else if (msg.action === "undo") annotations?.undo();
        else if (msg.action === "clear") annotations?.clear();
        break;
      case "eh:format":
        formatSelection(String(msg.command || ""));
        break;
      case "eh:find":
        findText(msg.query, msg.direction);
        break;
      case "eh:capture":
        if (capturing) {
          post("eh:captured", { id: msg.id, error: "A screenshot is already being captured." });
          break;
        }
        capturing = true;
        hideActionControls();
        showGrip(null);
        closeLinkbox(false);
        {
          const tool = annotations;
          const task = { id: msg.id, controller: new AbortController() };
          captureTask = task;
          tool.setBusy(true);
          (async () => {
            const region = msg.mode === "region" ? await tool.selectRegion(task.controller.signal) : undefined;
            if (msg.mode === "region" && !region) {
              post("eh:captured", { id: msg.id, cancelled: true });
              return;
            }
            const result = await capturePage(msg.mode, { region, strokes: tool.snapshot(), signal: task.controller.signal });
            post("eh:captured", { id: msg.id, ...result });
          })().catch((error) => {
            post("eh:captured", { id: msg.id, ...(task.controller.signal.aborted ? { cancelled: true } : { error: error.message || "Could not capture the screenshot. Try attaching an image instead." }) });
          }).finally(() => {
            if (captureTask === task) {
              captureTask = null;
              capturing = false;
              tool.setBusy(false);
            }
          });
        }
        break;
      case "eh:captureCancel":
        if (!msg.id || captureTask?.id === msg.id) captureTask?.controller.abort();
        break;
      case "eh:anchors":
        reanchor(msg.comments || []);
        break;
      case "eh:commit":
        commitPending(msg.id);
        composeOpen = false;
        break;
      case "eh:cancel":
        clearPending();
        composeOpen = false;
        break;
      case "eh:composeOpen":
        composeOpen = true;
        break;
      case "eh:remove":
        if (sectionHeadings.delete(msg.id)) clearHighlight(SECTION_HIGHLIGHT);
        unwrap(msg.id);
        document.querySelectorAll(`[data-eh-el="${CSS.escape(msg.id)}"]`).forEach((el) => el.removeAttribute("data-eh-el"));
        markActive(null);
        break;
      case "eh:activate":
        activate(msg.id, !!msg.scroll);
        break;
      case "eh:flush":
        flushSave();
        // Posted after the flushed eh:edit/eh:html messages, so when the
        // chrome sees it, everything pending has already been handed over.
        post("eh:flushed", {});
        break;
      case "eh:abortSave":
        // A revert is in flight: anything queued would re-write the edits.
        cancelLater(saveTimer);
        cancelLater(editTimer);
        editQueue.clear();
        break;
      case "eh:raw":
        checkDynamic(String(msg.html || ""));
        break;
      case "eh:feedbackOnly":
        // The chrome already knows saves must not happen (e.g. a Markdown
        // source rendered for review); no comparison needed.
        dynamic = true;
        break;
      case "eh:restoreScroll":
        window.scrollTo(msg.x || 0, msg.y || 0);
        break;
      case "eh:assetSaved":
        insertPastedImage(msg.id, String(msg.src || ""), String(msg.stagedId || ""));
        break;
      case "eh:assetFailed":
        pendingPastes.delete(msg.id);
        cancelLater(pasteTimers.get(msg.id));
        pasteTimers.delete(msg.id);
        break;
      case "eh:undo":
        restoreBlock(String(msg.label || ""), String(msg.kind || ""));
        break;
      case "eh:presets":
        presets = (Array.isArray(msg.presets) ? msg.presets : []).slice(0, 12).map((preset) => ({
          id: String(preset.id || ""),
          label: clip(preset.label, 32),
          text: String(preset.text || ""),
          bubble: !!preset.bubble,
        })).filter((preset) => preset.id && preset.label);
        renderPresets();
        showBubble();
        break;
      case "eh:outlineGo":
        goToHeading(Number(msg.index));
        break;
      case "eh:sectionComment": {
        const heading = outline[Number(msg.index)];
        if (!heading || !heading.isConnected) break;
        goToHeading(Number(msg.index));
        openSectionCompose(heading, { focus: true });
        break;
      }
      case "eh:reader":
        applyReader(msg.settings);
        // The layout just moved under every overlay and heading.
        scheduleReposition();
        postScroll();
        updateOutlineActive();
        break;
      default:
        break;
    }
  });

  // The server may already have rendered the page dark.
  applyReader({});
  post("eh:ready", { scrollHeight: document.body.scrollHeight, reader: readerPage() });

  // Headings change as the user types and as the agent's rewrite lands.
  outlineObserver = new MutationObserver(scheduleOutline);
  outlineObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  collectOutline();
  postScroll();
}

if (document.readyState === "loading") listen(document, "DOMContentLoaded", boot);
else boot();
