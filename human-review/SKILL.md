---
name: human-review
description: Open an HTML file, Markdown file, or localhost page in the browser so the user can edit text directly and leave comments on specific parts, then send all edits and comments back to you. Use after writing or updating something the user will read — specs, plans, reports, newsletter drafts, landing pages, slide decks, and locally running web pages.
---

# human-review

Originally created by **Peter Yang**: [petergyang/human-review](https://github.com/petergyang/human-review).
This maintained copy adds review tools and resource fixes; the original MIT
license and copyright are preserved in [LICENSE](LICENSE).

The user reviews your HTML, Markdown, or localhost page in a real browser: they fix small things
by typing, select anything to comment on it, and send you the whole batch at once.

Markdown files open rendered. Their quotes and edits reference the rendered text,
and the file itself is never touched — apply every change to the Markdown source,
keeping its formatting syntax.

## Installation and command

This folder includes the maintained Node runtime. On a new machine, install it
from this skill directory with `npm ci` followed by `node scripts/install-local.mjs`
(Node.js 20 or newer). The installer creates `~/.local/bin/human-review` and links
this folder into Claude Code, Codex and shared agent skills. Use that local
command for every review so this version's improvements remain available.
If it is missing, install from this folder before opening a review. See
[README.md](README.md) for installation details.

## The loop

1. Write or update the HTML or Markdown file, or start the local page being reviewed.
2. Open it for the user:

   ```sh
   ~/.local/bin/human-review path/to/file.html
   ```

   For a page served by a local development server, open the real route instead
   of recreating it as a separate HTML file:

   ```sh
   ~/.local/bin/human-review http://localhost:3000/wiki
   ```

3. Wait for feedback. This command blocks until the user hits Send in the
   browser, then prints their batch and exits:

   ```sh
   ~/.local/bin/human-review poll path/to/file.html
   ```

   The command exits only when the user clicks Send or closes the review.
   There is no interval to poll on. Use `--timeout <seconds>` only when the
   harness needs a bounded wait, and continue polling while the turn is active. It survives the local server restarting, and feedback is saved even
   if the poll dies, so nothing is ever lost. How you wait depends on your
   harness:

   - **Claude Code:** run it with `run_in_background: true` and end your turn.
     Claude Code wakes you with the output the moment the command exits.
   - **Codex, Cursor, and everything else:** run it in the **foreground**,
     inside your active turn, and stay on it until it prints `feedback` or
     `closed`. Do not detach it or start it as a background session: nothing
     wakes you when a detached command finishes. While the review is active:
     - If the user sends a message, answer it as commentary and immediately
       resume the foreground poll in the same turn. Do not send a final
       response until the poll returns `feedback` or `closed` — a final
       response ends the turn and kills the wait.
     - If your shell tool caps command duration, pass `--timeout` a little
       under the cap and run bounded polls back to back in the same active
       turn until one returns `feedback` or `closed`.

     Know the limit: this is reliable only while your turn stays active. A
     turn that has already ended is not woken when the user hits Send; the
     user has to message you, and you then run `status` and `poll` to pick
     the batch up. There is no integration that resumes an ended task when
     the poll exits.

   If it prints `{"status":"closed"}`, the review is over: the user ended it,
   closed the tab, or never had one open (`reason` says which). Stop and do
   not start another poll. `unsent` counts feedback they left behind; if it is
   not zero, tell the user in one line that it is kept and they can restore or
   discard it next time. `{"status":"superseded"}` means a newer poll of
   yours owns the wait — stop this one silently. `{"status":"timeout"}` only
   appears after 12 hours; run `status` and start the wait again if the
   review is still open.

4. Apply every item in the received batch, then confirm completion **before
   ending your turn**, even if the user needs no further review:

   ```sh
   ~/.local/bin/human-review ack path/to/file.html
   ```

   This command returns immediately and moves the applied comments into the
   browser's Completed history. Use the batch's exact `ack_command` when present;
   it names the entry target even if the user navigated to another page. Do not
   acknowledge until every item is applied and temporary attachments are copied
   where needed. Changing the HTML alone does not confirm completion.

5. Start the next poll using the wait mode above. You can combine confirmation
   and waiting using `--ack`:

   ```sh
   ~/.local/bin/human-review poll path/to/file.html --ack
   ```

Repeat 3–5 until the user says they are done.

Not sure whether feedback is already waiting — say, at the start of a new turn
with no poll running? This answers instantly without blocking:

```sh
~/.local/bin/human-review status path/to/file.html
```

It prints `{"status": "feedback-waiting"}` when a batch is ready for a poll,
plus counts of unsent comments and edits still in the browser.

## What you get

One batch covers every page the user visited, grouped by file or localhost URL.

```json
{
  "status": "feedback",
  "pages": [
    {
      "file": "/abs/path/to/page.html",
      "edits_saved": true,
      "comments": [
        { "id": "c_1", "kind": "selection", "quote": "the exact text they selected",
          "anchor": { "prefix": "...", "quote": "...", "suffix": "..." },
          "feedback": "what they want changed" }
      ],
      "edits": [
        { "label": "Problem body", "kind": "edited",
          "before": "the original wording",
          "after": "their exact new wording",
          "after_html": "their exact new wording with <strong>formatting</strong>" }
      ]
    }
  ],
  "overall_note": "feedback not tied to any one page"
}
```

## Rules

- **`edits` are changes the user already made.** `after` is their exact wording —
  carry it across verbatim and never revert it. If the HTML was generated from
  something else (MDX, Markdown, a template), apply `after` to the **source** too,
  or their fix disappears on the next build.
- **`edits_saved: true` means those edits are already in the file on disk.**
  Plain HTML files autosave as the user types, so your copy of the file is
  stale. Re-read the file before touching it and make targeted changes only;
  never regenerate it from what you wrote earlier, or their work disappears.
  `edits_saved: false` (Markdown, localhost pages, self-rendering HTML) means the
  edits exist only in this batch — apply them to the source yourself.
- An edit with `kind: "deleted"` means the user removed that whole block:
  delete it from the source too, without asking why.
- An edit marked `truncated: true` had its text cut at 200k characters; read
  the block from the page itself rather than from `after_html`.
- When `before_html`/`after_html` are present, the user changed formatting, not
  just words — bold, italic, underline, links. Use the HTML version to carry the
  formatting into the source, translated to its syntax (e.g. `<strong>` → `**`
  in Markdown/MDX).
- A page with `kind: "url"` was edited directly in the review UI. Its `file`
  and `url` fields name the localhost route, not a writable file. Find the
  matching project source (such as MDX, TSX, or a template), apply every edit
  and deletion there, then acknowledge so the route reloads. Never write the
  rendered HTTP response back into the app.
- When an edit's `after_html` contains `<img src="assets/...">`, the user pasted
  an image: the file already exists in an `assets/` folder next to the reviewed
  file. Keep that relative path — in Markdown, reference it as
  `![](assets/...)`. Never regenerate or inline the image.
- On a localhost page, a pasted image arrives under `staged_assets`. Copy its
  local `path` into the app's appropriate asset folder, replace the temporary
  preview URL in `after_html`, and preserve the image at the user's insertion
  point. Never leave the temporary preview URL in source.
- An edit with `kind: "moved"` means the user relocated that whole block.
  Reposition it in the source without rewriting its content: it now sits right
  after the block whose text starts with `moved_after`, and right before the
  block whose text starts with `moved_before` (both are clipped to 90
  characters and may end in `…`). An empty `moved_after` means it is now the
  first block in its container.
- Find each comment by its `quote`. It is the **rendered** text the user
  selected, so in Markdown or templated HTML it may span formatting syntax or
  tags; `anchor.prefix` and `anchor.suffix` give the surrounding text to
  disambiguate.
- `kind: "element"` points at a whole block, so `quote` is its label, not body text.
- Copy any `staged_assets` files before you ack: `--ack` deletes them.
- A batch with only an `overall_note` has an empty `pages` array.
- Fix every page in `pages`, not just the first.
- **Do not write a reply.** There is no chat. The user sees your work when the page
  reloads, which happens on its own the moment you save the file.

## Better edit labels (optional)

Name the sections you author and the user's edit list uses your names instead of
guessing from the DOM:

```html
<p data-block="Problem body">…</p>
<div data-container="Metrics callout">…</div>
```

`data-block` names a region for the edit list. `data-container` also makes the block
clickable as a comment target.

## Review tools

Sent means feedback has been submitted, and Text changed means the original
selection is no longer found. Neither confirms that the requested change is
finished. After the agent acknowledges the applied batch, comments move into
the collapsed Completed history. It retains the latest 50 comments, never sends
them again, and does not keep temporary screenshot files.

The toolbar provides Edit and Read modes, bold, italic, underline, strikeout,
lists, undo and redo. Select text or place the cursor before using formatting.
Find searches the rendered document; Enter and Shift+Enter cycle matches.
When the user releases a text or element selection, the comment field receives
focus so they can type immediately. Toolbar formatting restores the document
selection when used.
Cmd/Ctrl+Enter sends feedback; Cmd/Ctrl+Shift+S starts an area capture.

Click Pencil to draw red strokes on the page, or click once to leave a red dot.
Undo drawing removes the last stroke; Clear drawing removes all marks.
Esc finishes drawing. Marks follow document scrolling and are temporary review
feedback: they are never written into the HTML or Markdown source and disappear
when the document reloads. Capture them before reloading or navigating away.

Capture lets the user drag a rectangle over the visible page. Releasing the
mouse attaches just that area as a PNG, including red drawings, and focuses the
comment field. Esc cancels selection. Viewport and Full page capture their
respective areas, also with drawings. Write feedback, click Add comment, then
Send. Upload attaches an existing PNG or JPEG when a complex page cannot be
captured. Capture excludes review controls. Very large pages are downsampled
to 12 megapixels; image files are limited to 8 MB. External assets may be omitted
if their server refuses CORS.

A screenshot comment includes `screenshot.path`, an absolute local image path.
Open that image with the harness image viewer and use it together with the
comment text. Copy it to the project only if the user wants it retained;
acknowledgement deletes the temporary file. Never inline the image as base64.

## Runtime health

Run `~/.local/bin/human-review doctor` to inspect server RSS, JS heap, sessions,
connections, polls, and file watchers. It never starts a server.
Run `~/.local/bin/human-review stop` to close reviews and stop the server while
keeping pending and unsent feedback. End review unloads the document frame,
and a server without clients or polls exits after five minutes.

This installation uses the local maintained version. Use the command shown
in this skill so package-cache updates do not replace the improvements.
