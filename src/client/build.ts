// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Lampwright board builder (expanded post, v0.5). Paint a board from map symbols,
// let the solver check it and set par, then, only if the player chooses, post it to
// the subreddit from their own account. Also lists the newest community boards.
// v0.9b accessibility: the board and the palette are one Tab stop each (arrow keys move
// inside them), the board says its size, and focus moves to "Open the post" after posting.
import type {BoardSummary, MyDay} from '../shared/api.ts'
import {
  BOARD_H,
  BOARD_MAX_CRYSTALS,
  BOARD_W,
  checkBoard,
  lampDir,
} from '../shared/board.ts'
import type {Puzzle} from '../shared/puzzle.ts'
import {dx, dy, trace} from '../shared/puzzle.ts'
import {askToPostAsUser, openOnReddit} from './consent.ts'
import {fetchBoardPost, fetchBoards, fetchToday} from './fetch.ts'
import {arrowKeys, rove} from './polish.ts'

type Tool = 'E' | '*' | '#' | '/' | '\\' | '.'

const TOOLS: {tool: Tool; label: string; icon: string}[] = [
  {tool: '*', label: 'Crystal', icon: '◆'},
  {tool: '#', label: 'Wall', icon: '▦'},
  {tool: '/', label: 'Mirror', icon: '╱'},
  {tool: '\\', label: 'Mirror', icon: '╲'},
  {tool: 'E', label: 'Lamp', icon: '☀'},
  {tool: '.', label: 'Erase', icon: '✕'},
]

const SVG = 'http://www.w3.org/2000/svg'
const ARROWS = ['▲', '▶', '▼', '◀'] // up right down left
/** The lamp a new board starts with: left edge of row 5, shining right. */
const START_LAMP = 4 * BOARD_W

type State = {
  cells: string[]
  tool: Tool
  checkedFor: string // the board that last passed the check ('' if none)
  busy: boolean
  me: MyDay | undefined
  postedUrl: string
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw Error(`missing #${id}`)
  return e as T
}

function setStatus(text: string): void {
  el('status').textContent = text
}

function rowsOf(cells: readonly string[]): string[] {
  const rows: string[] = []
  for (let y = 0; y < BOARD_H; y++)
    rows.push(cells.slice(y * BOARD_W, (y + 1) * BOARD_W).join(''))
  return rows
}

function emptyBoard(): string[] {
  const cells = new Array<string>(BOARD_W * BOARD_H).fill('.')
  cells[START_LAMP] = 'E'
  return cells
}

/** The board as a puzzle, if its lamp is placed where a lamp may go. */
function draft(cells: readonly string[]): Puzzle | undefined {
  const e = cells.indexOf('E')
  const dir = lampDir(e)
  if (dir === -1 || cells.lastIndexOf('E') !== e) return undefined
  return {
    id: 'draft',
    w: BOARD_W,
    h: BOARD_H,
    rows: rowsOf(cells),
    dir,
    budget: 0,
    par: 0,
  }
}

function count(cells: readonly string[], ch: string): number {
  return cells.filter(c => c === ch).length
}

function cellName(c: string): string {
  if (c === 'E') return 'lamp'
  if (c === '*') return 'crystal'
  if (c === '#') return 'wall'
  if (c === '/' || c === '\\')
    return `fixed mirror, leaning ${c === '/' ? 'right' : 'left'}`
  return 'empty'
}

const TOOL_SEL = '.tool'
const TOOL_STEP: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowDown: 1,
}

/** The palette is a toolbar: one Tab stop, arrow keys (and Home/End) move between tools, Enter picks one. */
function paletteKeys(box: HTMLElement): void {
  box.addEventListener('focusin', ev => {
    const t = (ev.target as HTMLElement | null)?.closest<HTMLElement>(TOOL_SEL)
    if (t && t.tabIndex !== 0) rove(box, t, TOOL_SEL)
  })
  box.addEventListener('keydown', ev => {
    const list = Array.from(box.querySelectorAll<HTMLElement>(TOOL_SEL))
    const at = list.indexOf(ev.target as HTMLElement)
    if (at === -1) return
    let to: number
    const step = TOOL_STEP[ev.key]
    if (step !== undefined) to = (at + step + list.length) % list.length
    else if (ev.key === 'Home') to = 0
    else if (ev.key === 'End') to = list.length - 1
    else return
    ev.preventDefault()
    list[to]?.focus()
  })
}

function buildPalette(s: State): void {
  const box = el('palette')
  box.replaceChildren()
  for (const t of TOOLS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'tool'
    b.dataset.tool = t.tool
    const icon = document.createElement('span')
    icon.className = 'icon'
    icon.textContent = t.icon
    icon.setAttribute('aria-hidden', 'true')
    const label = document.createElement('span')
    label.className = 'label'
    label.textContent = t.label
    b.append(icon, label)
    b.setAttribute(
      'aria-label',
      t.tool === '/' || t.tool === '\\' ? cellName(t.tool) : t.label,
    )
    b.addEventListener('click', () => {
      s.tool = t.tool
      render(s)
    })
    box.append(b)
  }
  paletteKeys(box)
}

function buildGrid(s: State): void {
  const board = el('board')
  board.style.setProperty('--w', String(BOARD_W))
  board.style.setProperty('--h', String(BOARD_H))
  board.setAttribute(
    'aria-label',
    `Board you are building, ${BOARD_W} columns by ${BOARD_H} rows. Arrow keys move between squares; Enter paints the square.`,
  )
  board.replaceChildren()
  for (let i = 0; i < BOARD_W * BOARD_H; i++) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cell'
    b.dataset.bcell = String(i)
    b.addEventListener('click', () => paint(s, i))
    board.append(b)
  }
  const svg = document.createElementNS(SVG, 'svg')
  svg.id = 'beam'
  svg.setAttribute('viewBox', `0 0 ${BOARD_W} ${BOARD_H}`)
  svg.setAttribute('aria-hidden', 'true')
  const glow = document.createElementNS(SVG, 'polyline')
  glow.classList.add('glow')
  const core = document.createElementNS(SVG, 'polyline')
  core.classList.add('core')
  svg.append(glow, core)
  board.append(svg)
  arrowKeys(board, BOARD_W, BOARD_H, 'bcell')
}

function render(s: State): void {
  const p = draft(s.cells)
  const t = p ? trace(p, []) : undefined
  const lit = new Set(t?.lit ?? [])
  const onPath = new Set(t?.path ?? [])
  for (const b of Array.from(
    el('board').querySelectorAll<HTMLButtonElement>('.cell'),
  )) {
    const i = Number(b.dataset.bcell)
    const c = s.cells[i] ?? '.'
    b.classList.toggle('emitter', c === 'E')
    b.classList.toggle('wall', c === '#')
    b.classList.toggle('crystal', c === '*')
    b.classList.toggle('fixed', c === '/' || c === '\\')
    b.classList.toggle('m-s', c === '/')
    b.classList.toggle('m-b', c === '\\')
    b.classList.toggle('lit', lit.has(i))
    b.classList.toggle('on-path', onPath.has(i))
    const d = c === 'E' ? lampDir(i) : -1
    b.textContent = d === -1 ? '' : (ARROWS[d] ?? '')
    const litNote = c === '*' ? (lit.has(i) ? ', lit' : ', dark') : ''
    b.setAttribute(
      'aria-label',
      `row ${Math.floor(i / BOARD_W) + 1}, column ${(i % BOARD_W) + 1}: ${cellName(c)}${litNote}`,
    )
  }
  let pts = ''
  if (p && t) {
    const e = s.cells.indexOf('E')
    const list: [number, number][] = [
      [(e % BOARD_W) + 0.5, Math.floor(e / BOARD_W) + 0.5],
    ]
    for (const i of t.path)
      list.push([(i % BOARD_W) + 0.5, Math.floor(i / BOARD_W) + 0.5])
    const last = list[list.length - 1]
    if (last && t.end !== 'loop')
      list.push([last[0] + dx(t.lastDir) * 0.5, last[1] + dy(t.lastDir) * 0.5])
    pts = list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  }
  for (const line of Array.from(el('board').querySelectorAll('polyline')))
    line.setAttribute('points', pts)
  const palette = el('palette')
  const keepStop = palette.contains(document.activeElement)
  for (const b of Array.from(
    palette.querySelectorAll<HTMLButtonElement>(TOOL_SEL),
  )) {
    const pressed = b.dataset.tool === s.tool
    b.setAttribute('aria-pressed', String(pressed))
    // the palette's Tab stop is the chosen tool, unless the player is moving through the palette right now
    if (!keepStop) b.tabIndex = pressed ? 0 : -1
  }
  const fixed = count(s.cells, '/') + count(s.cells, '\\')
  el('counts').textContent =
    `Crystals ${count(s.cells, '*')}/${BOARD_MAX_CRYSTALS} · Walls ${count(s.cells, '#')} · Fixed mirrors ${fixed}`
  const ready = s.checkedFor !== '' && s.checkedFor === s.cells.join('')
  el('post').hidden = !ready || s.postedUrl !== ''
  el('b-post').hidden = !s.me?.loggedIn
  el<HTMLButtonElement>('b-check').disabled = s.busy || s.postedUrl !== ''
  el<HTMLButtonElement>('b-clear').disabled = s.busy || s.postedUrl !== ''
}

function paint(s: State, i: number): void {
  if (s.busy || s.postedUrl !== '') return
  const before = s.cells.join('')
  if (s.tool === 'E') {
    if (lampDir(i) === -1) {
      setStatus(
        'The lamp goes on an edge square, not a corner. It shines into the board.',
      )
      return
    }
    for (let k = 0; k < s.cells.length; k++)
      if (s.cells[k] === 'E') s.cells[k] = '.'
    s.cells[i] = 'E'
  } else {
    s.cells[i] = s.cells[i] === s.tool ? '.' : s.tool
  }
  if (
    s.checkedFor !== '' &&
    s.checkedFor === before &&
    s.cells.join('') !== before
  )
    setStatus('Changed since the check. Check it again to post it.')
  render(s)
}

function runCheck(s: State): void {
  if (s.busy) return
  s.busy = true
  setStatus('Checking...')
  render(s)
  // let the browser show "Checking..." before the solver runs
  window.setTimeout(() => {
    const r = checkBoard(rowsOf(s.cells))
    s.busy = false
    if (!r.ok) {
      s.checkedFor = ''
      setStatus(r.reason)
    } else {
      s.checkedFor = s.cells.join('')
      const n = r.parKeys.length
      const of = r.exact ? String(n) : `${n}+`
      setStatus(
        `Solvable! Par ${r.puzzle.par}: ${of} par route${n === 1 ? '' : 's'}. Players get ${r.puzzle.budget} mirrors.`,
      )
    }
    render(s)
    // the check button was disabled while the solver ran, which drops keyboard focus: give it back
    if (document.activeElement === document.body)
      el<HTMLButtonElement>('b-check').focus()
  }, 30)
}

function noteFor(s: State): void {
  const me = s.me
  el('b-note').textContent = me?.loggedIn
    ? [
        `This makes a new post in this community from your account, u/${me.username}.`,
        'Everyone can see the board and your username. You can post one board a day,',
        'and deleting the post deletes the board.',
      ].join(' ')
    : 'Log in to Reddit to post a board. You can still build and check one here.'
}

async function postBoard(s: State, ev: MouseEvent): Promise<void> {
  if (s.busy || s.checkedFor !== s.cells.join('')) return
  s.busy = true
  el<HTMLButtonElement>('b-post').disabled = true
  el('b-error').textContent = ''
  // Reddit's own permission prompt for posting from the player's account
  const allowed = await askToPostAsUser(ev)
  const res = allowed
    ? await fetchBoardPost({rows: rowsOf(s.cells)})
    : undefined
  s.busy = false
  el<HTMLButtonElement>('b-post').disabled = false
  if (!res) {
    el('b-error').textContent =
      'Nothing was posted: Reddit did not give permission to post from your account.'
    return
  }
  if (!res.ok) {
    el('b-error').textContent =
      res.status === 401
        ? 'Log in to Reddit to post a board.'
        : `Could not post: ${res.error}`
    return
  }
  s.postedUrl = res.value.url
  el('b-posted-text').textContent =
    `Posted from u/${s.me?.username ?? 'you'}. Your board is live, par ${res.value.par}.`
  el('b-posted').hidden = false
  render(s)
  // the Post button just disappeared with its panel; keyboard focus goes to the next useful button
  el<HTMLButtonElement>('b-open').focus()
  await loadBoards()
}

function boardLine(b: BoardSummary): string {
  return `Par ${b.par} · ${b.crystals} crystals · ${b.solvers} solved`
}

async function loadBoards(): Promise<void> {
  const res = await fetchBoards()
  const list = el('boards')
  list.replaceChildren()
  if (!res.ok) {
    el('boards-empty').textContent = 'Community boards could not be loaded.'
    el('boards-empty').hidden = false
    return
  }
  el('boards-empty').hidden = res.value.boards.length > 0
  for (const b of res.value.boards) {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'board-link'
    btn.textContent = boardLine(b)
    btn.addEventListener('click', () => void openOnReddit(b.url))
    li.append(btn)
    list.append(li)
  }
}

async function init(): Promise<void> {
  const s: State = {
    cells: emptyBoard(),
    tool: '*',
    checkedFor: '',
    busy: false,
    me: undefined,
    postedUrl: '',
  }
  buildPalette(s)
  buildGrid(s)
  el('loading').hidden = true
  el('app').hidden = false
  setStatus(
    'Pick a square type, then tap the board. Every board needs a lamp and 2 to 6 crystals.',
  )
  render(s)
  el('b-check').addEventListener('click', () => runCheck(s))
  el('b-clear').addEventListener('click', () => {
    if (s.busy) return
    s.cells = emptyBoard()
    s.checkedFor = ''
    setStatus('Cleared. The lamp is back on the left edge.')
    render(s)
  })
  el('b-post').addEventListener('click', ev => void postBoard(s, ev))
  el('b-open').addEventListener('click', () => void openOnReddit(s.postedUrl))
  const t = await fetchToday()
  s.me = t.ok ? t.value.me : undefined
  noteFor(s)
  render(s)
  await loadBoards()
  document.body.dataset.ready = '1'
}

void init()
