---
name: quadknob
description: Put a value in front of the user on four knobs to dial in by eye, in their own running page. Use for anything best judged by looking rather than by number - radii, spacing, type size and leading, colour, shadow, easing, timing - or when the user asks to "dial in", "tune", "tweak by eye", "give me knobs" or mentions quadknob. Drops a self-contained <quadknob-panel> web component into any web page (plain HTML, React, Astro, Vue, …); the user turns the knobs and presses Done, which copies the values to paste back.
---

# Quadknob

Four knobs, after the OP-1: blue, green, white, orange. You put up to four values on a panel in the user's running page,
they dial them in by eye with mouse, keyboard, touch or a MIDI controller, press **Done**, and paste the summary back to
you. Then you write the values into the code and take the panel away.

The limit is the point. Choosing the four is your job: pick the ones that decide how it looks, not every property you
could expose. If there are more than four, open a second panel, or ask which matter.

## When

- A value whose right answer is "what looks right": a radius, padding, gap, type size or leading, a colour, a shadow, an
  easing curve or duration.
- The user is going back and forth on a number ("a bit more… no, less").
- Not for values with a correct answer you can work out (alignment to a grid, contrast ratios), or for anything that is
  not visible in a browser.

## How

1. **Get the component into the page.** It is one file: `quadknob.js` in this skill's directory. Copy it where the
   project serves static files from (`public/`, `static/`, the site root…), e.g. `public/quadknob.js`, and load it:

   ```html
   <script type="module" src="/quadknob.js"></script>
   ```

   In a framework, put the tag in the page's head or layout, or `import '/quadknob.js'` from client code. It defines
   `<quadknob-panel>`, which works as a plain element in JSX/templates. Mark everything you add with a
   `quadknob` comment so you can find it to remove it.

2. **Put a panel on the page**, near what it tunes or `floating` in the corner:

   ```html
   <quadknob-panel floating label="Card" figure="frame" target=".card" params='[
     {"name": "radius",  "label": "Radius",  "stops": "radius",  "default": 8},
     {"name": "padding", "label": "Padding", "stops": "spacing", "default": 16, "token": "p-{label}"},
     {"name": "border",  "label": "Border",  "min": 0, "max": 4, "unit": "px", "default": 1},
     {"name": "gap",     "label": "Gap",     "stops": "spacing", "default": 16, "token": "gap-{label}"}
   ]'></quadknob-panel>
   ```

   Start every knob at the value the code has now, so Space ("before") compares against the real thing.

3. **Make the values reach what they tune**, one of two ways:
   - **`css` template**: a stylesheet the panel keeps in `<head>`, with `{name}` replaced by each knob's raw value
     (numbers without unit, choices as strings). Best when you'd otherwise have to touch the real styles:
     `css=".card { border-radius: {radius}px; padding: {padding}px }"`. Use `!important` if the page's own rules win.
   - **Custom properties**: without `css`, each value is set as `--name: value` with its unit on the `target` elements
     (a selector; the page root if omitted). Use when the styles already read variables, or point a temporary rule at them.
   - In script, listen for `quadknob-change` (`event.detail.values`).

4. **Tell the user what to do**, briefly: turn the knobs (drag up/down, scroll, or `y/h u/j i/k o/l`; hold Space for
   before; ⌥ to step between tokens), press **Done** (or Enter), paste what it copies. Mention "Connect MIDI" if they
   have a controller: knobs on CC 1–4, any channel.

5. **Write the values back.** The pasted summary names tokens as the code writes them:
   `Card: Radius rounded-lg (8px), Padding p-4 (16px), Border 2px, Gap gap-4 (16px)`. Use the token (`rounded-lg`), not
   the pixel value, when the project uses that scale. "off the scale" means they turned freely past the tokens; ask
   whether to add a token or use an arbitrary value.

6. **Clean up**: remove the panel, the script tag or import, and the copied `quadknob.js`, unless the user wants to
   keep tuning.

## Params

Each param is one knob, in lane order (blue, green, white, orange). At most four.

| Field | |
|---|---|
| `name` | Key in values, `{name}` in `css`, `--name` as a property. Must match the figure's names if using a figure. |
| `label` | Shown on the knob and in the summary. |
| `min`, `max`, `step`, `unit`, `default` | A number knob. `unit` is shown and added to custom properties. |
| `stops` | Snap to tokens: a scale name (`radius`, `spacing`, `text`, `leading`, `font-weight`, `tracking` — Tailwind's) or a list of numbers or `{label, value}`. Each detent moves one stop; ⌥ turns freely by `step`. |
| `token` | How the code writes a stop, `{label}` replaced: `"p-{label}"` → `p-4`. Scales set a sensible default (`rounded-{label}`, `text-{label}`…; spacing is bare, so give it the utility). |
| `options` | A choice knob instead: a list of strings, e.g. font families or `["linear", "ease-out"]`. |

Use the project's own scale when it has one: read its Tailwind theme or design tokens and pass them as `stops`.

## Figures

A figure is a little drawing above the knobs of what each knob does, each part in its knob's colour. Optional: with
`compact` and no figure the panel is one strip of knobs, which is often enough when the page itself shows the change.

| `figure` | Param names it draws |
|---|---|
| `frame` | `radius`, `padding`, `border`, `gap` (px) |
| `type` | `family` (choice), `size` (px), `leading`, `weight` |
| `color` | `lightness` 0–1, `chroma` 0–0.4, `hue` 0–360, `alpha` 0–1 (OKLCH) |
| `shadow` | `x`, `y`, `blur`, `spread` (px) |
| `curve` | `x1`, `y1`, `x2`, `y2`: a cubic-bezier |
| `motion` | `duration`, `delay` (ms), `distance` (px), `easing` (choice of CSS keywords) |
| `grid` | `width`, `minimum`, `gap` (px), `count` |

A custom figure: put a `<template>` inside the panel. Its HTML runs in a sandboxed frame with a `bench` object
(`bench.on(values => …)`, `bench.color(name)` for a knob's lane colour, `bench.params`, `bench.before`) and the theme as
CSS variables (`--fg`, `--bg`, `--dim`, `--line`, `--blue`…). Keep it a diagram, not a copy of the page.

## Attributes

`params` (JSON), `values` (JSON, starting values), `label`, `figure`, `css`, `target`, `floating` (fixed in the
bottom-right corner), `compact` (one row, no key hints), `theme="light|dark"` (follows the system otherwise). Restyle
with `--qk-*` custom properties on the element (`--qk-figure-height`, `--qk-bg`, `--qk-fg`, lane colours…).

JS: `panel.params = [...]`, `panel.values` (get/set), `panel.summary`, `panel.done()`; events `quadknob-change` and
`quadknob-done` (`{ values, summary }`).

## Notes

- Done copies with the Clipboard API, which needs a secure page (https or localhost). Elsewhere it shows the summary in
  a box to copy by hand.
- MIDI needs a secure page too, and asks permission on the first click of "Connect MIDI". Safari has no Web MIDI.
- Several panels can share a page; MIDI knobs drive the one touched last.
- Turns synthesize the post's default click locally with Web Audio: 2400 Hz pitch, 18 ms decay, 60% noise, 35% volume.
  These are fixed, not extra knobs. Only value changes click (including MIDI after pickup), capped at one per 18 ms.
  Audio wakes on the first interaction; browsers may keep MIDI-only audio silent until a mouse/key/touch gesture.
- Clicking a panel gives it the lane keys; Escape releases keyboard focus. Dragging suppresses page text selection
  until pointer capture ends, including cancelled drags. Touch shows the enlarged dial around the finger.
- `demo.html` in this skill's directory shows every mode.
