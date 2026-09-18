# Document structure — templates and review passes

How to order a document so the reader can act, and how to review structure once it is
drafted. Structure is the first job; the prose cleanup in `ai-tells.md` is the second.
Get this right first — clean prose that buries the ask still fails the reader.

## Contents

- [The through-line: BLUF](#the-through-line-bluf)
- [Templates by document type](#templates-by-document-type)
  - [Executive summary / decision memo](#executive-summary--decision-memo)
  - [Status update](#status-update)
  - [Proposal](#proposal)
  - [Technical design doc](#technical-design-doc)
  - [Short internal memo](#short-internal-memo)
- [The five review passes](#the-five-review-passes)
- [Naming the document](#naming-the-document)

## The through-line: BLUF

**Bottom Line Up Front.** The reader should get the conclusion, the recommendation, or the
ask in the first few lines — before the reasoning, the background, or the evidence. This is
the opposite of how the document was written (findings first, conclusion last) and the
opposite of a narrative (build-up, then reveal). Optimise for a reader who stops after the
first paragraph.

Before writing, answer three questions and put the answers up top:

1. **Who reads this?** What do they already know, and what do they not?
2. **What is the one takeaway?** If they remember one sentence, which one?
3. **What do I need from them?** A decision, a review, an approval, an action, or nothing —
   and by when.

If there is no ask, say so ("For your awareness — no action needed"). Silence about the ask
is the most common structural failure.

## Templates by document type

Pick the closest fit and adapt. Every template is Markdown.

### Executive summary / decision memo

```markdown
# [Decision or topic] — [date]

**Bottom line:** [The recommendation or conclusion, one or two sentences.]
**Decision needed:** [What you need, from whom, by when.] Or: "For awareness — no action needed."

## Context
[Two to four sentences. Only what this reader needs to follow the recommendation.]

## Options considered
[Brief. For each: what it is, the main trade-off. A table works well.]

## Recommendation
[The one you back, and the single strongest reason. Name the risk you are accepting.]

## Next steps
[Concrete actions, each with an owner and a date.]
```

### Status update

```markdown
# [Project] status — [date]

**Overall:** 🟢 on track / 🟡 at risk / 🔴 blocked — [one sentence why]

## Since last update
[What actually changed. Shipped things, decisions made, numbers moved.]

## Blockers / decisions needed
[What you need from the reader, with owner and date. If none, say "none".]

## Next
[What happens before the next update.]
```

Lead with the health line. Do not make the reader assemble status from a wall of activity.

### Proposal

```markdown
# Proposal: [what you want to do] — [date]

**The ask:** [What you want approved — scope, cost, timeline — in two sentences.]

## Problem
[The problem in the reader's terms. Why it matters now. The cost of doing nothing.]

## Proposed approach
[What you would do. Enough detail to judge feasibility, not the full design.]

## Cost, timeline, and risk
[What it takes. What could go wrong and how you would handle it. Be honest about the risk.]

## Alternatives
[What else you considered and why this wins. Shows you did the work.]
```

### Technical design doc

```markdown
# [System / change] design — [date]

**Summary:** [What is being built or changed, and why, in a short paragraph.]
**Status:** draft / in review / approved

## Goals and non-goals
[What this must do. Just as important: what it explicitly will not do.]

## Design
[The approach. Diagrams where they carry the idea better than prose. Name the trade-offs.]

## Alternatives considered
[Options rejected, with the reason. This is where reviewers spend their attention.]

## Risks, rollout, and open questions
[Failure modes, migration/rollout plan, and what is still undecided — as questions.]
```

### Short internal memo

```markdown
# [Subject] — [date]

[One paragraph: what happened or what you are proposing, and what you want the reader to do.]

[One or two paragraphs of the detail that matters. Bullets only if they genuinely scan
better than sentences.]

[The ask, restated, with a date.]
```

## The five review passes

Once drafted, review structure in these passes (from the *better-documents* framework).
Each names failures to catch.

**Pass 1 — Audience and purpose.** Does it serve the reader, not the writer?
- Missing context — unexplained jargon, acronyms, or backstory the reader lacks.
- Buried ask — the request or decision is hidden instead of stated early.
- Author-centred opening — credentials or throat-clearing before the shared point.
- Missing deadline or stakes — the timeline and why-now are absent.

**Pass 2 — Structure and sequencing.** Is it ordered by importance to the reader?
- Creation-order sequencing — follows how you wrote it, not what the reader needs first.
- Murder-mystery structure — the conclusion sits in the second half.
- Unannounced ordering — a non-obvious order (chronological, by category) with no signpost.
- Wrong channel — a critical point relegated to a footnote, appendix, or aside.

**Pass 3 — Formatting restraint.** Does the formatting clarify or just decorate?
- Emphasis overload — bold + italic + underline + colour on the same text.
- Underlines on non-links — false signals of clickability.
- Colour proliferation — more than two distinct colours.
- Border clutter — heavy rules where white space would separate more cleanly.
- Filler visuals — images or icons unrelated to the message.
- Inconsistency — headings, sizes, or weights that vary by accident.

**Pass 4 — Wayfinding and density.** Can the reader tell where they are?
- No orientation — no outline, headers, or signposts in a long document.
- Unsummarised data — a chart or table with no title or caption that says what it means.
- Unanswerable prompts — open questions that invite discussion where a decision is needed.
- Dense prose — paragraphs past ~6 lines where bullets would scan better. (Do not over-correct
  into all-bullets, either — prose carries reasoning that fragments lose.)

**Pass 5 — Naming and versioning.** See below.

## Naming the document

The title and filename should carry information on their own — in a file list, a search
result, or an inbox.

- **No generic titles.** Not "Untitled", "Draft", "Notes", "Document".
- **Not named after the recipient.** "Memo for Priya" tells a future reader nothing. Name it
  for the topic.
- **Include the topic and a date.** `q3-warehouse-migration-plan-2026-02.md` beats
  `plan_final_v2.md`.
- **Version with dates, not `_final_final`.** If you must version, use an ISO date or a clear
  scheme, not ambiguous suffixes.
- **Meeting notes:** name them for the subject and date, not the attendees.
