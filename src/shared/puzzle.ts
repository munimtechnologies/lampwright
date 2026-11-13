// Lampwright - daily light-beam puzzle engine.
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
//
// Pure, dependency-free TypeScript shared by the client and the server.
// A puzzle is a grid. A beam leaves the emitter 'E' in a fixed direction. The
// player places up to `budget` mirrors ('/' or '\') on empty cells so that the
// beam passes through every crystal '*'. Walls '#' and the emitter stop the beam;
// crystals let it pass. Fixed mirrors '/' '\' are part of the map.
// Score = mirrors the beam actually touches (fewer is better; par = the minimum).
// Written to pass `noUncheckedIndexedAccess`.

export type Dir = 0 | 1 | 2 | 3 // 0 up, 1 right, 2 down, 3 left
export type Mirror = '/' | '\\'

export type Puzzle = {
  id: string // e.g. "2026-11-12"
  w: number
  h: number
  rows: string[] // h strings of length w over '.', '#', '*', '/', '\\', 'E'
  dir: Dir // direction the beam leaves the emitter
  budget: number // mirrors the player may place
  par: number // fewest mirrors that solve it
}

export type Placement = {
  i: number // cell index y * w + x
  m: Mirror
}

export type TraceEnd = 'edge' | 'wall' | 'emitter' | 'loop'

export type TraceResult = {
  path: number[] // cell indices the beam entered, in order
  lit: number[] // crystal indices lit (sorted)
  used: Placement[] // placed mirrors the beam touched (sorted by i)
  end: TraceEnd
  lastDir: Dir // direction the beam was travelling when it stopped
  solved: boolean
}

export function dx(d: Dir): number {
  return d === 1 ? 1 : d === 3 ? -1 : 0
}

export function dy(d: Dir): number {
  return d === 2 ? 1 : d === 0 ? -1 : 0
}

/** '/': up->right, right->up, down->left, left->down. '\': up->left, right->down, down->right, left->up. */
export function reflect(m: Mirror, d: Dir): Dir {
  return (m === '/' ? d ^ 1 : 3 - d) as Dir
}

/** The map character at a cell index ('#' outside the grid). */
export function cellAt(p: Puzzle, i: number): string {
  const row = p.rows[Math.floor(i / p.w)]
  return row?.[i % p.w] ?? '#'
}

function charAt(p: Puzzle, x: number, y: number): string {
  return p.rows[y]?.[x] ?? '#'
}

export function emitterIndex(p: Puzzle): number {
  for (let y = 0; y < p.h; y++) {
    const x = (p.rows[y] ?? '').indexOf('E')
    if (x >= 0) return y * p.w + x
  }
  throw Error('puzzle has no emitter')
}

export function crystals(p: Puzzle): number[] {
  const out: number[] = []
  for (let i = 0; i < p.w * p.h; i++) if (cellAt(p, i) === '*') out.push(i)
  return out
}

/** Follow the beam with the given player mirrors. */
export function trace(p: Puzzle, placed: readonly Placement[]): TraceResult {
  const mirrors = new Map<number, Mirror>()
  for (const pl of placed) mirrors.set(pl.i, pl.m)
  const e = emitterIndex(p)
  let x = e % p.w
  let y = Math.floor(e / p.w)
  let d: Dir = p.dir
  const seen = new Set<number>()
  const path: number[] = []
  const lit = new Set<number>()
  const used = new Map<number, Mirror>()
  let end: TraceEnd = 'edge'
  for (;;) {
    x += dx(d)
    y += dy(d)
    if (x < 0 || y < 0 || x >= p.w || y >= p.h) {
      end = 'edge'
      break
    }
    const i = y * p.w + x
    const c = charAt(p, x, y)
    if (c === '#') {
      end = 'wall'
      break
    }
    if (c === 'E') {
      end = 'emitter'
      break
    }
    const key = i * 4 + d
    if (seen.has(key)) {
      end = 'loop'
      break
    }
    seen.add(key)
    path.push(i)
    if (c === '*') lit.add(i)
    if (c === '/' || c === '\\') {
      d = reflect(c, d)
    } else if (c === '.') {
      const m = mirrors.get(i)
      if (m !== undefined) {
        used.set(i, m)
        d = reflect(m, d)
      }
    }
  }
  const all = crystals(p)
  const usedList = [...used.entries()]
    .map(([i, m]) => ({i, m}))
    .sort((a, b) => a.i - b.i)
  return {
    path,
    lit: [...lit].sort((a, b) => a - b),
    used: usedList,
    end,
    lastDir: d,
    solved: all.length > 0 && all.every(c => lit.has(c)),
  }
}

/** Canonical key of a solution: only the mirrors the beam touches, by cell. */
export function solutionKey(used: readonly Placement[]): string {
  return [...used]
    .sort((a, b) => a.i - b.i)
    .map(pl => `${pl.i}${pl.m === '/' ? 's' : 'b'}`)
    .join('.')
}

/** Mirrors in a solution key ("" -> 0). */
export function keySize(key: string): number {
  return key === '' ? 0 : key.split('.').length
}

/** Inverse of solutionKey ("2b.22s" -> placements). Returns [] for "". */
export function parseKey(key: string): Placement[] {
  if (key === '') return []
  const out: Placement[] = []
  for (const part of key.split('.')) {
    const m = /^(\d+)([sb])$/.exec(part)
    if (!m) throw Error(`bad key part ${part}`)
    out.push({i: Number(m[1]), m: m[2] === 's' ? '/' : '\\'})
  }
  return out
}

export type SearchResult = {
  min: number // fewest mirrors, or -1 if unsolved within maxMirrors
  solutions: Placement[][] // distinct minimal solutions (up to limit)
  complete: boolean // true when every minimal solution was listed
  nodes: number // search effort
}

/**
 * Exhaustive search for the fewest mirrors (iterative deepening 0..maxMirrors).
 * A cell the beam has crossed empty must stay empty; a placed mirror deflects
 * the beam every time it is hit.
 */
export function search(
  p: Puzzle,
  maxMirrors: number,
  limit = 64,
  nodeCap = 2_000_000,
): SearchResult {
  const targets = crystals(p)
  const T = targets.length
  const n = p.w * p.h
  const isTarget = new Uint8Array(n)
  for (const t of targets) isTarget[t] = 1
  const e = emitterIndex(p)
  let nodes = 0
  for (let budget = 0; budget <= maxMirrors; budget++) {
    const found = new Map<string, Placement[]>()
    const placed = new Map<number, Mirror>()
    const clear = new Uint8Array(n)
    const litCount = new Uint16Array(n)
    const seen = new Uint8Array(n * 4)
    let litN = 0
    let capped = false
    const full = (): boolean => found.size >= limit || capped

    const go = (x0: number, y0: number, d0: Dir): void => {
      if (full()) return
      nodes++
      if (nodes > nodeCap) {
        capped = true
        return
      }
      let x = x0
      let y = y0
      let d = d0
      // undo log for this frame
      const marks: number[] = []
      const clears: number[] = []
      const lits: number[] = []
      const undo = (): void => {
        for (const k of marks) seen[k] = 0
        for (const c of clears) clear[c] = 0
        for (const t of lits) {
          const left = (litCount[t] ?? 1) - 1
          litCount[t] = left
          if (left === 0) litN--
        }
      }
      for (;;) {
        x += dx(d)
        y += dy(d)
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) break
        const i = y * p.w + x
        if (i === e) break
        const c = charAt(p, x, y)
        if (c === '#') break
        const k = i * 4 + d
        if (seen[k]) break
        seen[k] = 1
        marks.push(k)
        if (isTarget[i]) {
          const before = litCount[i] ?? 0
          if (before === 0) litN++
          litCount[i] = before + 1
          lits.push(i)
          if (litN === T) {
            const sol = [...placed.entries()]
              .map(([ci, m]) => ({i: ci, m}))
              .sort((a, b) => a.i - b.i)
            found.set(solutionKey(sol), sol)
            undo()
            return
          }
        }
        if (c === '/' || c === '\\') {
          d = reflect(c, d)
          continue
        }
        if (c !== '.') continue // crystal: pass straight through
        const pm = placed.get(i)
        if (pm !== undefined) {
          d = reflect(pm, d)
          continue
        }
        if (clear[i]) continue
        // branch: place a mirror here (if budget allows), or leave it empty
        if (placed.size < budget) {
          for (const m of ['/', '\\'] as const) {
            placed.set(i, m)
            go(x, y, reflect(m, d))
            placed.delete(i)
            if (full()) {
              undo()
              return
            }
          }
        }
        clear[i] = 1
        clears.push(i)
      }
      undo()
    }

    go(e % p.w, Math.floor(e / p.w), p.dir)
    if (found.size > 0) {
      const sols = [...found.values()]
      const min = Math.min(...sols.map(s => s.length))
      const best = sols.filter(s => s.length === min)
      return {
        min,
        solutions: best,
        complete: !capped && found.size < limit,
        nodes,
      }
    }
    if (capped) return {min: -1, solutions: [], complete: false, nodes}
  }
  return {min: -1, solutions: [], complete: true, nodes}
}

// ---- deterministic daily generation -------------------------------------

export function hashString(s: string): number {
  let h = 2166136261 >>> 0 // FNV-1a
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type GenOptions = {
  w?: number
  h?: number
  minPar?: number
  maxPar?: number
  slack?: number // budget = par + slack
  maxAttempts?: number
  // v0.3: the shared goal is "find every par route", so prefer boards whose
  // number of distinct par routes is known exactly and lies in this range.
  minRoutes?: number
  maxRoutes?: number
  preferAttempts?: number // after this many attempts, take the first board that fits par
}

/** The puzzle for a given day id (e.g. "2026-11-12"). Same id -> same puzzle. */
export function generate(id: string, opts: GenOptions = {}): Puzzle {
  const w = opts.w ?? 7
  const h = opts.h ?? 9
  const minPar = opts.minPar ?? 2
  const maxPar = opts.maxPar ?? 4
  const slack = opts.slack ?? 1
  const maxAttempts = opts.maxAttempts ?? 400
  const minRoutes = opts.minRoutes ?? 2
  const maxRoutes = opts.maxRoutes ?? 6
  const preferAttempts = opts.preferAttempts ?? 150
  const rnd = mulberry32(hashString(`lampwright:${id}`))
  const ri = (k: number): number => Math.floor(rnd() * k)
  let fallback: Puzzle | undefined
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (fallback && attempt >= preferAttempts) return fallback
    const g: string[] = new Array<string>(w * h).fill('.')
    // emitter on an edge, pointing inward
    const side = ri(4)
    let ex = 0
    let ey = 0
    let dir: Dir = 1
    if (side === 0) {
      ex = 1 + ri(w - 2)
      ey = 0
      dir = 2
    } else if (side === 1) {
      ex = w - 1
      ey = 1 + ri(h - 2)
      dir = 3
    } else if (side === 2) {
      ex = 1 + ri(w - 2)
      ey = h - 1
      dir = 0
    } else {
      ex = 0
      ey = 1 + ri(h - 2)
      dir = 1
    }
    g[ey * w + ex] = 'E'
    const free = (): number => {
      for (let k = 0; k < 50; k++) {
        const x = ri(w)
        const y = ri(h)
        if (g[y * w + x] === '.' && Math.abs(x - ex) + Math.abs(y - ey) > 1)
          return y * w + x
      }
      return -1
    }
    const put = (ch: string, count: number): void => {
      for (let k = 0; k < count; k++) {
        const c = free()
        if (c >= 0) g[c] = ch
      }
    }
    put('*', 2 + ri(2))
    put('#', 6 + ri(6))
    put(ri(2) === 0 ? '/' : '\\', ri(3))
    const rows: string[] = []
    for (let y = 0; y < h; y++) rows.push(g.slice(y * w, y * w + w).join(''))
    const p: Puzzle = {id, w, h, rows, dir, budget: 0, par: 0}
    if (crystals(p).length < 2) continue
    const r = search(p, maxPar, maxRoutes + 1, 300_000)
    if (r.min < minPar || r.min > maxPar) continue
    p.par = r.min
    p.budget = r.min + slack
    const routes = r.solutions.length
    if (r.complete && routes >= minRoutes && routes <= maxRoutes) return p
    fallback ??= p
  }
  if (fallback) return fallback
  throw Error(`no puzzle for ${id} in ${maxAttempts} attempts`)
}

/** UTC day id, e.g. "2026-11-12". */
export function dayId(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Days between two day ids (b - a). */
export function dayDiff(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  )
}

/** The day id `n` days after `day` (negative n goes back). */
export function addDays(day: string, n: number): string {
  return dayId(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000))
}

export function isDayId(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  )
}

export type Verdict = {
  ok: boolean
  reason?: string
  solved: boolean
  mirrors: number
  key: string
}

/** Server-side check of a player's submission (never trust the client). */
export function checkSubmission(p: Puzzle, placed: unknown): Verdict {
  const bad = (reason: string): Verdict => ({
    ok: false,
    reason,
    solved: false,
    mirrors: 0,
    key: '',
  })
  if (!Array.isArray(placed)) return bad('not a list')
  if (placed.length > p.budget) return bad('over budget')
  const seenCells = new Set<number>()
  const list: Placement[] = []
  for (const raw of placed as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return bad('bad placement')
    const {i, m} = raw as {i: unknown; m: unknown}
    if (
      typeof i !== 'number' ||
      !Number.isInteger(i) ||
      i < 0 ||
      i >= p.w * p.h
    )
      return bad('bad cell')
    if (m !== '/' && m !== '\\') return bad('bad mirror')
    if (cellAt(p, i) !== '.') return bad('cell not empty')
    if (seenCells.has(i)) return bad('duplicate cell')
    seenCells.add(i)
    list.push({i, m})
  }
  const t = trace(p, list)
  return {
    ok: true,
    solved: t.solved,
    mirrors: t.used.length,
    key: t.solved ? solutionKey(t.used) : '',
  }
}
