# skills

A collection of custom skills for [Claude Code](https://claude.com/claude-code). Each top-level folder is one skill:
a `SKILL.md` with instructions plus bundled `assets/`, `references/` and `scripts/`.

| Skill | What it does |
|---|---|
| [`cinematic-web-animation/`](cinematic-web-animation/) | Builds cinematic, GPU-driven web animations and generative art scenes as zero-dependency single-file WebGL2 (galaxies, nebulae, auroras, flow fields, fireflies, flower fields, oceans, globes, text morphs, black holes…) with HDR bloom, film grain, pointer/scroll interaction, a propagated intro and `prefers-reduced-motion` built in. |

## Installing a skill

Copy the skill folder into your Claude Code skills directory:

```bash
# user-wide
git clone https://github.com/malcolndandaro/skills.git
cp -r skills/cinematic-web-animation ~/.claude/skills/

# or per project
cp -r skills/cinematic-web-animation <your-project>/.claude/skills/
```

Then ask Claude for "an animated hero background like the OpenAI galaxy", "a lavender field at sunset", "particles that
form our logo", and so on. The skill triggers on its own; you can also invoke it explicitly with `/cinematic-web-animation`.

## cinematic-web-animation at a glance

- `assets/template-full.html` — the engine: particles + optional background field + bloom pyramid + ACES composite +
  interaction + accessibility, ~10 KB, no dependencies. The subject (what is drawn) is a small pluggable block.
- `assets/subjects/*.js` — 17 drop-in subjects; `assets/examples/*.html` — each composed into a ready-to-open page
  (`assets/examples/index.html` is a gallery).
- `scripts/compose.py <subject> out.html` — template + subject → page; `scripts/build_examples.py` rebuilds all examples.
- `references/` — subject catalog, shader cookbook, interaction patterns, framework integration, performance and
  accessibility checklist, and console recipes for auditing any site's animation stack.

To browse the examples locally:

```bash
cd skills/cinematic-web-animation && python -m http.server 8765
# open http://localhost:8765/assets/examples/
```
