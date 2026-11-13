// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Tests for the shared result-comment text.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {BOARD_LABEL, myParRoutes, shareText, yesterdayLine} from './share.ts'

const base = {
  number: 9,
  par: 3,
  best: 3,
  routes: ['1s.5b.9s'],
  parRoutes: 4,
  parRoutesExact: true,
  streak: 1,
}

test('par result: diamonds count my par routes, no positions leak', () => {
  const t = shareText(base)
  assert.equal(
    t,
    'Lampwright #9: par! Every crystal lit with 3 mirrors.\n\n◆◇◇◇ I found 1 of 4 par routes.',
  )
  assert.doesNotMatch(t, /\d+[sb]/) // no solution keys
})

test('over par: no route line, par named', () => {
  const t = shareText({...base, best: 4, routes: ['1s.5b.9s.12b']})
  assert.equal(t, 'Lampwright #9: every crystal lit with 4 mirrors (par 3).')
})

test('streak and inexact totals', () => {
  const t = shareText({
    ...base,
    routes: ['1s.5b.9s', '2s.5b.9s', '2s.5b.9s'],
    parRoutes: 64,
    parRoutesExact: false,
    streak: 5,
  })
  const lines = t.split('\n\n')
  assert.equal(lines.length, 3)
  assert.equal(
    lines[1],
    `${'◆'.repeat(2)}${'◇'.repeat(10)} I found 2 of 64+ par routes.`,
  )
  assert.equal(lines[2], 'Daily streak: 5 days.')
})

test('one mirror and one route read naturally', () => {
  const t = shareText({...base, par: 1, best: 1, routes: ['7s'], parRoutes: 1})
  assert.equal(
    t,
    'Lampwright #9: par! Every crystal lit with 1 mirror.\n\n◆ I found 1 of 1 par route.',
  )
})

test('refuses to share before a solve; counts only par-sized keys', () => {
  assert.throws(() => shareText({...base, best: 0, routes: []}))
  assert.equal(myParRoutes(['1s.2b', '1s.2b.3s', '4s.2b.3s', '1s.2b.3s'], 3), 2)
})

test("yesterday's line: counts only, plural-aware, empty without a day", () => {
  const y = {
    day: '2026-11-19',
    number: 8,
    par: 3,
    solvers: 12,
    atPar: 7,
    parFound: 3,
    parRoutes: 4,
    parRoutesExact: true,
  }
  assert.equal(yesterdayLine(null), '')
  assert.equal(
    yesterdayLine(y),
    "Yesterday, #8: 12 solvers found 3 of 4 par routes. See them all on yesterday's post.",
  )
  assert.equal(
    yesterdayLine({...y, solvers: 1, parFound: 1, parRoutes: 1}),
    "Yesterday, #8: 1 solver found 1 of 1 par route. See them all on yesterday's post.",
  )
  assert.equal(
    yesterdayLine({...y, parRoutesExact: false}).includes('3 of 4+ par routes'),
    true,
  )
  assert.equal(
    yesterdayLine({...y, solvers: 0, parFound: 0}),
    "Yesterday, #8: nobody solved it. Its par routes are on yesterday's post.",
  )
})

test('v0.5: a community board result is named as a board, never a day number', () => {
  const t = shareText({
    ...base,
    number: 0,
    label: BOARD_LABEL,
    par: 1,
    best: 1,
    routes: ['33s'],
    parRoutes: 1,
    streak: 0,
  })
  assert.equal(
    t,
    'Lampwright community board: par! Every crystal lit with 1 mirror.\n\n◆ I found 1 of 1 par route.',
  )
  assert.doesNotMatch(t, /#0/)
})
