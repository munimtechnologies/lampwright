// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
//
// Community boards. A player paints a board from map symbols only (lamp, crystal,
// wall, fixed mirror; no free text, per the Devvit Rules on user content), the
// solver proves it can be solved and sets par, and the player may post it to the
// subreddit from their own account. Pure code, shared by the client and the server.
import type {Dir, Puzzle} from './puzzle.ts'
import {search, solutionKey} from './puzzle.ts'

export const BOARD_W = 7
export const BOARD_H = 9
export const BOARD_MIN_PAR = 1
export const BOARD_MAX_PAR = 5
export const BOARD_MIN_CRYSTALS = 2
export const BOARD_MAX_CRYSTALS = 6
export const BOARD_MAX_WALLS = 24
export const BOARD_MAX_FIXED = 4
/** Solver effort allowed for one check (the client and the server use the same cap). */
export const BOARD_NODE_CAP = 1_500_000

/** The only symbols a board may contain. */
export const BOARD_SYMBOLS: ReadonlySet<string> = new Set([
  '.',
  '#',
  '*',
  '/',
  '\\',
  'E',
])

export type BoardRecord = {puzzle: Puzzle; parKeys: string[]; exact: boolean}
export type BoardCheck =
  | ({ok: true} & BoardRecord)
  | {ok: false; reason: string}

/**
 * The direction a lamp on cell `i` shines: inward from an edge. -1 for corners and
 * inner cells, where a lamp may not go (the daily generator follows the same rule).
 */
export function lampDir(i: number, w = BOARD_W, h = BOARD_H): Dir | -1 {
  if (!Number.isInteger(i) || i < 0 || i >= w * h) return -1
  const x = i % w
  const y = Math.floor(i / w)
  const edgeX = x === 0 || x === w - 1
  const edgeY = y === 0 || y === h - 1
  if (edgeX && edgeY) return -1
  if (y === 0) return 2
  if (y === h - 1) return 0
  if (x === 0) return 1
  if (x === w - 1) return 3
  return -1
}

/** A board post's puzzle id ("t3_abc" -> "b-abc"). Never looks like a day id. */
export function boardIdFor(t3: string): string {
  return `b-${t3.replace(/^t3_/, '')}`
}

export function isBoardId(s: unknown): s is string {
  return typeof s === 'string' && /^b-[a-z0-9]{1,16}$/.test(s)
}

function countOf(flat: string, ch: string): number {
  let n = 0
  for (const c of flat) if (c === ch) n++
  return n
}

/**
 * Checks a painted board. On success the puzzle has its par (the fewest mirrors
 * that light every crystal) and budget (par + 1), with every par route found.
 */
export function checkBoard(rows: unknown, id = 'draft'): BoardCheck {
  const no = (reason: string): BoardCheck => ({ok: false, reason})
  if (!Array.isArray(rows) || rows.length !== BOARD_H)
    return no(`A board has ${BOARD_H} rows.`)
  const list: string[] = []
  for (const r of rows as unknown[]) {
    if (typeof r !== 'string' || r.length !== BOARD_W)
      return no(`Each row has ${BOARD_W} squares.`)
    for (const c of r)
      if (!BOARD_SYMBOLS.has(c))
        return no('Only lamp, crystal, wall and mirror squares are allowed.')
    list.push(r)
  }
  const flat = list.join('')
  const lamps: number[] = []
  for (let i = 0; i < flat.length; i++) if (flat[i] === 'E') lamps.push(i)
  if (lamps.length !== 1) return no('Place exactly one lamp.')
  const dir = lampDir(lamps[0] ?? -1)
  if (dir === -1) return no('The lamp goes on an edge square, not a corner.')
  const nCrystals = countOf(flat, '*')
  if (nCrystals < BOARD_MIN_CRYSTALS || nCrystals > BOARD_MAX_CRYSTALS)
    return no(`Use ${BOARD_MIN_CRYSTALS} to ${BOARD_MAX_CRYSTALS} crystals.`)
  if (countOf(flat, '#') > BOARD_MAX_WALLS)
    return no(`Use at most ${BOARD_MAX_WALLS} walls.`)
  if (countOf(flat, '/') + countOf(flat, '\\') > BOARD_MAX_FIXED)
    return no(`Use at most ${BOARD_MAX_FIXED} fixed mirrors.`)
  const p: Puzzle = {
    id,
    w: BOARD_W,
    h: BOARD_H,
    rows: list,
    dir,
    budget: 0,
    par: 0,
  }
  const r = search(p, BOARD_MAX_PAR, 64, BOARD_NODE_CAP)
  if (r.min < 0)
    return no(
      r.complete
        ? `No route lights every crystal with ${BOARD_MAX_PAR} mirrors or fewer.`
        : 'This board is too tangled to check. Try fewer open squares or crystals.',
    )
  if (r.min < BOARD_MIN_PAR)
    return no('The light already reaches every crystal without a mirror.')
  p.par = r.min
  p.budget = r.min + 1
  return {
    ok: true,
    puzzle: p,
    parKeys: r.solutions.map(solutionKey).sort(),
    exact: r.complete,
  }
}

/** Post title for a board. Symbols and numbers only: nothing the player typed. */
export function boardTitle(p: Puzzle): string {
  let n = 0
  for (const r of p.rows) n += countOf(r, '*')
  return `Lampwright community board: light ${n} crystals, par ${p.par}`
}

/**
 * The board as plain text, sent as the post's userGeneratedContent so Reddit's
 * safety checks see exactly what the player made.
 */
export function boardText(p: Puzzle): string {
  return [
    `Lampwright community board, par ${p.par}.`,
    'Key: E lamp, * crystal, # wall, / and \\ fixed mirrors, . empty.',
    ...p.rows,
  ].join('\n')
}

/** What older Reddit clients show instead of the game. */
export function boardFallback(p: Puzzle): string {
  return `A Lampwright board made by a player in this community (par ${p.par}). Open the post in the Reddit app or on the web to play.`
}
