# Performance budget and accessibility

The difference between a demo and a production hero is entirely in this file. The templates already implement
everything below; this is the reasoning, so you can keep it true when you change things.

## Performance budget

| Resource | Rule | Why |
|---|---|---|
| Device pixel ratio | `Math.min(devicePixelRatio, 2)` | DPR 3 on a full screen is 2.25× the pixels of DPR 2 for no visible gain. |
| Particle count | 20k–40k tiny points, or ~3–8k if they are large | The real cost is **fill rate**: 5k points of 40 px paint more pixels than 40k of 3 px. |
| Draw calls | one per population | Merge populations with a flag attribute (the engine's background layer does this). |
| Per-frame uploads | zero | Only uniforms change. `bufferSubData` every frame throws away the whole advantage. |
| Uniform lookups | cached once | `getUniformLocation` is a string lookup; never call it in the loop. |
| Post-processing passes | ≤ 6 full-screen passes | Each is a full-screen read + write. The bloom pyramid is already 9 small ones. |
| Field shaders | ≤ 4–5 fbm evaluations per pixel at full res | fbm is 5 noise lookups; on integrated GPUs use `resolutionScale` 0.5–0.75 (template-field) — nobody can see the difference on smooth noise. |
| Context flags | `antialias:false, depth:false, stencil:false` | Points have no edges; additive light has no occlusion. MSAA resolve on a full screen for nothing. |
| HDR target | `RGBA16F` via `EXT_color_buffer_float`, fallback `RGBA8` | Without HDR everything clips at 1.0 and the bloom has nothing to harvest — flat white. |
| Hidden tab | skip the frame when `document.hidden` | rAF slows down on its own; the clock must not jump when it returns (dt clamp). |
| Off-screen | `IntersectionObserver` + rect check | A hero below the fold should cost nothing. |
| Time step | `dt = min(elapsed, 1/30)` | A tab that was hidden for a minute must not advance the intro by a minute. |
| Smoothing | `k = 1 - pow(0.001, dt)` | A fixed `x += (target - x) * 0.1` runs 2.7× faster at 165 Hz than at 60 Hz. |
| gl_PointSize | clamp to `ALIASED_POINT_SIZE_RANGE` | Many mobile GPUs cap at 64–256 device pixels; bigger requests silently clamp or vanish. |
| Measuring | the weakest device your audience owns | Reference point: the full pipeline runs ~40 fps with 31k points in SwiftShader (pure software rendering). Any real GPU has headroom. |

**Tuning order that avoids wasted work:** structure first (bloom 0, core 0, exposure high) → palette → sprite sizes →
bloom/threshold → tone mapping → *then* re-tune exposure, because ACES crushes the lows. Then grain and vignette last.

**Quick self-check in devtools:** hook `drawArrays` for one second (see `audit.md`) — you should see 1–2 point draws and
~13 triangle draws per frame. If you see hundreds of draws, something is being drawn per particle.

## Accessibility and robustness

1. **`prefers-reduced-motion` — three levels of quality.**
   Minimum: freeze the clock. Good: a calm version (no rotation, no twinkle, reduced grain). Best: pass the preference
   into the shader as a uniform (`uReduced`) and *draw* a composed static state. The engine freezes `uTime`, disables
   the lens/pulse/breathing, halves the grain and completes the intro instantly; `uReduced` is available to the subject
   if it wants to render something calmer still. Listen for changes: the user can toggle it while the page is open.
2. **Text contrast over a moving scene.** The scene changes every frame; text needs a guarantee. The vignette and the
   radial darkening are not decoration — they keep contrast inside WCAG AA at the edges where text usually sits. Check
   the *brightest* frame (bloom peak, lens active), not an average one.
3. **`pointer-events: none` on the canvas.** It is decoration. It must not steal clicks, focus, or scroll. Listen for
   pointer/wheel on `window`, not on the canvas.
4. **`aria-hidden="true"` on the canvas**, and never put meaning in the animation. No number, label or state may depend
   on the animation to be understood.
5. **Fallback when there is no WebGL2** (`getContext` returns null), when the context is lost mid-session
   (`webglcontextlost` — GPU reset, tab discard, driver update) and when it comes back (`webglcontextrestored` — rebuild
   everything). The fallback is a CSS gradient that looks intentional, never a black rectangle or a broken layout.
6. **Release resources on unmount** (`deleteTexture`, `deleteFramebuffer`, `deleteProgram`, `deleteVertexArray`,
   `WEBGL_lose_context.loseContext()`). SPAs that mount a hero on every route change leak a context per visit otherwise —
   browsers cap contexts at ~16 and start killing the oldest.
7. **Battery and thermals.** A full-screen hero at 165 fps on a laptop is a heater. If the scene is decorative, it is
   legitimate to cap it: skip every other frame when `dt < 1/100`, or render the field pass at half resolution.
8. **Photosensitivity.** No full-screen flashes above 3 per second. Pulses (click "exhale", fireflies) are local and slow.

## Production checklist

- [ ] Canvas `fixed`/`absolute`, `pointer-events:none`, `aria-hidden`, behind the content with an explicit `z-index`
- [ ] Context created with `depth:false`, `antialias:false`, `stencil:false`, `powerPreference:'high-performance'`
- [ ] DPR capped at 2; `uPixelRatio` reaches the vertex shader
- [ ] Buffers `STATIC_DRAW`, created once; zero uploads per frame
- [ ] Uniform locations cached at program creation
- [ ] `dt` clamped; every smoothing is framerate-independent
- [ ] Rendering paused when hidden and when off-screen
- [ ] `prefers-reduced-motion` produces a real alternative state, reacts to live changes
- [ ] Static fallback when the context is missing or lost; rebuild on restore
- [ ] Resources freed on unmount (SPA route changes!)
- [ ] Text contrast verified over the brightest frame
- [ ] Budget measured on the weakest target device, not on the development machine
- [ ] Debug HUD and hint line removed (or gated) before shipping
