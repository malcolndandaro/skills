# Local Human Review improvements

This skill extends [Peter Yang's Human Review](https://github.com/petergyang/human-review)
v0.8.2 from the original `malcoln/review-improvements` branch. Peter Yang's original
MIT license and copyright are preserved in `LICENSE`.
The canonical source is now the `human-review/` folder in the personal skills repo.
The local package version is `0.8.2-malcoln.5`.

Install dependencies with `npm ci`, then run `node scripts/install-local.mjs`.
The installer writes `~/.local/bin/human-review` pointing to this folder and links
the Claude Code, Codex and shared agent skill directories here. Previous skill
directories and the managed command are backed up under
`~/.local/state/human-review/skill-backups/`, outside agent skill discovery.
Reinstalling or running setup preserves the canonical `SKILL.md`.

## Review tools

- Visible formatting controls, lists, undo/redo, and Edit/Read modes.
- Find across inline formatting, with next/previous matches.
- Drag to capture a selected area, plus viewport and full page screenshots.
- Red pencil strokes and dots, with undo/clear, included in every capture mode.
- Comment field focuses as soon as a text/element selection is released.
- PNG/JPEG upload when browser capture cannot render a complex page.
- Screenshot comments delivered as local image paths to the waiting agent.
- Safer Send: pending edits are flushed and persisted before sending.
- Comment drafts survive sidebar refreshes; shortcut help is available.

Screenshots use a locally bundled renderer loaded on demand. They exclude
review controls, cap each bitmap at 12 megapixels and each file at 8 MB,
and keep at most 20 temporary images per page. Very long pages are downsampled;
documents with more than 30,000 elements require Upload. External images/fonts
can be omitted if their server refuses cross-origin access. Copy an attachment
before acknowledging feedback if you need a permanent project artifact.

Drawings live only in the review overlay and are never saved into source files.
They follow document scrolling; capture them before reloading or changing pages.
Esc cancels region selection or finishes drawing. History is bounded to 200
strokes, 20,000 points total and 4,000 per stroke. Undo stores vectors rather than
canvas snapshots; the viewport overlay is capped at four megapixels. Selection,
pointer capture, listeners, animation frames and bitmaps are released on disposal.

The server protocol changed to 11. An older running server must be stopped with
`human-review stop` before reopening reviews. This keeps stored feedback.

## Resource fixes

- Idle poll targets are removed; unused visited pages release their watchers.
- Historical navigation reopens pruned pages without retaining their snapshots.
- Original document snapshots remain on disk until a revert actually reads them.
- Hover controls no longer clone/serialize the whole document for every UI change.
- SDK listeners, timers, observers and undo references are explicitly disposed.
- Ending a review unloads its iframe, closes its event stream and revokes previews.
- Capture canvases are released; cancelled and acknowledged image files are removed.
- Shutdown closes live SSE/long-poll responses and their timers before stopping.
- Image uploads finishing after navigation or review end discard orphaned files.
- Each screenshot releases the renderer's image/font cache and restores any
  original page library, so dynamic asset URLs cannot accumulate across captures.
- Local files over 24 MB fail early, with a clear message.
- Feedback size/count limits prevent oversized comments accumulating in memory.
- Idle servers exit after five minutes. Stale server records are removed safely.

`human-review doctor` reports RSS, JS heap, sessions, connections, polls and
watchers without starting a server. `human-review stop` ends current reviews
and stops the server while preserving pending and unsent feedback.

## Evidence

The measurements below were taken in the original development checkout. Its
ignored `output/` artifacts are retained there and are not bundled in this skill.

The original reported multi-GB process was already gone, so it could not be
identified or reproduced directly. A controlled Node/jsdom comparison with
2,000 paragraphs and 100 UI mutations measured 100 document clones in upstream
and zero in this version. After forced garbage collection, both heaps returned
near baseline: this identifies allocation churn, without proving a persistent
heap leak. Exact results are in `output/memory-regression.json`.

The lifecycle test navigates 14 documents of 512 KiB, restores a pruned page,
and creates 12 distinct poll targets. Watchers remain at most two while active;
sessions, pollers, poll targets and watchers return to zero after review ends.
An 8 MiB snapshot test verifies that startup and comment saves read zero
snapshot files; the first explicit revert read loads exactly one.

Real Chromium checks cover screenshot capture/cancellation, search, formatting,
and feedback delivery. Six capture/cancel cycles measured the reviewed frame's
post-GC JS heap at 1.03 MiB before and 1.23 MiB after, and the active local
server at 62.7 MiB RSS. These are bounded smoke checks, not a long-duration
guarantee. Screenshot artifacts and test fixtures live in ignored `output/`.

The region/drawing update passes all 151 tests. Real Chromium verification at
DPR 2 captured a reverse drag of 341 × 197 CSS pixels as a 682 × 394 PNG,
including the red outline and dot. The feedback batch retained `mode: region`,
contained zero source edits, and the original file was byte-for-byte unchanged.
After scrolling 600 CSS pixels, a region capture placed both the red dot and
underline at their expected bitmap pixels (RGBA 226,61,55,255). Mouse selection
and element clicks focused the comment field; immediate typing changed only
the comment. Artifacts: `output/region-capture.png`, `output/annotation-ui.png`.

Six consecutive viewport captures in the installed server each reloaded the
renderer, left zero vendor script nodes and restored the page's original library.
The live server was upgraded to protocol 11, and both previously open reviews
were reopened with matching source hashes and preserved stored feedback.

The original development checkout and npm-installed upstream package remain
available. Installer backups contain the previous skill folders and managed
command; unlink the installed skill links before restoring those folders.

## Personal repository migration

The complete runtime, tests, lockfile, skill and original license now live in
`human-review/` within the personal skills repository. The local launcher points
here, and the Claude Code, Codex and shared agent skill directories are symlinks
to this folder. Existing installations were backed up before replacement.
An already running review continues on its loaded server until shutdown; the
next server launch uses this folder.

Relocation verification passed all 155 tests, including canonical link protection,
installer backups/idempotence and cached command resolution. Chromium opened
a fixture using the new launcher in an isolated state directory, drew a red
underline, and captured a 690 × 100 CSS pixel area as a 1380 × 200 PNG at DPR 2.
The preview included the drawing and the comment field received focus. The
isolated test server was stopped afterward. Local verification artifacts:
`output/migration-tests.log` and `output/migration-smoke/region-preview.png`.

## Confirming completed comments

Version `0.8.2-malcoln.3` uses protocol 12. Sent comments now move to a collapsed
Completed history only after the agent acknowledges that it applied the batch.
The new `human-review ack <target>` confirms immediately; `poll --ack` remains
available to confirm and wait together. Both preserve new feedback and queued
batches. History is capped at 50 text-only items per page; temporary attachments
are still released. The batch includes an exact `ack_command`, and the skill
requires confirmation before the agent ends its turn.

The reported Claude session applied the requested changes but never ran `--ack`.
Its two actual comments were confirmed after checking the transcript and pending
batch, preserving the changed HTML and omitting the superseded removal request.
Regression coverage passes 161 tests. Chromium verified two active, changed-text
comments becoming zero active comments and two Completed cards after confirmation.
Artifacts: `output/completion-tests.log`, `output/completion-smoke/completed-history.png`.

## Stuck screenshot captures

Version `0.8.2-malcoln.4` keeps the protocol at 12. A region capture could hold
Send on "Capturing screenshot…" for good. Clicking Add comment before the drag
finished saved the comment but left its capture running, with nowhere to land;
and a capture that ended by cancel or error refreshed only the toolbar, so Send
kept the stale label and stayed disabled. Add comment now cancels the comment's
pending capture and says the screenshot was left out, and every capture start or
end redraws Send. The renderer also gives up after 20 seconds or on cancel,
since html-to-image never settles when an image decode rejects; a canvas that
arrives late is released.

Regression coverage passes 163 tests, including a renderer that never settles.
Chromium verified Add comment during a pending selection (Send freed, toast
shown), a normal region capture still attaching, and Esc with a typed draft.
A review tab stuck on the old client recovers with a reload; its comments stay.

## Reading, contents and selection

Version `0.8.2-malcoln.5` uses protocol 14, so an older server is replaced on
the next open: the Markdown renderer runs inside the server process.

Selecting text sometimes produced a comment on the whole block. The SDK only
accepted ranges whose ends were inside text nodes; a triple-click (which ends
at the start of the next paragraph) or a drag past the line end ends on an
element, so the selection was dropped and the click fell through to a block
comment. Range ends now map to text offsets wherever they fall, and the span
is trimmed to its words. Plain clicks no longer open block comments or move
focus into the comment field, which had sent typing into the comment instead
of the document. Block comments take Alt-click or the block's comment chip;
images, diagrams and authored `data-container` blocks still open on click.
The pending selection is painted with the CSS Highlight API, so it stays
visible once focus moves to the rail, and is never written into the DOM.

A bar beside a selection offers Comment plus five quick comments; the compose
card lists eight. Their text is a fixed instruction for the agent, followed by
anything typed. A Contents panel lists the page's headings, highlights the one
being read and scrolls to a heading on click. A thin bar shows reading progress.

Rendered Markdown dropped its 72ch column for a 68rem default and declares
narrow, medium, wide and full widths, four text sizes, sans or serif, and
light, sepia or dark themes as `data-eh-*` attributes on `<html>`. The SDK
flips them only on pages carrying `<meta name="human-review-reader">`, so
HTML artifacts keep their own styling. Tables scroll instead of squeezing.
Focus mode hides both panels; Esc from the page now reaches the chrome.
Read mode hides the formatting tools, the toolbar adapts to the stage width
with container queries, and the mode, contents and reading settings persist.

Regression coverage passes 174 tests. Chromium verified on a 33-heading
Markdown fixture: a triple-click and a drag into the right margin each opened
a Selection with the exact sentence; Be clearer from the bar filed its comment
and marked that sentence; a plain click left focus in the page and typed text
became a document edit; Alt-click opened a focused Element comment; a Contents
click put its heading at 64 px below the frame top with the item active;
sepia/serif/medium and dark rendered and persisted across reload; Esc inside
the page left Focus mode. An HTML fixture listed its headings, hid Aa, gained
no attributes and stayed byte-identical after a quick comment. Screenshots:
`output/reading-smoke/`.

### Section comments and long selections

There was no way to comment on a heading and everything under it. Alt-click
covered one paragraph, and dragging across a section usually passed the 4,000
character quote limit, so Add comment failed. A new `section` comment covers a
heading through the next heading of the same or a higher level. It opens from
the comment chip on a heading, Alt-click on a heading, or the comment button on
each Contents entry. It stores only the heading text, level and path, so its
size does not depend on the section's. The heading's words carry the mark, and
activating the comment paints the whole section with the Highlight API.
After a reload it finds the heading again by path, or by text and level.

Selections longer than 3,600 characters now keep their first and last 1,600
characters (`anchor.quote`, `anchor.end`, `anchor.long`) and quote both joined
by `[…]`. They are found again from both ends. The server bounds the new
anchor fields with the existing limit and accepts `kind: "section"`.

Regression coverage passes 178 tests. Chromium verified that the chip on
"Plano de execução" (H2) took the H3s and H4 below it and stopped before the
next H2. The Contents button on the H1 took the whole document, and Human
writing filed against it. A click plus Shift+click across 3,976 characters
was stored as a 3,205-character long anchor. After a reload all three comments
re-anchored with no Text changed badge, and Jump to on the section card painted
the section. Screenshots: `output/reading-smoke/07-*` to `10-*`.

### Block mover removed, one theme, more quick comments

The drag handle on each block's left edge is gone, with its drop line and
auto-scroll. It sat over the first letters of list items and competed with
selection. The server still accepts `moved` edits, so feedback stored by an
earlier review still delivers; new reviews no longer produce them. Image drag
and resize are unchanged.

The shell's light/dark switch and the page theme were separate, so a dark rail
sat beside a white page. The switch now carries the page with it, and picking
Dark or Light in Aa carries the shell. Sepia stays with the light shell and
comes back after dark. Reading settings travel in the artifact URL, and the
server renders Markdown with them (`src/reader.js`, shared with the SDK), so a
reload in dark mode never paints white first. On a dark page the selection bar
inverts to stay visible.

Quick comments gain Fix grammar and Ask Genie One. The latter asks the agent to
check the passage against Genie One on logfood, correct it where the data
differs, and report what Genie One could not confirm outside the page.

Regression coverage passes 179 tests. Chromium verified no move handle on
hover; sepia, then the moon switch, gave a dark page (rgb 28, 27, 24) and the
sun switch restored sepia; the served HTML after a dark reload already carried
`data-eh-theme="dark"`; the bar showed all eight buttons on one line, inverted
on dark; Ask Genie One filed its instruction. Screenshots: `11-*`, `12-*`.
