# Interaction and choreography

Interaction is what turns a screensaver into a hero. Every interaction below follows the same shape: an **input**
(pointer, click, scroll, time, visibility) is smoothed on the CPU into a few numbers, sent as **uniforms**, and the
**shader** decides what each particle does with them. Nothing per-particle ever happens on the CPU.

## The intro: propagated progress

A global fade (`opacity 0 → 1`) looks like a slideshow. A **propagated** reveal looks like something coming alive:

```glsl
// uIntro 0..1 global progress, uPropagation how much the reveal spreads (0 = everyone together, 2 = a long wave)
float p = clamp(uIntro * (1.0 + uPropagation) - reveal * uPropagation, 0.0, 1.0);
p = p * p * (3.0 - 2.0 * p);            // smoothstep
pos = mix(startPos, finalPos, p);       // and size *= mix(0.15, 1.0, p), alpha *= p
```

`reveal` is the per-particle order (0 first). Galaxy: the radius (lights up from the core). Text: the x coordinate
(sweeps left to right). Lavender: the depth (near rows first). Helix: the height (builds bottom-up). A path: the arc
length (traces itself). The same one-liner gives you "stagger" for lists, grids and text in CSS-land too — it is
`animation-delay: calc(var(--i) * 40ms)`.

The start position (`scatter.xy`) is part of the story: a galaxy condenses from a wide cloud, flowers grow from the
ground, text gathers from everywhere, stars burst from the centre. Choose it deliberately.

Ease the global progress on the CPU (`1 - pow(1 - x, 3)`) and give it 2.5–4 seconds. Faster looks nervous.

## Pointer lens

A soft magnifier that follows the cursor: particles are pushed radially away from the pointer and lit up.

```glsl
vec2 d = screen - uLensPointer; float dist = length(d);
float f = smoothstep(uLensRadius, 0.0, dist);                       // 1 at the pointer, 0 at the radius
screen += normalize(d + 1e-5) * f * uLensRadius * (uLensMag - 1.0) * 0.45;
size  *= 1.0 + f * (uLensMag - 1.0) * 1.4;
alpha *= 1.0 + f * uLensIllum;
```

On the CPU the pointer is smoothed with `k = 1 - pow(0.001, dt)` so it lags like something with mass. Radius 0.25–0.4
(NDC units), magnification 1.2–1.6. Deactivate when the pointer leaves the window and under reduced motion. On touch
devices there is no hover: treat `pointerdown` + drag as the lens, or skip it.

Variants: **repel** (same formula, larger displacement, no illumination — a hand parting the flowers), **attract**
(negative displacement — particles gather under the cursor), **wake** (illuminate only, no displacement — a torch).

## Click pulse ("exhale")

`pointerdown` sets `exhale = 0.32`; each frame `exhale *= pow(0.06, dt)` (framerate-independent decay). The shader
scales positions by `1 + exhale * (0.3 + jitter * 0.5)`: the whole scene breathes out and settles. Cheap, satisfying,
invisible in the code. Keep it under 0.4 or it looks like an explosion.

## Scroll

Two different things people mean:

**A. The hero reacts to scrolling (drift / scatter / shrink).** The template listens to `wheel` and keeps a value that
always decays back to zero, so the galaxy drifts and loosens while you scroll and settles when you stop. For a real
scrolling page, replace the wheel accumulator with the actual scroll position, normalised:

```js
const progress = Math.min(1, scrollY / innerHeight);      // 0 at the top, 1 one viewport down
// then each frame: uniform uScrollDrift = progress * 0.4, uScrollScatter = progress * 0.15, uScrollSize = 1 - progress * 0.3
```
Also fade the canvas out (`opacity: 1 - progress`) so the GPU stops paying for a hero nobody sees, and pause the loop
once it is fully off-screen (the IntersectionObserver does this).

**B. Scroll-driven animation of DOM elements** (parallax galleries, progress bars, reveal-on-scroll). Do not use JS for
this. CSS scroll-driven animations run off the main thread:

```css
.card { animation: rise linear both; animation-timeline: view(); animation-range: entry 0% entry 60%; }
@keyframes rise { from { opacity: 0; transform: translateY(40px) } }
```
Fallback for browsers without `animation-timeline`: an `IntersectionObserver` that adds a class. Never a scroll
listener that sets `style.transform` — that is the jank everyone complains about.

## Text over the scene

The reference page animates its headline letter by letter with plain CSS keyframes: blur + rise + fade, staggered.

```css
h1 span { display:inline-block; opacity:0; transform:translateY(.35em); filter:blur(6px);
          animation: rise 1.4s cubic-bezier(.16,1,.3,1) forwards; animation-delay: calc(var(--i) * 60ms); }
@keyframes rise { to { opacity:1; transform:none; filter:blur(0) } }
@media (prefers-reduced-motion: reduce) { h1 span { animation:none; opacity:1; transform:none; filter:none } }
```
`mix-blend-mode: screen` on the text lets the brightest particles glow through the letters. Time the text so it lands
as the intro's propagation reaches the middle of the scene (≈ 40–60% of the intro duration).

## Time and morphs

- **Auto-cycling morph** (text A ⇄ B): `m = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(t * 0.45))` — the smoothstep makes
  the shape *dwell* at each end instead of always being in transit.
- **Scroll-driven morph**: set `uMorph` from scroll progress; each section of the page is a shape.
- **Per-particle delay** inside a morph: `mm = smoothstep(0, 1, (m - delay) / 0.6)` with `delay` random 0..0.4 → the
  change sweeps rather than snaps, and an arc `p.y += sin(mm·π) * k` makes particles travel in curves, not lines.

## Choreographing several inputs

The state object on the CPU holds one smoothed number per input (`pointer`, `exhale`, `scroll`, `intro`, `t`). Each is
independent, each has its own time constant, and the shader combines them additively. That independence is why the
scene never "fights itself": no input cancels or waits for another. Add a new input the same way — a number, a decay
rule, a uniform — and never a per-particle loop.
