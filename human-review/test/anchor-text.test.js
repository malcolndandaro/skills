import test from "node:test";
import assert from "node:assert/strict";
import { buildContext, findQuote, tidy } from "../src/anchor-text.js";

test("buildContext captures the quote with surrounding context", () => {
  const text = "The quick brown fox jumps over the lazy dog";
  const ctx = buildContext(text, 4, 9, 4);
  assert.equal(ctx.quote, "quick");
  assert.equal(ctx.prefix, "The ");
  assert.equal(ctx.suffix, " bro");
});

test("buildContext clamps at both ends of the text", () => {
  const text = "abc";
  const ctx = buildContext(text, 0, 3, 10);
  assert.deepEqual(ctx, { prefix: "", quote: "abc", suffix: "" });
});

test("findQuote locates a unique quote", () => {
  const text = "human-review turns an HTML file into a reviewable page";
  const start = text.indexOf("turns");
  const hit = findQuote(text, buildContext(text, start, start + 5));
  assert.deepEqual([hit.start, hit.end], [start, start + 5]);
  assert.equal(text.slice(hit.start, hit.end), "turns");
});

test("findQuote survives edits elsewhere in the document", () => {
  const before = "Alpha section. The pricing table is wrong. Omega section.";
  const ctx = buildContext(before, before.indexOf("pricing table"), before.indexOf("pricing table") + 13);
  const after = "Completely rewritten intro. The pricing table is wrong. And a new tail.";
  const hit = findQuote(after, ctx);
  assert.equal(after.slice(hit.start, hit.end), "pricing table");
});

test("findQuote disambiguates repeats using prefix and suffix", () => {
  const text = "one target here and two target there and three target everywhere";
  const second = text.indexOf("target", text.indexOf("target") + 1);
  const ctx = buildContext(text, second, second + 6);

  const hit = findQuote(text, ctx);
  assert.equal(hit.start, second, "should pick the occurrence whose context matches");
});

test("findQuote returns null when the quote is gone", () => {
  assert.equal(findQuote("nothing to see", { quote: "missing", prefix: "", suffix: "" }), null);
});

test("findQuote ignores empty anchors", () => {
  assert.equal(findQuote("text", { quote: "" }), null);
  assert.equal(findQuote("text", null), null);
});

test("tidy collapses whitespace and truncates", () => {
  assert.equal(tidy("  a\n\n  b  "), "a b");
  assert.equal(tidy("abcdefghij", 5), "abcd…");
  assert.equal(tidy(null), "");
});

test("findQuote survives whitespace reflow inside the quote", () => {
  const before = "Intro text. The quick brown fox jumps over things. Outro text.";
  const at = before.indexOf("quick brown fox");
  const ctx = buildContext(before, at, at + "quick brown fox".length);

  // What a prettier run does: same words, reflowed whitespace.
  const after = "Intro text. The quick\n    brown  fox jumps over things. Outro text.";
  const hit = findQuote(after, ctx);
  assert.ok(hit, "a reflowed quote still anchors");
  assert.equal(hit.exact, false);
  assert.equal(tidy(after.slice(hit.start, hit.end)), "quick brown fox");
});

test("whitespace-tolerant matching still disambiguates repeats", () => {
  const before = "alpha shared words beta. gamma shared words delta.";
  const second = before.indexOf("shared words", before.indexOf("shared words") + 1);
  const ctx = buildContext(before, second, second + "shared words".length);

  const after = "alpha shared\n words beta. gamma shared\n words delta.";
  const hit = findQuote(after, ctx);
  assert.ok(hit);
  assert.ok(after.slice(0, hit.start).includes("gamma"), "context picks the second occurrence");
});
