# AI Tells — full catalogue

The patterns that make prose read as machine-generated, with fixes and examples. Grouped
by family. The strongest family (Staging) earns a fix on a single sighting; the rest follow
the **density rule** — act when tells cluster in the same passage, not on isolated instances.
Synthesised from the Wikipedia *Signs of AI writing* guideline and the community anti-slop
skills (humanizer, stop-slop).

## Contents

- [How to apply this catalogue](#how-to-apply-this-catalogue)
- [A. Staging instead of stating (fix on sight)](#a-staging-instead-of-stating-fix-on-sight)
- [B. Rhythm by rule](#b-rhythm-by-rule)
- [C. Inflation and borrowed authority](#c-inflation-and-borrowed-authority)
- [D. Formatting by rule](#d-formatting-by-rule)
- [E. Leftovers and residue](#e-leftovers-and-residue)
- [Vocabulary watchlists](#vocabulary-watchlists)
- [When NOT to act](#when-not-to-act)

## How to apply this catalogue

1. **Read the whole passage first.** Mark every tell; fix nothing yet.
2. **Fix family A on sight.** These inflate a claim without adding anything, so a single
   instance is enough.
3. **For B–E, act on clusters.** A lone triad, one passive sentence, one curly quote is not
   slop. Three tells in one paragraph is.
4. **Preserve every supported claim.** Rewriting removes the tell, not the information.
5. **Where a fix needs a fact you do not have, write `[MISSING: …]`.** Never invent one.

---

## A. Staging instead of stating (fix on sight)

The single most reliable tell. The text builds a little stage before saying anything — and
often the thing it finally says is ordinary.

**A1 — "Not X, but Y" / "Not just X, it's Y"**
Negative setup that inflates the positive without substance.
- ✗ "It's not just a database; it's a foundation for everything you build."
- ✓ "The database stores the app's state and serves every read."

**A2 — One-line closers and dramatic fragments**
Restating or pausing for effect instead of advancing.
- ✗ "No fluff. No filler. Just results."
- ✓ Merge into a substantive sentence, or cut.

**A3 — Pseudo-profound framing**
Ordinary claims dressed as hidden truths.
- ✗ "The real question isn't how fast it runs — it's whether it runs at all."
- ✓ "It has to run reliably before speed matters."

**A4 — Staged run-ups**
Announcing a point rather than making it.
- ✗ "Let's dive in." "Here's what you need to know." "Here's the thing." "Buckle up."
- ✓ Delete the run-up; open with the point.

**A5 — Arguing with no one**
Defending against objections nobody raised.
- ✗ "This isn't about chasing trends. I'm not saying you should rewrite everything."
- ✓ State what it *is* about. Cut the strawman.

---

## B. Rhythm by rule

Structure imposed regardless of meaning. Individually weak — apply the density rule.

**B1 — Forced triads (rule of three)**
Ideas grouped in threes because three sounds complete, not because there are three.
- ✗ "It's fast, reliable, and scalable."
- ✓ Develop the one that matters, or list the real number of items (two, or five).

**B2 — Repeated sentence openings**
Several sentences in a row starting the same way ("This means…", "This is…", "You can…").
- Fix: merge or reorder. Do not ban the word — vary the entry point.

**B3 — Em/en dashes as a universal connector**
The dash standing in for every comma, colon, and parenthesis.
- Rule: match the rate of the writer's sample or the surrounding document. If there is no
  sample, use dashes sparingly and reach for a period, comma, colon, or parentheses first.
- This is a *rate* problem, not a ban. One dash is fine; a dash in every other sentence is a tell.

**B4 — Stacked qualifiers**
"could potentially possibly help" / "might arguably be somewhat".
- Fix: keep at most one hedge, and only when the uncertainty is real.

**B5 — Hyphenated pairs everywhere**
Compound modifiers applied in all positions ("a well-designed, high-performing, easy-to-use…").
- Fix: hyphenate before a noun only; drop after.

**B6 — Passive voice hiding the actor**
- ✗ "Mistakes were made and the deploy was rolled back."
- ✓ "We shipped a bad config and rolled the deploy back." Name who acts.

---

## C. Inflation and borrowed authority

Making ordinary content sound momentous or better-sourced than it is.

**C1 — Inflated significance / empty closers**
Ordinary details framed as legacy or destiny; stock closing sections.
- ✗ "stands as a testament to", "marks a pivotal moment", "plays a crucial role in shaping",
  "Despite its challenges, X continues to thrive." Stock headings: "Challenges and Legacy",
  "Future Outlook".
- ✓ State the fact and stop. End on the last concrete detail, not a verdict on its importance.

**C2 — Borrowed authority / vague attribution**
Unnamed experts and prestige-outlet lists propping up a claim.
- ✗ "Experts agree…", "studies show…", "widely regarded as…", "featured in leading
  publications."
- ✓ Name the source and quote it, or cut the claim. If the source is unknown, `[MISSING: source]`.

**C3 — Vague connection language**
Hiding the real relationship between things.
- ✗ "associated with", "linked to", "in connection with", "tied to".
- ✓ Name the actual relationship ("was CEO of", "funded", "reports to") or admit it is unclear.

**C4 — Shallow "-ing" riders**
Present-participle clauses bolted to a fact to sound deeper.
- ✗ "The team shipped the feature, further enhancing the platform's overall value."
- ✓ "The team shipped the feature." Keep a rider only when it carries real information.

**C5 — Sales / brochure language**
Advertisement tone in place of fact.
- ✗ "nestled in the heart of", "breathtaking", "vibrant", "rich", "groundbreaking",
  "a diverse array of", "seamless", "cutting-edge", "robust", "world-class".
- ✓ Say plainly what the thing is and what it does.

**C6 — is/are/has avoidance**
Simple verbs swapped for grander ones.
- ✗ "serves as", "boasts", "features", "functions as", "operates as", "represents".
- ✓ Restore: is, are, has, runs.

---

## D. Formatting by rule

Decoration standing in for structure.

**D1 — Bold as decoration**
Bold on every labelled item whether or not it needs emphasis.
- Fix: remove it. If a labelled list adds no information beyond the prose, turn it into prose.

**D2 — Decorative headings**
Title Case On Every Word, emoji, arrows, and horizontal rules between sections.
- Fix: sentence case, no emoji, no rule lines. One heading style, used consistently.

**D3 — Emphasis overload**
Bold + italic + underline + colour stacked on the same text.
- Fix: one emphasis type, used rarely. Underlines only on actual links.

**D4 — Curly vs straight quotes (weak alone)**
Curved quotes where the target format uses straight, or a mix.
- Fix: match the target format consistently. Only worth acting on alongside other tells.

---

## E. Leftovers and residue

**E1 — Chatbot residue**
Chat wrappers left in standalone text.
- ✗ "I hope this helps!", "Great question!", "Certainly!", "Let me know if you'd like…",
  "As an AI language model…".
- ✓ Delete the wrapper; keep the content.

**E2 — Knowledge-limit disclaimers and guesses**
- ✗ "As of my last training update…", or filling a gap with a plausible-sounding "likely".
- ✓ State what the source does not show. Never present a guess as a fact — use `[MISSING: …]`.

**E3 — Heading echoed in the first sentence**
A heading followed by a sentence that just restates it.
- ✗ "## Performance / Performance is an important consideration for this system."
- ✓ Cut the echo; open with substance.

**E4 — Describing the previous version**
Explaining the approach you replaced instead of the current behaviour.
- Fix: describe what it does now. Prior versions belong only in changelogs or migration notes.

---

## Vocabulary watchlists

High-frequency AI words. Their presence is not automatically wrong — **flag on density**,
then replace with the plain word or cut. If several appear in one paragraph, that paragraph
needs a rewrite.

**Verbs / connectors:** delve, leverage, utilize, underscore, highlight, showcase, foster,
garner, bolster, enhance, align with, unlock, empower, streamline, spearhead, harness.

**Adjectives:** vibrant, robust, seamless, meticulous, intricate, crucial, pivotal, vital,
enduring, groundbreaking, cutting-edge, comprehensive, holistic, nuanced, rich, profound.

**Nouns / framing:** landscape, tapestry, testament, realm, journey, ecosystem, interplay,
synergy, game-changer, deep dive, treasure trove.

**Transition crutches:** Moreover, Furthermore, Additionally, In today's world, In the realm
of, It's worth noting that, It's important to note, When it comes to, Needless to say.

---

## When NOT to act

- Leave weak-alone patterns (D4, a lone triad, a single passive) untouched unless they
  cluster with other tells in the same passage.
- Never edit inside quotations, titles, proper names, or a passage that is *discussing* the
  phrase itself.
- Preserve specific detail, real numbers, dates, era-bound references, mixed feelings, and
  genuine asides — these are what make writing human, and stripping them creates slop.
- Do not chase an absolute zero of any device. Zero em-dashes, zero triads, zero bold across
  a whole document is itself a machine fingerprint. Aim for a human *rate*, not a purge.
