// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Lampwright game view (expanded post): place mirrors, watch the beam, lock in.
// Plays the daily puzzle, an archive day, or (v0.5) a community board.
// v0.6: how-to-play card, countdown on the result card, arrow keys. v0.7: Devvit Journeys and a Join button.
// v0.9: accessibility pass. The result card keeps focus inside it, Escape closes it like
// "Keep exploring", and focus goes back to the square the player last tapped.
import type {DayStats, MyDay, SubmitRsp, TodayRsp} from '../shared/api.ts'
import {JourneyRules} from '../shared/journey.ts'
import type {Mirror, Placement, Puzzle, TraceResult} from '../shared/puzzle.ts'
import {
  crystals,
  dx,
  dy,
  emitterIndex,
  solutionKey,
  trace,
} from '../shared/puzzle.ts'
import {BOARD_LABEL, shareText, yesterdayLine} from '../shared/share.ts'
import {askToPostAsUser} from './consent.ts'
import {
  fetchJoin,
  fetchReveal,
  fetchShare,
  fetchSubmit,
  fetchToday,
} from './fetch.ts'
import {
  arrowKeys,
  buzz,
  setupHelp,
  startCountdown,
  stopCountdown,
  syncInert,
  trapFocus,
} from './polish.ts'
import {sendAppReady, sendJourney} from './telemetry.ts'

const SVG = 'http://www.w3.org/2000/svg'
const ARROWS = ['▲', '▶', '▼', '◀'] // up right down left

/** Par routes of a past day, shown one at a time on archive posts. */
type RevealState = {
  routes: Placement[][]
  found: boolean[]
  exact: boolean
  k: number
}

type State = {
  today: TodayRsp
  board: boolean // a community board post
  puzzle: Puzzle
  placed: Map<number, Mirror>
  history: Map<number, Mirror>[]
  t: TraceResult
  busy: boolean
  reveal: RevealState | undefined
  lastCell: number | undefined // v0.9: where focus returns when the result card closes
}

const journey = new JourneyRules()
let joined = false

/** Journeys: report a change the player made to the board (never a revealed par route). */
function track(s: State): void {
  if (s.reveal) return
  sendJourney(journey.changed(new Set(s.t.lit).size, crystals(s.puzzle).length))
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw Error(`missing #${id}`)
  return e as T
}

function placements(placed: Map<number, Mirror>): Placement[] {
  return [...placed.entries()].map(([i, m]) => ({i, m}))
}

function prettyDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function mirrorsWord(n: number): string {
  return `${n} mirror${n === 1 ? '' : 's'}`
}

function setStatus(text: string): void {
  el('status').textContent = text
}

function cellLabel(
  p: Puzzle,
  i: number,
  placed: Map<number, Mirror>,
  lit: Set<number>,
): string {
  const pos = `row ${Math.floor(i / p.w) + 1}, column ${(i % p.w) + 1}`
  const c = p.rows[Math.floor(i / p.w)]?.[i % p.w] ?? '#'
  const m = placed.get(i)
  if (c === 'E') return `${pos}: light source`
  if (c === '#') return `${pos}: wall`
  if (c === '*') return `${pos}: crystal, ${lit.has(i) ? 'lit' : 'dark'}`
  if (c === '/' || c === '\\') return `${pos}: fixed mirror`
  if (m)
    return `${pos}: your mirror, ${m === '/' ? 'leaning right' : 'leaning left'}`
  return `${pos}: empty`
}

function buildBoard(s: State): void {
  const p = s.puzzle
  const board = el('board')
  board.style.setProperty('--w', String(p.w))
  board.style.setProperty('--h', String(p.h))
  board.setAttribute(
    'aria-label',
    `Puzzle board, ${p.w} columns by ${p.h} rows. Arrow keys move between squares.`,
  )
  board.replaceChildren()
  for (let i = 0; i < p.w * p.h; i++) {
    const c = p.rows[Math.floor(i / p.w)]?.[i % p.w] ?? '#'
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cell'
    b.dataset.cell = String(i)
    if (c === 'E') {
      b.classList.add('emitter')
      b.textContent = ARROWS[p.dir] ?? ''
    } else if (c === '#') b.classList.add('wall')
    else if (c === '*') b.classList.add('crystal')
    else if (c === '/' || c === '\\')
      b.classList.add('fixed', c === '/' ? 'm-s' : 'm-b')
    else b.addEventListener('click', () => tap(s, i))
    if (c !== '.') b.setAttribute('aria-disabled', 'true')
    board.append(b)
  }
  const svg = document.createElementNS(SVG, 'svg')
  svg.id = 'beam'
  svg.setAttribute('viewBox', `0 0 ${p.w} ${p.h}`)
  svg.setAttribute('aria-hidden', 'true')
  const glow = document.createElementNS(SVG, 'polyline')
  glow.classList.add('glow')
  const core = document.createElementNS(SVG, 'polyline')
  core.classList.add('core')
  svg.append(glow, core)
  board.append(svg)
}

function beamPoints(p: Puzzle, t: TraceResult): string {
  const e = emitterIndex(p)
  const pts: [number, number][] = [[(e % p.w) + 0.5, Math.floor(e / p.w) + 0.5]]
  for (const i of t.path) pts.push([(i % p.w) + 0.5, Math.floor(i / p.w) + 0.5])
  const last = pts[pts.length - 1]
  if (last && t.end !== 'loop')
    pts.push([last[0] + dx(t.lastDir) * 0.5, last[1] + dy(t.lastDir) * 0.5])
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
}

/** Status line while a revealed par route is on the board, or '' when the board differs from it. */
function revealStatus(s: State): string {
  const r = s.reveal
  const route = r?.routes[r.k]
  if (
    !r ||
    !route ||
    !s.t.solved ||
    solutionKey(route) !== solutionKey(s.t.used)
  )
    return ''
  const n = r.routes.length
  const of = r.exact ? String(n) : `${n}+`
  const who = r.found[r.k]
    ? 'Players found this one.'
    : 'Nobody found this one.'
  return `Par route ${r.k + 1} of ${of}. ${who}`
}

function render(s: State): void {
  const p = s.puzzle
  s.t = trace(p, placements(s.placed))
  const lit = new Set(s.t.lit)
  const onPath = new Set(s.t.path)
  const all = crystals(p)
  for (const b of Array.from(
    el('board').querySelectorAll<HTMLButtonElement>('.cell'),
  )) {
    const i = Number(b.dataset.cell)
    const m = s.placed.get(i)
    const c = p.rows[Math.floor(i / p.w)]?.[i % p.w] ?? '#'
    const shown = m ?? (c === '/' || c === '\\' ? c : undefined)
    b.classList.toggle('placed', m !== undefined)
    b.classList.toggle('m-s', shown === '/')
    b.classList.toggle('m-b', shown === '\\')
    b.classList.toggle('lit', lit.has(i))
    b.classList.toggle('on-path', onPath.has(i))
    b.setAttribute('aria-label', cellLabel(p, i, s.placed, lit))
  }
  const pts = beamPoints(p, s.t)
  for (const line of Array.from(el('board').querySelectorAll('polyline')))
    line.setAttribute('points', pts)
  el('mirrors').textContent = `${s.placed.size}/${p.budget}`
  el('lit').textContent = `${lit.size}/${all.length}`
  el<HTMLButtonElement>('undo').disabled = s.history.length === 0 || s.busy
  el<HTMLButtonElement>('reset').disabled = s.placed.size === 0 || s.busy
  const lock = el<HTMLButtonElement>('lock')
  // once the answers are out, a lock-in would mean nothing
  lock.hidden = !s.t.solved || s.reveal !== undefined
  lock.disabled = s.busy
  el('app').classList.toggle('solved', s.t.solved)
  const revealed = revealStatus(s)
  if (revealed) {
    setStatus(revealed)
  } else if (s.t.solved) {
    const n = s.t.used.length
    const mine = s.today.me.routes.includes(solutionKey(s.t.used))
    setStatus(
      mine
        ? `Every crystal glows with ${mirrorsWord(n)}. You already found this route.`
        : s.reveal
          ? `Every crystal glows with ${mirrorsWord(n)}.`
          : `Every crystal glows with ${mirrorsWord(n)}. Lock it in!`,
    )
  } else if (s.placed.size === 0) {
    setStatus('Tap a square to place a mirror. Tap it again to flip it.')
  } else {
    const left = all.length - lit.size
    setStatus(`${left} crystal${left === 1 ? '' : 's'} still dark.`)
  }
}

function tap(s: State, i: number): void {
  if (s.busy || !el('result').hidden) return
  s.lastCell = i
  const cur = s.placed.get(i)
  if (cur === undefined && s.placed.size >= s.puzzle.budget) {
    const b = el('board').querySelector<HTMLElement>(`[data-cell="${i}"]`)
    b?.classList.remove('nope')
    b?.getBoundingClientRect() // restart the shake animation
    b?.classList.add('nope')
    setStatus(
      `You only have ${s.puzzle.budget} mirrors. Tap one of yours to flip or remove it.`,
    )
    return
  }
  s.history.push(new Map(s.placed))
  if (cur === undefined) s.placed.set(i, '/')
  else if (cur === '/') s.placed.set(i, '\\')
  else s.placed.delete(i)
  render(s)
  track(s)
  hideHint()
}

function hideHint(): void {
  el('hint').hidden = true
  try {
    localStorage.setItem('lampwright:hinted', '1')
  } catch {
    // storage may be unavailable inside the post frame
  }
}

function showHintOnce(): void {
  let seen = false
  try {
    seen = localStorage.getItem('lampwright:hinted') === '1'
  } catch {
    seen = false
  }
  el('hint').hidden = seen
}

function routesLine(stats: DayStats, board: boolean): string {
  const total = stats.parRoutesExact
    ? String(stats.parRoutes)
    : `${stats.parRoutes}+`
  return `Par routes found by everyone${board ? '' : ' today'}: ${stats.parFound} of ${total}`
}

function renderDots(stats: DayStats): void {
  const box = el('r-dots')
  box.replaceChildren()
  const n = Math.min(stats.parRoutes, 24)
  for (let k = 0; k < n; k++) {
    const d = document.createElement('span')
    const found = k < stats.parFound
    d.className = found ? 'dot found' : 'dot'
    const who = stats.firstFinders[k]
    d.title = !found
      ? 'not found yet'
      : who
        ? `first found by u/${who}`
        : 'found'
    box.append(d)
  }
}

function streakLine(me: MyDay, board: boolean): string {
  if (board || !me.loggedIn) return ''
  if (me.streak <= 0) return ''
  return `Daily streak: ${me.streak} day${me.streak === 1 ? '' : 's'}`
}

function sharePreview(s: State): string {
  const t = s.today
  return shareText({
    number: t.number,
    label: s.board ? BOARD_LABEL : undefined,
    par: s.puzzle.par,
    best: t.me.best,
    routes: t.me.routes,
    parRoutes: t.stats.parRoutes,
    parRoutesExact: t.stats.parRoutesExact,
    streak: s.board ? 0 : t.me.streak,
  })
}

/** Share is optional: it never gates play, and it only posts after the player confirms. */
function renderShare(s: State): void {
  const me = s.today.me
  const can = me.loggedIn && me.solved && me.best > 0
  el('r-share').hidden = !can || me.shared
  el('r-shared').hidden = !me.shared
  if (me.shared && el('r-shared').textContent === '')
    el('r-shared').textContent = 'You shared this puzzle.'
  el('share').hidden = true
}

function openShare(s: State): void {
  el('s-preview').textContent = sharePreview(s).replaceAll('\n\n', '\n')
  el('s-note').textContent = [
    `This posts a comment from your account, u/${s.today.me.username},`,
    'as a reply to the pinned Lampwright comment on this post.',
    'Everyone can see it and your username. It shows counts only, never your mirrors.',
  ].join(' ')
  el('s-error').textContent = ''
  el('share').hidden = false
  el('r-share').hidden = true
  el<HTMLButtonElement>('s-post').focus()
}

/** v0.9: Cancel puts focus back on the Share button it replaced (when it can still be used). */
function cancelShare(s: State): void {
  renderShare(s)
  const btn = el<HTMLButtonElement>('r-share')
  if (!btn.hidden) btn.focus()
  else el<HTMLButtonElement>('r-again').focus()
}

async function postShare(s: State, ev: MouseEvent): Promise<void> {
  if (s.busy) return
  s.busy = true
  el<HTMLButtonElement>('s-post').disabled = true
  // Reddit's own permission prompt for commenting from the player's account
  const allowed = await askToPostAsUser(ev)
  const res = allowed ? await fetchShare({day: s.today.day}) : undefined
  s.busy = false
  el<HTMLButtonElement>('s-post').disabled = false
  if (!res) {
    el('s-error').textContent =
      'Nothing was posted: Reddit did not give permission to comment from your account.'
    return
  }
  if (!res.ok) {
    if (res.status === 409) s.today.me.shared = true
    el('s-error').textContent =
      res.status === 409
        ? 'You already shared this puzzle.'
        : `Could not post the comment: ${res.error}`
    if (res.status === 409) renderShare(s)
    return
  }
  s.today.me.shared = true
  renderShare(s)
  el('r-shared').textContent =
    `Shared as a reply from u/${s.today.me.username}.`
  el<HTMLButtonElement>('r-again').focus() // the Post button just disappeared under the keyboard focus
  sendJourney(journey.interaction('share'))
}

function showResult(s: State, r: SubmitRsp): void {
  const par = s.puzzle.par
  el('r-head').textContent =
    r.mirrors <= par
      ? `Par! ${mirrorsWord(r.mirrors)}`
      : `Solved with ${mirrorsWord(r.mirrors)}`
  let line: string
  if (r.mirrors > par)
    line = `Par is ${par}. There is a route with fewer mirrors.`
  else if (r.firstFinder)
    line = s.board
      ? 'You are the first to find this route.'
      : 'You are the first to find this route today.'
  else if (!r.newForMe)
    line = 'You already found this route. Try for a different one.'
  else
    line = `${Math.max(1, Math.round(r.routeShare * 100))}% of ${s.board ? "this board's" : "today's"} solvers found this exact route.`
  el('r-line').textContent = line
  el('r-routes').textContent = routesLine(r.stats, s.board)
  renderDots(r.stats)
  const atPar =
    r.stats.solvers > 0
      ? Math.round((r.stats.atPar / r.stats.solvers) * 100)
      : 0
  el('r-crowd').textContent =
    `${r.stats.solvers} solver${r.stats.solvers === 1 ? '' : 's'} so far, ${atPar}% at par.`
  el('r-streak').textContent = streakLine(r.me, s.board)
  const y = yesterdayLine(s.today.yesterday)
  el('r-yesterday').textContent = y
  el('r-yesterday').hidden = y === ''
  if (!s.board && s.today.isToday) startCountdown(el('r-next'))
  else el('r-next').hidden = true
  el('r-join-row').hidden = joined || !s.today.me.loggedIn
  renderShare(s)
  el('result').hidden = false
  syncInert()
  el<HTMLButtonElement>('r-again').focus()
}

/** "Keep exploring" (or Escape): close the result card and give focus back to the board. */
function closeResult(s: State): void {
  sendJourney(journey.interaction('play_again'))
  stopCountdown()
  el('result').hidden = true
  syncInert()
  render(s)
  const cell =
    s.lastCell === undefined
      ? null
      : el('board').querySelector<HTMLElement>(`[data-cell="${s.lastCell}"]`)
  if (cell) cell.focus()
  else el<HTMLButtonElement>('undo').focus()
}

/** Join button: subscribes from the player's own account, only on this tap. */
async function join(): Promise<void> {
  const btn = el<HTMLButtonElement>('r-join')
  btn.disabled = true
  const res = await fetchJoin()
  btn.disabled = false
  const note = el('r-joined')
  note.hidden = false
  if (!res.ok) {
    note.textContent =
      res.status === 401
        ? 'Log in to Reddit to join.'
        : 'Could not join right now.'
    return
  }
  joined = true
  el('r-join-row').hidden = true
  note.textContent = 'You joined. New puzzles will show up in your feed.'
  el<HTMLButtonElement>('r-again').focus() // the Join button just disappeared under the keyboard focus
  sendJourney(journey.interaction('join'))
}

async function lockIn(s: State): Promise<void> {
  if (!s.t.solved || s.busy || s.reveal) return
  s.busy = true
  render(s)
  const res = await fetchSubmit({
    day: s.today.day,
    placed: placements(s.placed),
  })
  s.busy = false
  if (!res.ok) {
    render(s)
    setStatus(
      res.status === 401
        ? 'Log in to Reddit to save your result.'
        : `Could not save: ${res.error}`,
    )
    return
  }
  s.today.me = res.value.me
  s.today.stats = res.value.stats
  render(s)
  renderHeader(s)
  buzz()
  showResult(s, res.value)
  sendJourney(journey.lockedIn(res.value.mirrors, s.puzzle.par))
}

/** Archive posts only: put the day's par routes on the board, one per tap. */
async function showReveal(s: State): Promise<void> {
  if (s.busy || s.board) return
  if (!s.reveal) {
    s.busy = true
    const res = await fetchReveal(s.today.day)
    s.busy = false
    if (!res.ok) {
      render(s)
      setStatus(
        res.status === 403
          ? 'Par routes open the day after.'
          : `Could not load the par routes: ${res.error}`,
      )
      return
    }
    if (res.value.routes.length === 0) {
      setStatus('No par routes are stored for this day.')
      return
    }
    s.reveal = {
      routes: res.value.routes,
      found: res.value.found,
      exact: res.value.exact,
      k: -1,
    }
  }
  const r = s.reveal
  r.k = (r.k + 1) % r.routes.length
  s.history.push(new Map(s.placed))
  s.placed = new Map<number, Mirror>(
    (r.routes[r.k] ?? []).map((pl): [number, Mirror] => [pl.i, pl.m]),
  )
  el('reveal').textContent =
    r.routes.length > 1 ? 'Next par route' : 'Par route shown'
  hideHint()
  render(s)
}

function renderHeader(s: State): void {
  const t = s.today
  if (s.board) {
    el('title').textContent = 'Community board'
    el('day').textContent = 'Built by a player here'
  } else {
    el('title').textContent = `Lampwright #${t.number}`
    el('day').textContent = t.isToday
      ? prettyDay(t.day)
      : `${prettyDay(t.day)} (archive)`
  }
  el('par').textContent = String(t.puzzle.par)
  const streak = streakLine(t.me, s.board)
  el('streak').textContent = streak
  el('streak').hidden = streak === ''
  el('reveal').hidden = t.isToday || s.board
}

async function init(): Promise<void> {
  const res = await fetchToday()
  if (!res.ok) {
    el('loading').textContent =
      res.status === 404
        ? 'This board is no longer available.'
        : 'Lampwright could not load today’s puzzle. Please try again in a moment.'
    return
  }
  const today = res.value
  const puzzle: Puzzle = {...today.puzzle}
  const s: State = {
    today,
    board: today.kind === 'board',
    puzzle,
    placed: new Map(),
    history: [],
    t: trace(puzzle, []),
    busy: false,
    reveal: undefined,
    lastCell: undefined,
  }
  el('loading').hidden = true
  el('app').hidden = false
  renderHeader(s)
  buildBoard(s)
  arrowKeys(el('board'), puzzle.w, puzzle.h)
  render(s)
  showHintOnce()
  setupHelp()
  trapFocus(el('result'))
  el('undo').addEventListener('click', () => {
    const prev = s.history.pop()
    if (prev) s.placed = prev
    render(s)
    track(s)
  })
  el('reset').addEventListener('click', () => {
    if (s.placed.size === 0) return
    s.history.push(new Map(s.placed))
    s.placed.clear()
    render(s)
    track(s)
  })
  el('lock').addEventListener('click', () => void lockIn(s))
  el('reveal').addEventListener('click', () => void showReveal(s))
  el('r-share').addEventListener('click', () => openShare(s))
  el('s-post').addEventListener('click', ev => void postShare(s, ev))
  el('s-cancel').addEventListener('click', () => cancelShare(s))
  el('r-join').addEventListener('click', () => void join())
  el('r-again').addEventListener('click', () => closeResult(s))
  document.addEventListener('keydown', ev => {
    // the help card uses up its own Escape (defaultPrevented); never close mid-post
    if (
      ev.key !== 'Escape' ||
      ev.defaultPrevented ||
      el('result').hidden ||
      s.busy
    )
      return
    ev.preventDefault()
    closeResult(s)
  })
  document.body.dataset.ready = '1'
  sendAppReady()
}

void init()
