import path from "node:path";
import { marked, Renderer } from "marked";
import { readerSettings } from "./reader.js";

export const isMarkdown = (file) => /\.(md|markdown)$/i.test(file);

/**
 * Readable defaults for rendered Markdown. This HTML is a viewing surface
 * only — it is never written back to disk, so the styling can be opinionated.
 *
 * The review's reading settings flip data-eh-* attributes on <html>; every
 * variant lives here, so the SDK never writes CSS of its own into the page.
 * The default measure is wide: a review page shares the window with the
 * contents and comments panels, and a 72ch column left most of it empty.
 */
const STYLE = `
  * { box-sizing: border-box; }
  :root {
    --hr-measure: 68rem; --hr-size: 16px; --hr-leading: 1.65;
    --hr-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    --hr-bg: #fdfcfa; --hr-fg: #1b1a16; --hr-muted: #6b6862; --hr-rule: #eceae3;
    --hr-border: #e4e2db; --hr-code: #f2f0ea; --hr-head: #f7f5f0; --hr-link: #295fcc;
    --hr-quote: #d8d5cb;
  }
  html[data-eh-width="narrow"] { --hr-measure: 42rem; }
  html[data-eh-width="medium"] { --hr-measure: 54rem; }
  html[data-eh-width="full"] { --hr-measure: none; }
  html[data-eh-size="s"] { --hr-size: 14.5px; }
  html[data-eh-size="l"] { --hr-size: 18px; }
  html[data-eh-size="xl"] { --hr-size: 20px; }
  html[data-eh-font="serif"] {
    --hr-font: "Iowan Old Style", Charter, "Palatino Linotype", Palatino, Georgia, serif; --hr-leading: 1.7;
  }
  html[data-eh-theme="sepia"] {
    --hr-bg: #f7f0e1; --hr-fg: #3a3024; --hr-muted: #75684f; --hr-rule: #e6dcc5;
    --hr-border: #e0d4ba; --hr-code: #efe5cf; --hr-head: #f1e8d4; --hr-link: #8a4b14; --hr-quote: #d9caa8;
  }
  html[data-eh-theme="dark"] {
    color-scheme: dark;
    --hr-bg: #1c1b18; --hr-fg: #e8e4da; --hr-muted: #a8a294; --hr-rule: #34322c;
    --hr-border: #3b3832; --hr-code: #2a2824; --hr-head: #26241f; --hr-link: #8fb4ff; --hr-quote: #4a463e;
  }
  body {
    margin: 0; background: var(--hr-bg); color: var(--hr-fg);
    font: var(--hr-size)/var(--hr-leading) var(--hr-font);
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: var(--hr-measure); margin: 0 auto; padding: 64px clamp(24px, 5vw, 72px) 120px; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 .5em; scroll-margin-top: 64px; }
  h1 { font-size: 2em; margin-top: .4em; }
  h2 { font-size: 1.45em; border-bottom: 1px solid var(--hr-rule); padding-bottom: .25em; }
  h3 { font-size: 1.15em; }
  h4, h5, h6 { font-size: 1em; }
  p, ul, ol { margin: .75em 0; }
  li { margin: .3em 0; }
  a { color: var(--hr-link); }
  code {
    background: var(--hr-code); border-radius: 4px; padding: .12em .35em;
    font: .88em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  pre { background: var(--hr-code); border-radius: 8px; padding: 14px 16px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding: .1em 1em; border-left: 3px solid var(--hr-quote); color: var(--hr-muted); }
  table { display: block; width: max-content; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid var(--hr-border); padding: 7px 11px; text-align: left; vertical-align: top; }
  th { background: var(--hr-head); }
  img { max-width: 100%; height: auto; }
  hr { border: none; border-top: 1px solid var(--hr-rule); margin: 2.2em 0; }
  .diagram { margin: 1em 0; }
  .diagram pre.mermaid { background: none; padding: 0; text-align: center; }
  .diagram pre.mermaid svg { max-width: 100%; height: auto; }
  html[data-eh-theme="dark"] .diagram pre.mermaid:has(svg) { background: #fdfcfa; padding: 14px; }
`;

/**
 * Mermaid renders in the browser from a pinned CDN build, loaded only when a
 * page has a diagram. It is not bundled: the library and its dependencies
 * are 80 MB installed, which every `npx` user would pay for on first run.
 * Offline, or if the load fails, the fence stays a readable code block.
 */
export const MERMAID_VERSION = "11.17.2";
const MERMAID_SRC = `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.esm.min.mjs`;
const MERMAID_LOADER = `<script type="module" data-eh-diagram>
import(${JSON.stringify(MERMAID_SRC)}).then(({ default: mermaid }) => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
  return mermaid.run({ nodes: document.querySelectorAll("pre.mermaid") });
}).catch(() => {});
</script>`;

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function safeUrl(value, { image = false } = {}) {
  const url = String(value || "").trim();
  const probe = url.replace(/[\u0000-\u0020\u007f]+/g, "");
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(probe);
  if (!match) return url;
  const scheme = match[1].toLowerCase();
  if (scheme === "http" || scheme === "https") return url;
  if (!image && scheme === "mailto") return url;
  if (image && /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,/i.test(probe)) return url;
  return null;
}

// Markdown can contain arbitrary HTML. Show that source as text so event
// handlers, embeds, SVG, and future browser features can never become active.
const INERT_RENDERER = new Renderer();
INERT_RENDERER.html = ({ text }) => escapeHtml(text);
INERT_RENDERER.link = function (token) {
  const href = safeUrl(token.href);
  if (!href) return this.parser.parseInline(token.tokens);
  return Renderer.prototype.link.call(this, { ...token, href });
};
INERT_RENDERER.image = function (token) {
  const href = safeUrl(token.href, { image: true });
  if (!href) return escapeHtml(token.text || "");
  return Renderer.prototype.image.call(this, { ...token, href });
};
// A ```mermaid fence becomes a diagram. The source stays in the element as
// text, which is what Mermaid reads and what the review falls back to.
INERT_RENDERER.code = function (token) {
  if (String(token.lang || "").trim().toLowerCase() !== "mermaid") return Renderer.prototype.code.call(this, token);
  return `<div class="diagram" data-block="Diagram"><pre class="mermaid">${escapeHtml(token.text)}</pre></div>\n`;
};

/**
 * Render a Markdown file into a standalone review page, with the reader's
 * settings already on <html> so the page never paints the defaults first.
 */
export function renderMarkdownPage(mdText, file, reader = {}) {
  const body = marked.parse(mdText, { gfm: true, async: false, renderer: INERT_RENDERER });
  const loader = body.includes('<pre class="mermaid">') ? MERMAID_LOADER : "";
  const title = path.basename(file);
  const attributes = Object.entries(readerSettings(reader))
    .map(([name, value]) => ` data-eh-${name}="${value}"`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en"${attributes}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="human-review-reader" content="markdown">
<title>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main>${loader}</body>
</html>
`;
}
