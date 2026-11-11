// Quadknob: four knobs to dial values in by eye, after the OP-1. One dependency-free custom element, <quadknob-panel>.
// Build with `node build.mjs`, which inlines the figures from ./figures into ../quadknob.js.

/* global FIGURES */

const LANES = ['blue', 'green', 'white', 'orange']
const KEYS = [['y', 'h'], ['u', 'j'], ['i', 'k'], ['o', 'l']]
/** Each lane's MIDI control change number, on any channel: an AKAI LPD8's top row on its first program. */
const MIDI_CC = [1, 2, 3, 4]

// The dial sweeps 270°, from 7:30 to 4:30, like a hardware encoder's travel.
const SWEEP = 270
const START = 135
// Pixels of drag per detent: a finger travels further than a mouse. Scrolling builds up, by distance.
const DRAG_STEP = 6
const TOUCH_STEP = 4
const WHEEL_STEP = 40

// The post's default click, fixed here: a short band-passed noise burst mixed with a falling triangle blip.
const DEFAULT_CLICK = Object.freeze({ pitch: 2400, decay: 18, noise: 0.6, volume: 0.35 })
const MIN_GAP = 0.018
let context
let noiseBuffer
let last = 0

function audio() {
  if (!('AudioContext' in window)) return undefined
  context ??= new AudioContext()
  if (!noiseBuffer) {
    noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.25), context.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  if (context.state === 'suspended') void context.resume()
  return context
}

function click() {
  const { pitch, decay, noise, volume } = DEFAULT_CLICK
  const ctx = audio()
  if (!ctx || ctx.state !== 'running') return
  const now = ctx.currentTime
  // Shared by every panel: a fast wheel or MIDI sweep must not pile up clicks.
  if (now - last < MIN_GAP) return
  last = now

  const length = decay / 1000
  const out = ctx.createGain()
  out.gain.setValueAtTime(0.0001, now)
  out.gain.exponentialRampToValueAtTime(volume, now + 0.0015)
  out.gain.exponentialRampToValueAtTime(0.0001, now + 0.0015 + length)
  out.connect(ctx.destination)

  const source = ctx.createBufferSource()
  source.buffer = noiseBuffer
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = pitch
  band.Q.value = 1.5
  const noiseLevel = ctx.createGain()
  noiseLevel.gain.value = noise * 2.5
  source.connect(band).connect(noiseLevel).connect(out)
  source.start(now)
  source.stop(now + length + 0.01)

  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(pitch, now)
  osc.frequency.exponentialRampToValueAtTime(pitch * 0.5, now + length)
  const toneLevel = ctx.createGain()
  toneLevel.gain.value = 1 - noise
  osc.connect(toneLevel).connect(out)
  osc.start(now)
  osc.stop(now + length + 0.01)
}

function clickAfterRender() {
  // Safari needs the wake-up inside the gesture, not the frame callback.
  audio()
  requestAnimationFrame(click)
}

/** The pointer leaves the knob during a drag; don't let it select the surrounding page. */
function holdSelection(hold) {
  const root = document.documentElement.style
  root.userSelect = hold ? 'none' : ''
  root.setProperty('-webkit-user-select', hold ? 'none' : '')
  if (hold) window.getSelection()?.removeAllRanges()
}

// Tailwind's scales, so a knob steps through the values the code already uses. `token` is how the code writes one.
const stops = (entries) => entries.map(([label, value]) => ({ label, value }))
const SCALES = {
  radius: { token: 'rounded-{label}', unit: 'px', stops: stops([['none', 0], ['xs', 2], ['sm', 4], ['md', 6], ['lg', 8], ['xl', 12], ['2xl', 16], ['3xl', 24], ['4xl', 32]]) },
  spacing: { token: '{label}', unit: 'px', stops: stops([['0', 0], ['0.5', 2], ['1', 4], ['1.5', 6], ['2', 8], ['2.5', 10], ['3', 12], ['4', 16], ['5', 20], ['6', 24], ['8', 32], ['10', 40], ['12', 48], ['16', 64], ['20', 80], ['24', 96]]) },
  text: { token: 'text-{label}', unit: 'px', stops: stops([['xs', 12], ['sm', 14], ['base', 16], ['lg', 18], ['xl', 20], ['2xl', 24], ['3xl', 30], ['4xl', 36], ['5xl', 48], ['6xl', 60]]) },
  leading: { token: 'leading-{label}', unit: '', stops: stops([['none', 1], ['tight', 1.25], ['snug', 1.375], ['normal', 1.5], ['relaxed', 1.625], ['loose', 2]]) },
  'font-weight': { token: 'font-{label}', unit: '', stops: stops([['thin', 100], ['extralight', 200], ['light', 300], ['normal', 400], ['medium', 500], ['semibold', 600], ['bold', 700], ['extrabold', 800], ['black', 900]]) },
  tracking: { token: 'tracking-{label}', unit: 'em', stops: stops([['tighter', -0.05], ['tight', -0.025], ['normal', 0], ['wide', 0.025], ['wider', 0.05], ['widest', 0.1]]) },
}

// ---- Model: params, values and how a knob turns them ----

/** Fill in a param's defaults: its scale's stops and token, a range around them, a step. */
function normalize(input) {
  const param = { ...input }
  param.label ??= param.name
  if (param.options) param.type ??= 'choice'
  param.type ??= 'number'
  if (param.type !== 'number') return param
  const scale = typeof param.stops === 'string' ? param.stops : param.scale
  if (scale) {
    const known = SCALES[scale]
    if (!known) throw new Error(`quadknob: unknown scale "${scale}" (${Object.keys(SCALES).join(', ')})`)
    param.stops = typeof param.stops === 'string' || !param.stops ? known.stops : param.stops
    param.token ??= known.token
    param.unit ??= known.unit
  }
  if (Array.isArray(param.stops)) {
    param.stops = param.stops.map((stop) => typeof stop === 'number' ? { label: String(stop), value: stop } : stop)
      .sort((a, b) => a.value - b.value)
    param.min ??= param.stops[0].value
    param.max ??= param.stops.at(-1).value
  }
  param.min ??= 0
  param.max ??= 100
  param.step ??= 1
  return param
}

function defaultValue(param) {
  if (param.type === 'choice') return param.default ?? param.options[0]
  const value = param.default ?? param.min
  return param.stops ? nearestStop(param.stops, value).value : value
}

function snap(param, value) {
  const stepped = param.min + Math.round((value - param.min) / param.step) * param.step
  // Round away float noise from the step arithmetic, e.g. 0.1 + 0.2.
  const decimals = (String(param.step).split('.')[1] ?? '').length
  return Math.min(param.max, Math.max(param.min, Number(stepped.toFixed(decimals))))
}

function coerce(param, value) {
  if (param.type === 'choice') return param.options.includes(value) ? value : defaultValue(param)
  const number = Number(value)
  if (!Number.isFinite(number)) return defaultValue(param)
  return stopAt(param, number)?.value ?? snap(param, number)
}

const nearestStop = (stops, value) => stops.reduce((best, stop) => Math.abs(stop.value - value) < Math.abs(best.value - value) ? stop : best)
const stopAt = (param, value) => param.stops?.find((stop) => Math.abs(stop.value - Number(value)) < 1e-6)

/** The value `detents` stops on from `value`. Off the scale, the first detent lands on the next stop that way. */
function turnStops(list, value, detents) {
  const on = list.findIndex((stop) => Math.abs(stop.value - value) < 1e-6)
  const from = on !== -1 ? on
    : detents > 0 ? list.findIndex((stop) => stop.value > value) - 1
    : list.findLastIndex((stop) => stop.value < value) + 1
  const index = from === -2 ? list.length - 1 : from
  return list[Math.min(list.length - 1, Math.max(0, index + detents))].value
}

/** Turn a knob by `detents`: numbers by steps, or by stops unless turned `free`; choices by options. */
function turn(param, value, detents, free = false) {
  if (param.type === 'choice') {
    const index = Math.max(0, param.options.indexOf(value))
    return param.options[Math.min(param.options.length - 1, Math.max(0, index + detents))]
  }
  return param.stops && !free ? turnStops(param.stops, Number(value), detents) : snap(param, Number(value) + detents * param.step)
}

/** How far through its range a value is, from 0 to 1. Stops sit evenly round the dial. */
function position(param, value) {
  if (param.type === 'choice') return param.options.length < 2 ? 0 : param.options.indexOf(value) / (param.options.length - 1)
  const v = Number(value)
  if (param.stops) {
    const list = param.stops
    if (list.length < 2 || v <= list[0].value) return 0
    const next = list.findIndex((stop) => stop.value >= v)
    if (next === -1) return 1
    const low = list[next - 1], high = list[next]
    return (next - 1 + (v - low.value) / (high.value - low.value)) / (list.length - 1)
  }
  return param.max === param.min ? 0 : (v - param.min) / (param.max - param.min)
}

/** The value at `t` (0 to 1): the inverse of `position`, for absolute MIDI knobs. */
function fromPosition(param, t) {
  t = Math.min(1, Math.max(0, t))
  if (param.type === 'choice') return param.options[Math.round(t * (param.options.length - 1))]
  if (param.stops) return param.stops[Math.round(t * (param.stops.length - 1))].value
  return snap(param, param.min + t * (param.max - param.min))
}

/** The value as a knob shows it: a token by its short name, a value off the scale in brackets, like Tailwind's. */
function formatValue(param, value) {
  if (param.type === 'choice') return String(value)
  if (param.stops) return stopAt(param, value)?.label ?? `[${value}${param.unit ?? ''}]`
  return `${value}${param.unit ?? ''}`
}

/** The value as the agent reads it: a token as the code writes it with its value, like "rounded-lg (8px)". */
function tokenValue(param, value) {
  if (param.type === 'choice' || !param.stops) return formatValue(param, value)
  const stop = stopAt(param, value)
  const raw = `${value}${param.unit ?? ''}`
  return stop ? `${(param.token ?? '{label}').replaceAll('{label}', stop.label)} (${raw})` : `${raw}, off the scale`
}

// ---- Controls: lane keys, MIDI shared by every panel on the page ----

function laneTurn(key) {
  for (const [lane, [up, down]] of KEYS.entries()) {
    if (key === up) return { lane, detents: 1 }
    if (key === down) return { lane, detents: -1 }
    if (key === up.toUpperCase()) return { lane, detents: 10 }
    if (key === down.toUpperCase()) return { lane, detents: -10 }
  }
}

// Within a step of the 0–127 range counts as reaching the value.
const PICKUP_TOLERANCE = 1.5 / 127
/** Soft takeover: an absolute knob takes over only once it reaches the value, or passes it between two messages. */
function picksUp(current, next, last) {
  if (Math.abs(next - current) <= PICKUP_TOLERANCE) return true
  return last !== undefined && Math.sign(last - current) !== Math.sign(next - current)
}

const midi = {
  access: undefined,
  status: 'off',
  owner: undefined,
  panels: new Set(),
  checked: false,
  emit() { for (const panel of midi.panels) panel.renderMidi() },
  listen() {
    for (const input of midi.access?.inputs.values() ?? []) {
      input.onmidimessage = (event) => {
        const data = event.data
        if (!data || data.length < 3 || (data[0] & 0xf0) !== 0xb0) return
        const lane = MIDI_CC.indexOf(data[1])
        if (lane !== -1) midi.owner?.midiControl(lane, data[2] / 127)
      }
    }
    midi.emit()
  },
  async connect() {
    if (!navigator.requestMIDIAccess) { midi.status = 'unsupported'; return midi.emit() }
    try {
      midi.access = await navigator.requestMIDIAccess()
      midi.access.onstatechange = midi.listen
      midi.status = 'on'
      midi.listen()
    } catch {
      midi.status = 'denied'
      midi.emit()
    }
  },
  /** Connect without asking when the visitor granted MIDI before: browsers prompt for it, so otherwise wait for a click. */
  connectIfGranted() {
    if (midi.checked) return
    midi.checked = true
    if (!navigator.requestMIDIAccess) { midi.status = 'unsupported'; return midi.emit() }
    navigator.permissions?.query({ name: 'midi' }).then((result) => { if (result.state === 'granted') midi.connect() }).catch(() => {})
  },
  claim(panel) {
    if (midi.owner === panel) return
    midi.owner = panel
    midi.emit()
  },
}

// ---- Drawing ----

const svg = (tag, attrs) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`
const point = (cx, cy, r, angle) => [cx + r * Math.cos(angle * Math.PI / 180), cy + r * Math.sin(angle * Math.PI / 180)]
function arc(cx, cy, r, from, to) {
  const [x1, y1] = point(cx, cy, r, from), [x2, y2] = point(cx, cy, r, to)
  return `M${x1},${y1}A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2},${y2}`
}
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function dial(t, hardware) {
  const angle = START + t * SWEEP
  return `<svg viewBox="0 0 40 40" aria-hidden="true">
    ${svg('path', { d: arc(20, 20, 16, START, START + SWEEP), fill: 'none', stroke: 'var(--qk-line)', 'stroke-width': 2, 'stroke-linecap': 'round' })}
    ${t > 0 ? svg('path', { d: arc(20, 20, 16, START, angle), fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }) : ''}
    ${svg('circle', { cx: 20, cy: 20, r: 10, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 })}
    ${hardware !== undefined ? svg('circle', { cx: point(20, 20, 16, START + hardware * SWEEP)[0], cy: point(20, 20, 16, START + hardware * SWEEP)[1], r: 2.5, fill: 'var(--qk-dim)' }) : ''}
    ${svg('line', { x1: point(20, 20, 4, angle)[0], y1: point(20, 20, 4, angle)[1], x2: point(20, 20, 10, angle)[0], y2: point(20, 20, 10, angle)[1], stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })}
  </svg>`
}

/** The value drawn large around a finger turning a knob, as the finger hides the knob. Lives on the page, not the panel. */
const touchRing = {
  element: undefined,
  show(x, y, color, label, shown, t) {
    const R = 64, size = R * 2 + 16, c = size / 2
    if (!touchRing.element) {
      touchRing.element = document.body.appendChild(document.createElement('div'))
      touchRing.element.setAttribute('aria-hidden', 'true')
    }
    const el = touchRing.element
    el.setAttribute('style', `position:fixed;z-index:2147483647;pointer-events:none;left:${x - c}px;top:${y - c}px;width:${size}px;height:${size}px;color:${color};font-family:ui-monospace,SFMono-Regular,Menlo,monospace`)
    const angle = START + t * SWEEP
    const [dx, dy] = point(c, c, R, angle)
    el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" style="position:absolute;inset:0;overflow:visible">
        ${svg('circle', { cx: c, cy: c, r: R + 8, fill: 'rgb(255 255 255 / 0.75)' })}
        ${svg('path', { d: arc(c, c, R, START, START + SWEEP), fill: 'none', stroke: 'rgb(0 0 0 / 0.15)', 'stroke-width': 6, 'stroke-linecap': 'round' })}
        ${t > 0 ? svg('path', { d: arc(c, c, R, START, angle), fill: 'none', stroke: 'currentColor', 'stroke-width': 6, 'stroke-linecap': 'round' }) : ''}
        ${svg('circle', { cx: dx, cy: dy, r: 7, fill: 'currentColor', stroke: 'white', 'stroke-width': 2 })}
      </svg>
      <div style="position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:4px;padding:4px 10px;border-radius:6px;background:rgb(255 255 255 / 0.92);box-shadow:0 2px 12px rgb(0 0 0 / 0.15);text-align:center;white-space:nowrap">
        <div style="font-size:11px;color:#57606a">${escape(label)}</div>
        <div style="font-size:20px;line-height:1.2;font-weight:300;color:#1b1f24">${escape(shown)}</div>
      </div>`
  },
  hide() { touchRing.element?.remove(); touchRing.element = undefined },
}

// ---- Figures: a little drawing of what each knob does, in a sandboxed frame ----

// Runs inside the figure document. Defines `bench` (and `quadknob`), synced with the panel; values mirror as CSS variables.
function prelude(initial) {
  let state = initial
  const listeners = []
  const root = document.documentElement
  const lane = (name) => state.params.find((param) => param.name === name)?.lane
  function apply() {
    for (const [name, color] of Object.entries(state.colors)) root.style.setProperty(`--${name}`, color)
    for (const [name, font] of Object.entries(state.fonts)) root.style.setProperty(`--font-${name}`, font)
    for (const param of state.params) root.style.setProperty(`--${param.name}-color`, state.colors[param.lane])
    for (const [name, value] of Object.entries(state.values)) {
      if (typeof value !== 'string') root.style.setProperty(`--${name}`, String(Number(value)))
    }
    Object.assign(window.bench, { values: state.values, before: state.before, params: state.params })
    for (const listener of listeners) listener(state.values)
  }
  window.bench = window.quadknob = {
    values: state.values,
    before: state.before,
    params: state.params,
    lane,
    color: (name) => state.colors[lane(name)] ?? state.colors.fg,
    on(listener) {
      listeners.push(listener)
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => listener(state.values), { once: true })
      else listener(state.values)
    },
  }
  apply()
  addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.type !== 'state') return
    state = event.data.state
    apply()
  })
}

const FIGURE_BASE = '*{box-sizing:border-box}html,body{margin:0;height:100%;background:transparent;'
  + 'color:var(--fg);font:13px/1.4 var(--font-mono);font-variant-numeric:tabular-nums}'

// ---- The element ----

const STYLE = `
:host {
  --qk-bg: #ffffff; --qk-surface: #f7f7f5; --qk-fg: #1b1f24; --qk-dim: #6a737d; --qk-line: #d9d9d3;
  --qk-blue: oklch(0.52 0.29 241); --qk-green: oklch(0.59 0.305 156); --qk-white: #111111; --qk-orange: oklch(0.65 0.23 43);
  --qk-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --qk-figure-height: 240px;
  display: block; color: var(--qk-dim); font: 12px/1.4 var(--qk-mono); -webkit-tap-highlight-color: transparent;
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --qk-bg: #17191c; --qk-surface: #1e2125; --qk-fg: #e9ecef; --qk-dim: #9aa3ad; --qk-line: #343a40;
    --qk-blue: oklch(0.57 0.3 258); --qk-green: oklch(0.62 0.21 156); --qk-white: oklch(0.92 0.005 250); --qk-orange: oklch(0.65 0.2 40);
  }
}
:host([theme="dark"]) {
  --qk-bg: #17191c; --qk-surface: #1e2125; --qk-fg: #e9ecef; --qk-dim: #9aa3ad; --qk-line: #343a40;
  --qk-blue: oklch(0.57 0.3 258); --qk-green: oklch(0.62 0.21 156); --qk-white: oklch(0.92 0.005 250); --qk-orange: oklch(0.65 0.2 40);
}
:host([floating]) { position: fixed; z-index: 2147483646; right: 16px; bottom: 16px; width: min(440px, calc(100vw - 32px)); }
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.panel { position: relative; overflow: hidden; border: 1px solid var(--qk-line); border-radius: 10px; background: var(--qk-bg); outline: none; }
/* A fat ring while the keyboard is in the panel, so it's clear which panel the lane keys turn. */
.panel:has(:focus-visible), .panel:focus-visible { outline: 3px solid var(--qk-fg); outline-offset: 4px; }
:host([floating]) .panel { box-shadow: 0 12px 40px rgb(0 0 0 / 0.18); }
.head { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--qk-line); background: var(--qk-surface); color: var(--qk-fg); }
.head .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stage { position: relative; height: var(--qk-figure-height); border-bottom: 1px solid var(--qk-line); background: var(--qk-surface); }
.stage iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; margin: 0; }
.before { position: absolute; top: 8px; left: 12px; padding: 1px 6px; border-radius: 3px; background: var(--qk-fg); color: var(--qk-bg); }
.knobs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.knob { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; padding: 14px 6px; cursor: ns-resize; touch-action: none; user-select: none; -webkit-user-select: none; outline: none; }
.knob:focus-visible { background: var(--qk-surface); }
.knob svg { width: 40px; height: 40px; flex: none; }
.knob .label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--qk-dim); font-size: 11px; }
.knob .label .raw { opacity: 0.7; }
.knob .value { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--qk-fg); font-size: 22px; font-weight: 300; line-height: 1; font-variant-numeric: tabular-nums; }
.knob .value.long { font-size: 15px; line-height: 22px; }
.knob.empty { cursor: default; color: var(--qk-line); }
.knob.empty .value { color: var(--qk-line); }
.keys { display: flex; gap: 2px; }
kbd { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 4px; border: 1px solid var(--qk-line); border-radius: 3px; background: var(--qk-bg); color: var(--qk-dim); font: 10px/1 var(--qk-mono); }
:host([compact]) .knob { flex-direction: row; justify-content: flex-start; gap: 8px; padding: 8px 10px; }
:host([compact]) .knob svg { width: 32px; height: 32px; }
:host([compact]) .knob .text { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
:host([compact]) .knob .value { font-size: 16px; }
:host([compact]) .knob .value.long { font-size: 13px; line-height: 16px; }
:host([compact]) .keys { display: none; }
.text { display: contents; }
.blue { color: var(--qk-blue); } .green { color: var(--qk-green); } .white { color: var(--qk-white); } .orange { color: var(--qk-orange); }
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding: 7px 12px; border-top: 1px solid var(--qk-line); }
.foot .hints { flex: 1; display: inline-flex; flex-wrap: wrap; align-items: center; gap: 3px; min-width: 0; }
button { padding: 0; border: 0; background: none; color: var(--qk-dim); font: inherit; cursor: pointer; }
button:hover { color: var(--qk-fg); }
button.midi.off { text-decoration: underline dotted; text-underline-offset: 2px; }
button.done { padding: 3px 10px; border: 1px solid var(--qk-line); border-radius: 5px; background: var(--qk-bg); color: var(--qk-fg); }
button.done:hover { background: var(--qk-surface); }
.copied { flex-basis: 100%; }
.copied textarea { width: 100%; margin-top: 4px; padding: 6px; border: 1px solid var(--qk-line); border-radius: 4px; background: var(--qk-surface); color: var(--qk-fg); font: 11px/1.4 var(--qk-mono); resize: vertical; }
.touch-hint { display: none; }
@media (max-width: 639px) {
  .knobs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .keys, .foot .key-hints { display: none; }
  .touch-hint { display: inline; }
  /* Floating over a phone screen: a short figure and compact knobs, so the page stays visible. */
  :host([floating]) { right: 8px; bottom: 8px; width: calc(100vw - 16px); }
  :host([floating]) .stage { height: min(var(--qk-figure-height), 22vh); }
  :host([floating]) .knob { flex-direction: row; justify-content: flex-start; gap: 8px; padding: 8px 10px; }
  :host([floating]) .knob svg { width: 32px; height: 32px; }
  :host([floating]) .knob .text { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
  :host([floating]) .knob .value { font-size: 16px; }
}
`

let panels = 0

class QuadknobPanel extends HTMLElement {
  static observedAttributes = ['params', 'values', 'css', 'target', 'figure', 'label']

  #params = []
  #values = {}
  #before = {}
  #peek = false
  #pickups = []
  #hardware = []
  #figure = undefined
  #frame = undefined
  #loaded = false
  #style = undefined
  #applied = []
  #id = ++panels

  constructor() {
    super()
    this.attachShadow({ mode: 'open' }).innerHTML = `<style>${STYLE}</style>
      <div class="panel" part="panel" tabindex="-1" role="group">
        <div class="head" part="head" hidden><span class="title"></span></div>
        <div class="stage" part="stage" hidden></div>
        <div class="knobs" part="knobs"></div>
        <div class="foot" part="foot">
          <span class="hints">
            <span class="touch-hint">Drag a knob up or down.</span>
            <span class="key-hints"><kbd>y</kbd><kbd>h</kbd> … <kbd>o</kbd><kbd>l</kbd> turn, hold <kbd>Space</kbd> for before<span class="alt-hint">, <kbd>⌥</kbd> between tokens</span></span>
          </span>
          <button type="button" class="midi"></button>
          <button type="button" class="done" part="done">Done</button>
        </div>
      </div>`
    const root = this.shadowRoot
    this.$ = (selector) => root.querySelector(selector)
    const panel = this.$('.panel')
    panel.addEventListener('keydown', (event) => this.#keydown(event))
    panel.addEventListener('keyup', (event) => { if (event.key === ' ') this.#setPeek(false) })
    panel.addEventListener('focusout', (event) => { if (!panel.contains(event.relatedTarget)) this.#setPeek(false) })
    panel.addEventListener('pointerdown', () => midi.claim(this), true)
    panel.addEventListener('focusin', () => midi.claim(this))
    panel.addEventListener('click', () => {
      // Safari doesn't focus clicked buttons. A click anywhere still gives this panel the lane keys.
      if (!panel.contains(root.activeElement)) panel.focus({ preventScroll: true })
    })
    this.$('.done').addEventListener('click', () => this.done())
    this.$('.midi').addEventListener('click', () => {
      midi.claim(this)
      if (midi.status === 'off') midi.connect()
    })
  }

  connectedCallback() {
    midi.panels.add(this)
    if (!midi.owner) midi.owner = this
    midi.connectIfGranted()
    if (!this.#params.length && this.hasAttribute('params')) this.#readParams()
    this.#readFigure()
    this.#render()
  }

  disconnectedCallback() {
    midi.panels.delete(this)
    if (midi.owner === this) { midi.owner = midi.panels.values().next().value; midi.emit() }
    this.#style?.remove()
    this.#style = undefined
    this.#clearTarget()
    touchRing.hide()
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return
    if (name === 'params') this.#readParams()
    else if (name === 'values') this.values = JSON.parse(this.getAttribute('values') || '{}')
    else if (name === 'figure') this.#readFigure()
    this.#render()
  }

  /** Up to four params, in lane order: blue, green, white, orange. */
  get params() { return this.#params }
  set params(list) {
    if (list.length > 4) throw new Error('quadknob: four knobs, no more')
    this.#params = list.map(normalize)
    const initial = this.hasAttribute('values') ? JSON.parse(this.getAttribute('values') || '{}') : {}
    this.#values = Object.fromEntries(this.#params.map((param) => [param.name, param.name in initial ? coerce(param, initial[param.name]) : defaultValue(param)]))
    this.#before = { ...this.#values }
    this.#pickups = []
    this.#hardware = []
    this.#loaded = false
    this.#figure = undefined
    if (this.isConnected) { this.#readFigure(); this.#render() }
  }

  get values() { return { ...this.#values } }
  set values(values) {
    for (const param of this.#params) if (param.name in values) this.#values[param.name] = coerce(param, values[param.name])
    this.#update()
  }

  /** What Done copies: the label, then each knob's value as the code writes it. */
  get summary() {
    const list = this.#params.map((param) => `${param.label} ${tokenValue(param, this.#values[param.name])}`).join(', ')
    const label = this.getAttribute('label')
    return label ? `${label}: ${list}` : list
  }

  async done() {
    const summary = this.summary
    this.dispatchEvent(new CustomEvent('quadknob-done', { detail: { values: this.values, summary }, bubbles: true, composed: true }))
    const foot = this.$('.foot')
    foot.querySelector('.copied')?.remove()
    const note = document.createElement('span')
    note.className = 'copied'
    try {
      await navigator.clipboard.writeText(summary)
      note.textContent = 'Copied. Paste it to your agent.'
    } catch {
      // No clipboard (an insecure page, or no permission): show it to copy by hand.
      note.innerHTML = 'Copy this to your agent:<textarea rows="2" readonly></textarea>'
      note.querySelector('textarea').value = summary
      setTimeout(() => note.querySelector('textarea').select())
    }
    foot.append(note)
    this.$('.done').textContent = 'Copied'
    setTimeout(() => { this.$('.done').textContent = 'Done' }, 1500)
  }

  #readParams() {
    try {
      this.params = JSON.parse(this.getAttribute('params') || '[]')
    } catch (error) {
      console.error('quadknob: params must be JSON', error)
    }
  }

  #readFigure() {
    const template = this.querySelector('template')
    const name = this.getAttribute('figure')
    const figure = template ? template.innerHTML : name && name !== 'none' ? FIGURES[name] : undefined
    if (name && name !== 'none' && !template && !figure) console.error(`quadknob: no figure "${name}" (${Object.keys(FIGURES).join(', ')})`)
    if (figure === this.#figure) return
    this.#figure = figure
    const stage = this.$('.stage')
    stage.hidden = !figure
    stage.replaceChildren()
    this.#frame = undefined
    this.#loaded = false
    if (!figure) return
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('title', this.getAttribute('label') || 'Figure')
    const initial = JSON.stringify(this.#figureState()).replace(/</g, '\\u003c')
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>${FIGURE_BASE}</style>`
      + `<script>(${prelude})(${initial})<\/script>${figure}`
    frame.addEventListener('load', () => { this.#loaded = true; this.#update() })
    stage.append(frame)
    this.#frame = frame
  }

  #figureState() {
    const style = getComputedStyle(this)
    const read = (name) => style.getPropertyValue(`--qk-${name}`).trim()
    return {
      values: this.#shown(),
      before: this.#before,
      params: this.#params.map((param, index) => ({ ...param, lane: LANES[index] })),
      colors: { fg: read('fg'), bg: read('bg'), dim: read('dim'), line: read('line'), blue: read('blue'), green: read('green'), white: read('white'), orange: read('orange') },
      fonts: { mono: read('mono'), sans: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    }
  }

  #shown() { return this.#peek ? this.#before : this.#values }

  #render() {
    const label = this.getAttribute('label')
    this.$('.head').hidden = !label
    this.$('.title').textContent = label ?? ''
    this.$('.alt-hint').hidden = !this.#params.some((param) => param.stops)
    const knobs = this.$('.knobs')
    knobs.replaceChildren(...LANES.map((lane, index) => this.#knob(lane, index)))
    this.renderMidi()
    this.#update()
  }

  #knob(lane, index) {
    const param = this.#params[index]
    const el = document.createElement('div')
    el.className = `knob ${lane}${param ? '' : ' empty'}`
    el.dataset.lane = lane
    if (!param) {
      el.setAttribute('aria-hidden', 'true')
      el.innerHTML = `<svg viewBox="0 0 40 40">${svg('circle', { cx: 20, cy: 20, r: 14, fill: 'none', stroke: 'currentColor', 'stroke-dasharray': '2 3' })}</svg><span class="text"><span class="label">&nbsp;</span><span class="value">—</span></span>`
      return el
    }
    el.setAttribute('role', 'slider')
    el.tabIndex = 0
    el.setAttribute('aria-label', param.label)
    if (param.type === 'number') {
      el.setAttribute('aria-valuemin', param.min)
      el.setAttribute('aria-valuemax', param.max)
    }
    el.innerHTML = `<span class="dial"></span><span class="text"><span class="label"></span><span class="value"></span></span>
      <span class="keys"><kbd>${KEYS[index][0]}</kbd><kbd>${KEYS[index][1]}</kbd></span>`

    el.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      this.#turn(index, (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1), event.altKey)
    })
    let wheel = 0
    el.addEventListener('wheel', (event) => {
      event.preventDefault()
      // Line-mode wheels (most mice) report lines, not pixels: one line is one detent. Reversing starts afresh.
      const delta = -(event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * WHEEL_STEP : event.deltaY)
      if (Math.sign(delta) !== Math.sign(wheel)) wheel = 0
      wheel += delta
      const detents = Math.trunc(wheel / WHEEL_STEP)
      if (!detents) return
      wheel -= detents * WHEEL_STEP
      this.#turn(index, detents * (event.shiftKey ? 10 : 1), event.altKey)
    }, { passive: false })
    let drag
    const ring = (event) => {
      if (!drag?.touch) return
      const value = this.#shown()[param.name]
      touchRing.show(event.clientX, event.clientY, getComputedStyle(el).color, param.label, formatValue(param, value), position(param, value))
    }
    el.addEventListener('pointerdown', (event) => {
      el.setPointerCapture(event.pointerId)
      const touch = event.pointerType !== 'mouse'
      drag = { y: event.clientY, detents: 0, step: touch ? TOUCH_STEP : DRAG_STEP, touch, x: event.clientX }
      holdSelection(true)
      ring(event)
    })
    el.addEventListener('pointermove', (event) => {
      if (!drag) return
      const detents = Math.trunc((drag.y - event.clientY) / drag.step)
      if (detents !== drag.detents) {
        this.#turn(index, (detents - drag.detents) * (event.shiftKey ? 10 : 1), event.altKey)
        drag.detents = detents
      }
      ring(event)
    })
    el.addEventListener('lostpointercapture', () => {
      drag = undefined
      touchRing.hide()
      holdSelection(false)
    })
    return el
  }

  /** Redraw the knobs and figure, and apply the values to the page. */
  #update() {
    const shown = this.#shown()
    this.$('.knobs').querySelectorAll('.knob').forEach((el, index) => {
      const param = this.#params[index]
      if (!param) return
      const value = shown[param.name]
      const text = formatValue(param, value)
      const raw = stopAt(param, value) && `${value}${param.unit ?? ''}`
      el.querySelector('.dial').innerHTML = dial(position(param, value), this.#hardware[index])
      el.querySelector('.label').innerHTML = `${escape(param.label)}${raw ? `<span class="raw"> · ${escape(raw)}</span>` : ''}`
      const valueEl = el.querySelector('.value')
      valueEl.textContent = text
      valueEl.classList.toggle('long', text.length > 5)
      el.setAttribute('aria-valuetext', raw ? `${text}, ${raw}` : text)
      if (param.type === 'number') el.setAttribute('aria-valuenow', value)
    })
    let before = this.$('.before')
    if (this.#peek && !before) {
      before = Object.assign(document.createElement('span'), { className: 'before', textContent: 'Before' })
      ;(this.#figure ? this.$('.stage') : this.$('.panel')).append(before)
    } else if (!this.#peek) before?.remove()

    if (this.#frame && this.#loaded) this.#frame.contentWindow.postMessage({ type: 'state', state: this.#figureState() }, '*')
    this.#apply(shown)
  }

  /**
   * Apply values to the page: through the `css` template, with `{name}` replaced by each raw value, or else as custom
   * properties, `--name: value` with its unit, on the `target` elements (the page's root by default).
   */
  #apply(values) {
    const css = this.getAttribute('css')
    if (css) {
      this.#style ??= document.head.appendChild(document.createElement('style'))
      this.#style.dataset.quadknob = this.getAttribute('label') || String(this.#id)
      this.#style.textContent = this.#params.reduce((text, param) => text.replaceAll(`{${param.name}}`, String(values[param.name])), css)
    }
    if (!css || this.hasAttribute('target')) {
      this.#clearTarget()
      const selector = this.getAttribute('target')
      this.#applied = selector ? [...document.querySelectorAll(selector)] : [document.documentElement]
      for (const el of this.#applied) {
        for (const param of this.#params) {
          const value = values[param.name]
          el.style.setProperty(`--${param.name}`, param.type === 'number' ? `${value}${param.unit ?? ''}` : String(value))
        }
      }
    }
    this.dispatchEvent(new CustomEvent('quadknob-change', { detail: { values: { ...values } }, bubbles: true, composed: true }))
  }

  #clearTarget() {
    for (const el of this.#applied) for (const param of this.#params) el.style.removeProperty(`--${param.name}`)
    this.#applied = []
  }

  #turn(lane, detents, free = false) {
    const param = this.#params[lane]
    if (!param) return
    this.#release(lane)
    const next = turn(param, this.#values[param.name], detents, free)
    if (next === this.#values[param.name]) return
    clickAfterRender()
    this.#values[param.name] = next
    if (this.#peek) this.#peek = false
    this.#update()
  }

  #release(lane) { this.#pickups[lane] = { picked: false, mine: new Set() } }

  midiControl(lane, at) {
    const param = this.#params[lane]
    if (!param || this.#peek) return
    const pickup = this.#pickups[lane] ??= { picked: false, mine: new Set() }
    if (pickup.picked && !pickup.mine.has(this.#values[param.name])) Object.assign(pickup, { picked: false, mine: new Set() })
    if (!pickup.picked && !picksUp(position(param, this.#values[param.name]), at, pickup.last)) {
      pickup.last = at
      this.#hardware[lane] = at
      return this.#update()
    }
    const next = fromPosition(param, at)
    Object.assign(pickup, { picked: true, last: at })
    pickup.mine.add(next)
    this.#hardware[lane] = undefined
    if (next !== this.#values[param.name]) clickAfterRender()
    this.#values[param.name] = next
    this.#update()
  }

  renderMidi() {
    const button = this.$('.midi')
    button.className = `midi ${midi.status}`
    button.disabled = midi.status === 'unsupported' || midi.status === 'denied'
    button.title = 'Knobs on MIDI CC 1–4, any channel, like an AKAI LPD8’s top row'
    const inputs = midi.access ? midi.access.inputs.size : 0
    button.textContent = {
      off: 'Connect MIDI',
      unsupported: 'No MIDI here',
      denied: 'MIDI not allowed',
      on: inputs === 0 ? 'MIDI: plug in' : midi.owner === this ? 'MIDI: here' : 'MIDI: use here',
    }[midi.status]
  }

  #setPeek(on) {
    if (this.#peek === on) return
    this.#peek = on
    this.#update()
  }

  #keydown(event) {
    if (event.ctrlKey || event.metaKey || event.isComposing) return
    if (event.target instanceof HTMLTextAreaElement) return
    if (event.key === 'Escape') {
      this.shadowRoot.activeElement?.blur()
      return
    }
    if (event.altKey) {
      // Alt changes what a letter types on a Mac, so read the key's position instead.
      const letter = /^Key([A-Z])$/.exec(event.code)?.[1]
      const free = letter && laneTurn(event.shiftKey ? letter : letter.toLowerCase())
      if (free) { event.preventDefault(); this.#turn(free.lane, free.detents, true) }
      return
    }
    const target = laneTurn(event.key)
    const onButton = event.composedPath()[0] instanceof HTMLButtonElement
    if (target) { event.preventDefault(); this.#turn(target.lane, target.detents) }
    else if (event.key === ' ' && !onButton) { event.preventDefault(); this.#setPeek(true) }
    else if (event.key === 'Enter' && !onButton) { event.preventDefault(); this.done() }
  }
}

if (!customElements.get('quadknob-panel')) customElements.define('quadknob-panel', QuadknobPanel)

export { QuadknobPanel, SCALES }
