# Local Human Review improvements

This skill extends [Peter Yang's Human Review](https://github.com/petergyang/human-review)
v0.8.2 from the original `malcoln/review-improvements` branch. Peter Yang's original
MIT license and copyright are preserved in `LICENSE`.
The canonical source is now the `human-review/` folder in the personal skills repo.
The local package version is `0.8.2-malcoln.3`.

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
