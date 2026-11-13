// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Tests for the Lampwright puzzle engine.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Dir, Puzzle} from './puzzle.ts'
import {
  addDays,
  checkSubmission,
  crystals,
  dayDiff,
  dayId,
  generate,
  hashString,
  isDayId,
  keySize,
  mulberry32,
  parseKey,
  reflect,
  search,
  solutionKey,
  trace,
} from './puzzle.ts'

const A: Puzzle = {
  id: 'A',
  w: 5,
  h: 3,
  rows: ['E..*.', '.....', '.....'],
  dir: 1,
  budget: 1,
  par: 0,
}
// needs exactly two mirrors; minimal answers: \ at (2,0) + / at (2,4), or \ at (3,0) + / at (3,4)
const B: Puzzle = {
  id: 'B',
  w: 5,
  h: 5,
  rows: ['E...#', '.....', '.#...', '#....', '.*...'],
  dir: 1,
  budget: 3,
  par: 2,
}
// fixed mirrors bring the beam back to the emitter
const C: Puzzle = {
  id: 'C',
  w: 3,
  h: 3,
  rows: ['E.\\', '...', '\\./'],
  dir: 1,
  budget: 0,
  par: 0,
}

test('mirrors reflect and are their own inverse', () => {
  assert.equal(reflect('/', 1), 0) // right -> up
  assert.equal(reflect('/', 2), 3) // down -> left
  assert.equal(reflect('\\', 1), 2) // right -> down
  assert.equal(reflect('\\', 0), 3) // up -> left
  for (const d of [0, 1, 2, 3] as Dir[]) {
    assert.equal(reflect('/', reflect('/', d)), d)
    assert.equal(reflect('\\', reflect('\\', d)), d)
  }
})

test('trace: straight beam lights a crystal and leaves at the edge', () => {
  const t = trace(A, [])
  assert.deepEqual(t.path, [1, 2, 3, 4])
  assert.deepEqual(t.lit, [3])
  assert.equal(t.end, 'edge')
  assert.equal(t.lastDir, 1)
  assert.equal(t.solved, true)
  assert.deepEqual(t.used, [])
})

test('trace: walls stop the beam; placed mirrors turn it', () => {
  const none = trace(B, [])
  assert.deepEqual(none.path, [1, 2, 3])
  assert.equal(none.end, 'wall')
  assert.equal(none.solved, false)
  const t = trace(B, [
    {i: 22, m: '/'},
    {i: 2, m: '\\'},
  ])
  assert.equal(t.solved, true)
  assert.deepEqual(t.lit, [21])
  assert.deepEqual(t.used, [
    {i: 2, m: '\\'},
    {i: 22, m: '/'},
  ])
})

test('trace: the emitter blocks a beam that comes back to it', () => {
  const t = trace(C, [])
  assert.equal(t.end, 'emitter')
  assert.deepEqual(t.path, [1, 2, 5, 8, 7, 6, 3])
})

test('search finds the true minimum and every minimal answer', () => {
  assert.equal(search(A, 3).min, 0)
  assert.equal(search(B, 1).min, -1)
  const r = search(B, 4)
  assert.equal(r.min, 2)
  assert.equal(r.complete, true)
  const keys = r.solutions.map(solutionKey).sort()
  assert.deepEqual(keys, ['2b.22s', '3b.23s'])
  for (const s of r.solutions) assert.equal(trace(B, s).solved, true)
  const one = search(B, 4, 1)
  assert.equal(one.solutions.length, 1)
  assert.equal(one.complete, false)
})

test('solution keys ignore order and mirrors the beam never touches', () => {
  const a = checkSubmission(B, [
    {i: 2, m: '\\'},
    {i: 22, m: '/'},
  ])
  const b = checkSubmission(B, [
    {i: 10, m: '/'}, // (0,2): never hit
    {i: 22, m: '/'},
    {i: 2, m: '\\'},
  ])
  assert.equal(a.ok && a.solved, true)
  assert.equal(b.ok && b.solved, true)
  assert.equal(a.mirrors, 2)
  assert.equal(b.mirrors, 2)
  assert.equal(a.key, '2b.22s')
  assert.equal(b.key, a.key)
  assert.deepEqual(parseKey(a.key), [
    {i: 2, m: '\\'},
    {i: 22, m: '/'},
  ])
  assert.deepEqual(parseKey(''), [])
  assert.throws(() => parseKey('2x'))
  assert.equal(keySize(''), 0)
  assert.equal(keySize('2b.22s'), 2)
})

test('checkSubmission refuses bad input', () => {
  assert.equal(checkSubmission(B, 'x').ok, false)
  assert.equal(checkSubmission(B, [{i: 11, m: '/'}]).reason, 'cell not empty') // wall
  assert.equal(checkSubmission(B, [{i: 0, m: '/'}]).reason, 'cell not empty') // emitter
  assert.equal(checkSubmission(B, [{i: 99, m: '/'}]).reason, 'bad cell')
  assert.equal(checkSubmission(B, [{i: 1.5, m: '/'}]).reason, 'bad cell')
  assert.equal(checkSubmission(B, [{i: 1, m: '|'}]).reason, 'bad mirror')
  assert.equal(checkSubmission(B, [null]).reason, 'bad placement')
  assert.equal(
    checkSubmission(B, [
      {i: 1, m: '/'},
      {i: 1, m: '\\'},
    ]).reason,
    'duplicate cell',
  )
  assert.equal(
    checkSubmission(B, [
      {i: 1, m: '/'},
      {i: 5, m: '/'},
      {i: 6, m: '/'},
      {i: 7, m: '/'},
    ]).reason,
    'over budget',
  )
  const miss = checkSubmission(B, [{i: 2, m: '\\'}])
  assert.equal(miss.ok, true)
  assert.equal(miss.solved, false)
  assert.equal(miss.key, '')
})

test('random helpers are deterministic', () => {
  assert.equal(hashString('abc'), hashString('abc'))
  assert.notEqual(hashString('abc'), hashString('abd'))
  const r1 = mulberry32(42)
  const r2 = mulberry32(42)
  for (let k = 0; k < 20; k++) {
    const v = r1()
    assert.equal(v, r2())
    assert.ok(v >= 0 && v < 1)
  }
})

test('day helpers use UTC dates', () => {
  assert.equal(dayId(new Date('2026-11-12T23:59:59Z')), '2026-11-12')
  assert.equal(dayId(new Date('2026-11-13T00:00:00Z')), '2026-11-13')
  assert.equal(dayDiff('2026-11-30', '2026-12-01'), 1)
  assert.equal(dayDiff('2026-11-12', '2026-11-12'), 0)
  assert.equal(addDays('2026-12-01', -1), '2026-11-30')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-11-12', 0), '2026-11-12')
  assert.equal(isDayId('2026-11-12'), true)
  assert.equal(isDayId('2026-13-45'), false)
  assert.equal(isDayId('x'), false)
  assert.equal(isDayId(3), false)
})

test('daily puzzles are deterministic, solvable and at par', () => {
  const p1 = generate('2026-11-12')
  const p2 = generate('2026-11-12')
  assert.deepEqual(p1, p2)
  const ids: string[] = []
  for (let d = 1; d <= 30; d++)
    ids.push(`2026-12-${String(d).padStart(2, '0')}`)
  const seen = new Set<string>()
  let multi = 0
  for (const id of ids) {
    const p = generate(id)
    assert.equal(p.id, id)
    assert.equal(p.rows.length, p.h)
    for (const row of p.rows) assert.equal(row.length, p.w)
    assert.equal(p.rows.join('').split('E').length - 1, 1)
    assert.ok(crystals(p).length >= 2)
    assert.ok(p.par >= 2 && p.par <= 4, `${id} par ${p.par}`)
    assert.equal(p.budget, p.par + 1)
    const r = search(p, p.par)
    assert.equal(r.min, p.par)
    for (const s of r.solutions) {
      const v = checkSubmission(p, s)
      assert.equal(v.ok && v.solved, true)
      assert.equal(v.mirrors, p.par)
    }
    if (r.complete && r.solutions.length >= 2 && r.solutions.length <= 6)
      multi++
    seen.add(p.rows.join('/'))
  }
  assert.ok(seen.size >= 28, 'days should differ')
  // v0.3: the generator prefers days with 2-6 par routes to find together
  assert.ok(multi >= 24, `only ${multi} of 30 days have 2-6 par routes`)
})
