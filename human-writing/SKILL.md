---
name: human-writing
description: >-
  Write and revise documents, reports, memos, proposals, and prose so they read as
  written by a person, not generated — stripping the tells of AI slop while keeping every
  supported fact. It covers two jobs. First, structuring a document so the reader can act,
  with the bottom line up front, the audience and the decision being asked for, the
  evidence, and the next steps. Second, removing AI writing patterns such as inflated
  vocabulary, "not just X but Y" staging, empty closers like "stands as a testament",
  is/are avoidance such as "serves as", borrowed authority, forced rule-of-three, and
  em-dash or bold overuse. Use whenever drafting or editing any human-facing document,
  when asked to make writing sound human, less robotic, warmer, or less like AI, when
  cleaning up an AI-generated draft, or when a report needs a clear structure. Acts on
  pattern density rather than blind find-and-replace, and never invents facts to smooth
  prose. Delivers Markdown by default.
---

# Human Writing

Write documents that read as if a competent person wrote them for a specific reader — not
text a model produced to sound finished. Two jobs, always in this order:

1. **Get the structure right** so the reader can act (audience, the ask, evidence, next steps).
2. **Strip the AI tells** so the prose reads human.

This applies both to writing something new and to revising a draft — yours or one a model
generated. Skip neither job. A well-structured document full of "pivotal moments" still
reads as slop; clean prose that buries the ask still wastes the reader's time.

## The one rule that beats every checklist

**Act on density, not on single instances. Every uniform fix becomes its own fingerprint.**

The failure mode is find-and-replace: ban every em-dash, delete every "moreover", forbid
groups of three everywhere. That does not produce human writing — it produces a *different*
detectable pattern, and it flattens real voice along the way. Humans use em-dashes. Humans
sometimes list three things. The tell is not the device; it is the device used *mechanically
and everywhere*.

So:

- **The strong tells earn a fix on sight** (staging instead of stating, inflated
  significance, borrowed authority, is/are avoidance). See the list below.
- **The weak tells need company.** One curly quote, one triad, one passive sentence is
  not a problem. Fix them only when they cluster with other tells in the same passage.
- **Match the target's own rate.** If a person's writing sample or the surrounding
  document already uses em-dashes or bold, match that rate rather than an absolute zero.
- **Never invent a fact to make a sentence flow.** Where a concrete detail is missing,
  write `[MISSING: what is needed]` and keep going. An honest gap beats an empty adjective
  or a fabricated source, every time.

## Workflow

### Writing a new document

1. **Structure before prose.** Decide the reader, the one thing they must take away, and
   what you need from them. Put that first. See `references/document-structure.md` for the
   template that fits (executive summary, status update, proposal, memo, technical doc).
2. **Draft in plain, direct sentences.** State things. Vary sentence length naturally.
3. **Run the revision pass** below before you deliver. Always — new prose from a model is
   exactly where the tells live.

### Revising a draft

1. **Read once and mark clusters.** Do not fix yet. Note where tells pile up.
2. **Rewrite the strong tells first**, then clusters of weak ones. Preserve every claim the
   source supports; cut claims it does not.
3. **Read it aloud** (or simulate it). Metronomic rhythm and staged run-ups surface here.
4. **Score against the rubric** below. Below 35/50, revise again.

The full pattern catalogue with fixes and before/after examples is in
`references/ai-tells.md`. Read it when doing a thorough pass or when unsure whether
something is a real tell.

## The strong tells — fix on sight

| Tell | What it looks like | Fix |
|------|--------------------|-----|
| **Staging instead of stating** | "It's not just X, it's Y." "The real question is…" "Let's dive in." "Here's the thing." | Delete the run-up. State the claim directly. |
| **Inflated significance / empty closer** | "stands as a testament to", "plays a pivotal role", "in the ever-evolving landscape", "Despite its challenges, X continues to thrive." | State the fact. End on the last concrete detail, not a summary of significance. |
| **Borrowed authority / vague attribution** | "Experts say", "studies show", "featured in leading outlets", "widely regarded as". | Name the source and quote it, or cut the claim. |
| **is/are avoidance** | "serves as", "boasts", "functions as", "stands as", "features". | Use the plain verb: is, has, runs. |
| **Vague connective tissue** | "-ing" riders bolted to facts ("…, further enhancing its significance"), "in connection with", "when it comes to". | Cut the rider or name the real relationship. |
| **Chatbot residue** | "I hope this helps!", "Great question!", "Let me know if…", "As an AI…". | Delete entirely. |

Beyond these, watch rhythm-by-rule (forced triads, identical sentence openings), formatting
noise (bold on every label, title-case headings, emoji, horizontal rules), and the inflated
vocabulary watchlist (delve, robust, leverage, tapestry, seamless, crucial, underscore,
vibrant, meticulous…). Those belong to the density rule — act when they cluster. Full lists
in `references/ai-tells.md`.

## Revision rubric

Score the draft 1–10 on each. Below **35/50**, keep revising.

| Dimension | Ask |
|-----------|-----|
| **Directness** | Does it state things, or announce and stage them? |
| **Rhythm** | Sentence length varied, or metronomic? |
| **Trust** | Does it respect the reader's intelligence, or over-explain and hedge? |
| **Authenticity** | Does it sound like a person, or like generated text? |
| **Density** | Is anything cuttable without losing meaning? |

## Structure the reader can act on

Full templates per document type live in `references/document-structure.md`. The through-line:

- **Bottom line up front.** The conclusion or ask goes in the first lines, not the second
  half. No murder-mystery structure.
- **Name the audience and the decision.** Who reads this, and what do you need them to
  decide or do? If there is a deadline or a stake, say it early.
- **Order by importance to the reader**, not by the order you thought of things. Announce a
  non-obvious ordering.
- **Restraint in formatting.** White space over borders, two colours at most, bold only
  where it carries meaning, captions that interpret every chart or table.
- **Name the file and the title so they carry information** — topic and date, not "Draft",
  "final_v2", or the recipient's name.

## Deliverable

- **Markdown by default.** It is the portable form and reviews cleanly in a diff.
- **Google Docs:** the skill produces Markdown; it does not format natively inside Docs.
  Either paste the Markdown in, or, if a Google Docs connector is available in the session,
  convert the Markdown to a Doc through it. Say which path you took.

## Guardrails — what not to strip

Removing tells must not sand off what makes writing human or true:

- **Keep genuine voice**: real asides, dry humour, a strong opinion the author owns.
- **Keep honest uncertainty.** Hedging that reflects a real unknown stays; hedging used as
  filler goes. Do not manufacture confidence the source does not support.
- **Keep specific detail, dates, and era-bound references.** Concreteness is the opposite
  of slop — never trade a specific number for a smooth adjective.
- **Do not touch** quotations, titles, proper names, or a passage that is *discussing* one
  of these phrases.
- **Do not fabricate.** Placeholders (`[MISSING: …]`) over invented facts, sources, or
  quotes — no exceptions.
- **Do not over-correct** into a new uniform style. That is just a fresh fingerprint.
