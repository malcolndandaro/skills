# Auditing a site's animation ("make something like X")

When the user points at a live site ("I want a hero like openai.com/...", "how does this page do it?"),
do not guess from a screenshot. Five console questions reveal the whole architecture in minutes.
Run them in the browser devtools console (or via the Browser pane's JavaScript tool).

Ethics: reading structure — uniform names, pass order, blend state, which library — is learning.
Copying their shader or assets is not. Everything you build from what you learn is written from scratch.

## 1. Which libraries are in the bundle?

Download the script chunks and test for *precise* signatures. Beware naive substrings:
`"ogl"` matches "G**oogl**e", `"three"` matches the English word.

```js
const srcs = [...document.querySelectorAll('script[src]')].map(s => s.src);
const chunks = Object.fromEntries(await Promise.all(
  srcs.map(async s => [s.split('/').pop(), await (await fetch(s)).text()])));
const tests = {
  three:   /WebGLRenderer|ShaderMaterial|BufferGeometry/,
  r3f:     /@react-three\/fiber|__r3f/,
  motion:  /AnimatePresence|useMotionValue/,
  gsap:    /gsap\.registerPlugin/,
  rive:    /@rive-app/,
  lottie:  /lottie-web|bodymovin/,
  pixi:    /PIXI\.|pixi\.js/,
  glsl:    /precision (?:highp|mediump) float/,
  reduced: /prefers-reduced-motion/,
};
for (const [k, re] of Object.entries(tests))
  console.log(k, Object.keys(chunks).filter(n => re.test(chunks[n])).length, 'chunks');
```

## 2. Is it a canvas, a video, or DOM?

```js
document.querySelectorAll('canvas, video, svg');
const c = document.querySelector('canvas');
c && (c.getContext('webgl2') ? 'webgl2' : c.getContext('webgl') ? 'webgl' : c.getContext('2d') ? '2d' : 'unknown');
```
`getContext` returns the *existing* context, so this does not disturb the page. Also read the canvas's
computed style: `position:fixed; inset:0; pointer-events:none; z-index:0` is the standard "decorative hero" setup.

## 3. Is it really animating, and how much?

Count draw calls for one second:

```js
const P = WebGL2RenderingContext.prototype, orig = P.drawArrays, origE = P.drawElements;
let n = 0, points = 0;
P.drawArrays = function (mode, first, count) { n++; if (mode === this.POINTS) points += count; return orig.apply(this, arguments); };
P.drawElements = function () { n++; return origE.apply(this, arguments); };
setTimeout(() => { P.drawArrays = orig; P.drawElements = origE; console.log(n, 'draw calls/s,', points, 'points/s'); }, 1000);
```
Divide by the refresh rate for per-frame numbers. ~6 point draws + ~13 fullscreen triangles per frame
is the fingerprint of "particles + a bloom pyramid".

## 4. What technique? Read the shader interfaces

Minifiers never rename GLSL strings. Attribute and uniform names are the blueprint of the animation:

```js
const gl = document.querySelector('canvas').getContext('webgl2');
const P = WebGL2RenderingContext.prototype, orig = P.useProgram, progs = new Set();
P.useProgram = function (p) { p && progs.add(p); return orig.apply(this, arguments); };
setTimeout(() => {
  P.useProgram = orig;
  for (const p of progs) {
    const A = [], U = [];
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i++) A.push(gl.getActiveAttrib(p, i).name);
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);   i++) U.push(gl.getActiveUniform(p, i).name);
    console.log({ attributes: A, uniforms: U });
  }
}, 400);
```

How to read what comes back:
- `modelViewMatrix, projectionMatrix` + `THREE.WebGLRenderer` strings in a chunk → classic three.js `ShaderMaterial`.
- Uniforms prefixed `e0…`, `e1…`, `e2…` plus `toneMapping…` → pmndrs `postprocessing` with merged effects
  (`e1UGhosts, e1UHalo, e1UStreaks` = lens flare; `e0Intensity` = bloom).
- Attributes that are all *static parameters* (`orbitProgress`, `twinklePhase`, `starScale`) and no velocity/position
  → motion is a pure function of `uTime` in the vertex shader. That is the pattern this skill uses.
- `uPathTexture`, `uParticleMotionTexture` + a `…Uv` attribute → targets/trajectories baked into textures (shape morphs).
- `uReducedMotion` as a uniform → the reduced-motion state is drawn by the shader, not just paused.
- Blend state: `gl.getParameter(gl.BLEND_SRC_RGB)` = `ONE`/`ONE` → additive light.

## 5. What is CSS?

```js
document.getAnimations().map(a => ({
  name: a.animationName || a.effect?.target?.className, timeline: a.timeline?.constructor.name,
  target: a.effect?.target?.tagName }));
```
`DocumentTimeline` = time-based keyframes; `ScrollTimeline`/`ViewTimeline` = scroll-driven. CSS Modules
prefix keyframe names with the component (`AstraHero_rise__x1`), which tells you the component tree for free.

## Reporting the audit

Summarise as a layer table (what runs where) and a per-frame budget (draw calls, point counts, passes), then map each
layer to the cheapest equivalent for the user's stack. Mention the trade-off the original accepted
(for example ~150–200 KB gzip of three.js + postprocessing vs ~10 KB of hand-written WebGL2).
