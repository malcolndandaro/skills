# Integration: standalone, React/Next, Vue, artifacts, three.js, Canvas 2D

## Standalone HTML (default deliverable)

Copy `assets/template-full.html` (or compose one: `python scripts/compose.py <subject> out.html --title … --heading …`),
edit sections 1–2, ship the single file. It works from `file://`, from any static host, in CodePen, in an `<iframe>`.
Delete the debug HUD and the hint line before shipping. Put real content in `.content`.

To embed in an existing page rather than full-screen: give the canvas's container `position: relative` and make the
canvas `position: absolute; inset: 0`. The engine sizes from `canvas.clientWidth/Height` and uses a `ResizeObserver`,
so it follows the container.

## React / Next.js

Move section 3 (the `createScene` function) into `particle-scene.js` and export it. Sections 1–2 become a
`subjects/galaxy.js` module exporting `{ config, generateSubject, subjectGlsl, fieldGlsl }`. Then:

```jsx
'use client';                                   // Next.js App Router: WebGL is client-only
import { useEffect, useRef } from 'react';
import { createScene } from './particle-scene';
import * as galaxy from './subjects/galaxy';

export function Hero({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    const scene = createScene(ref.current, {
      config: structuredClone(galaxy.config),   // a fresh config per mount: the engine mutates it live
      generateSubject: galaxy.generateSubject, subjectGlsl: galaxy.subjectGlsl, fieldGlsl: galaxy.fieldGlsl,
    });
    if (!scene) ref.current.parentElement.classList.add('no-webgl');
    return () => scene?.destroy();              // route change / StrictMode double-mount: free the context
  }, []);
  return (
    <section className="hero">
      <canvas ref={ref} aria-hidden="true" />
      <div className="hero-content">{children}</div>
    </section>
  );
}
```

Notes that save an afternoon:
- **StrictMode mounts twice in dev.** `destroy()` must be complete (cancel rAF, remove listeners, lose the context) or
  you get two scenes fighting over one canvas. The template's `destroy()` does all of it.
- **Do not put `config` in React state.** Mutate `scene.config.post.bloom = x` from a slider's `onChange`; the engine reads
  it every frame. Re-rendering the component must not recreate the scene (empty dependency array).
- **SSR:** the component must not touch `window` at import time. Everything happens inside the effect.
- **Changing the subject at runtime** (tabs, sections): call `scene.destroy()` and create a new one, or keep one scene and
  drive a `uMorph`-style uniform through `config.subject`.
- Expose `replayIntro()` to re-run the intro when the hero scrolls back into view, if that is the desired feel.

## Vue

Same pattern in `onMounted` / `onBeforeUnmount` with a template ref. Nuxt: wrap in `<ClientOnly>`.

## Svelte / plain SPA routers

`onMount` returns the cleanup. The only rule that matters everywhere: **one `destroy()` per `createScene()`.**

## Claude.ai artifacts

The templates are already artifact-friendly: a single file, no external scripts, inline CSS. Two adjustments:
- The artifact wrapper adds its own `<head>`, so keep `<style>` and `<title>` at the top of the body content and drop
  the `<!doctype>`/`<html>`/`<head>` shell when the host asks for body-only HTML.
- Theme: the canvas is dark by design; paint the page `background` explicitly so a light host theme does not leak
  around it.
- Artifacts rendered inside a preview iframe may throttle `requestAnimationFrame`; the engine keeps working, it just
  runs slower there.

## When to reach for three.js instead

Hand-written WebGL2 (~10 KB) is right for **points, fields and post-processing** — everything in this skill. Use
three.js (+ `postprocessing` from pmndrs) when you need **meshes, models, cameras that orbit, lights, shadows, or many
different objects**. The concepts transfer one-to-one:

```js
// three.js equivalent of the particle contract
const geo = new THREE.BufferGeometry();
geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));       // same typed arrays
geo.setAttribute('aDna', new THREE.BufferAttribute(dna, 4));
const mat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(devicePixelRatio, 2) } },
  vertexShader: VS, fragmentShader: FS,                                 // gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1)
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
scene.add(new THREE.Points(geo, mat));
// Bloom: EffectComposer + RenderPass + EffectPass(camera, new BloomEffect({ luminanceThreshold: 0.9, intensity: 0.45 }))
```
Trade-off: ~150–200 KB gzip of library for a ready pipeline with HDR, tone mapping and merged effects. For a page that is
mostly the hero, the hand-written version is smaller, faster to load, and has no version churn. For a project that is
already on three.js, use its pipeline and port the shader logic.

Looking forward: three.js is moving to `WebGPURenderer` and TSL (shaders written in JS, compiled to WGSL *and* GLSL).
A new project in 2026 with heavy 3-D needs may want to start there; the fallback to WebGL2 still exists.

## Canvas 2D fallback / the 80-20 version

When the full pipeline is not justified (a marketing page that must convert on 3G, a docs site), an animated CSS
gradient plus ~200 particles on a 2-D canvas costs ~3 KB and delivers most of the feel:

```js
const ctx = canvas.getContext('2d'); const P = Array.from({ length: 200 }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2, s: 0.2 + Math.random() }));
ctx.globalCompositeOperation = 'lighter';                              // additive, like the GL version
function frame(t) { ctx.clearRect(0, 0, W, H);
  for (const p of P) { const y = (p.y + t * 1e-5 * p.s) % 1; ctx.beginPath(); ctx.arc(p.x * W, y * H, p.r, 0, 7); ctx.fillStyle = 'rgba(180,200,255,.6)'; ctx.fill(); }
  requestAnimationFrame(frame); }
```
Measure before scaling up. Many "we need WebGL" briefs are satisfied by this plus good typography.

## Exporting stills and video

`scene.step(1/60)` advances the simulation deterministically without waiting for a frame. For a poster frame: call
`step` until the intro is done, then `canvas.toDataURL('image/png')` (create the context with
`preserveDrawingBuffer: true` for that, or read pixels right after `step`). For video: step + `canvas.captureStream()`
+ `MediaRecorder`, or step + `toBlob` per frame for a lossless sequence.
