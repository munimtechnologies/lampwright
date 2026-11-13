// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Tests for community boards: painting rules, the solver check, ids and post text.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  BOARD_H,
  BOARD_W,
  boardFallback,
  boardIdFor,
  boardText,
  boardTitle,
  checkBoard,
  isBoardId,
  lampDir,
} from './board.ts'
import {parseKey, trace} from './puzzle.ts'

// Lamp on the left edge of row 5 shining right, a crystal in its path at row 5 column 4,
// and one at row 2 column 6. One '/' mirror at row 5 column 6 (cell 33) lights both.
const BOARD = [
  '.......',
  '.....*.',
  '.......',
  '.......',
  'E..*...',
  '.......',
  '.......',
  '.......',
  '.......',
]

function withRow(rows: string[], y: number, row: string): string[] {
  return rows.map((r, k) => (k === y ? row : r))
}

test('lamp direction: inward from each edge, never a corner or an inner square', () => {
  assert.equal(lampDir(3), 2) // top edge shines down
  assert.equal(lampDir(8 * BOARD_W + 3), 0) // bottom edge shines up
  assert.equal(lampDir(4 * BOARD_W), 1) // left edge shines right
  assert.equal(lampDir(4 * BOARD_W + 6), 3) // right edge shines left
  for (const corner of [
    0,
    BOARD_W - 1,
    (BOARD_H - 1) * BOARD_W,
    BOARD_W * BOARD_H - 1,
  ])
    assert.equal(lampDir(corner), -1)
  assert.equal(lampDir(4 * BOARD_W + 3), -1)
  assert.equal(lampDir(-1), -1)
  assert.equal(lampDir(BOARD_W * BOARD_H), -1)
  assert.equal(lampDir(1.5), -1)
})

test('a good board: par, budget, every par route, and each route really solves', () => {
  const r = checkBoard(BOARD, 'b-test1')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.puzzle.id, 'b-test1')
  assert.equal(r.puzzle.dir, 1)
  assert.equal(r.puzzle.par, 1)
  assert.equal(r.puzzle.budget, 2)
  assert.deepEqual(r.parKeys, ['33s'])
  assert.equal(r.exact, true)
  for (const k of r.parKeys)
    assert.equal(trace(r.puzzle, parseKey(k)).solved, true)
  assert.equal(trace(r.puzzle, []).solved, false)
})

test('refuses boards that break the painting rules, each with a reason', () => {
  const reasons: [string, unknown][] = [
    ['rows', 'nope'],
    ['rows', BOARD.slice(0, BOARD_H - 1)],
    ['squares', withRow(BOARD, 2, '....')],
    ['allowed', withRow(BOARD, 4, 'E..x...')],
    ['exactly one lamp', withRow(BOARD, 4, '...*...')],
    ['exactly one lamp', withRow(BOARD, 4, 'E..*..E')],
    ['corner', withRow(withRow(BOARD, 4, '...*...'), 0, 'E......')],
    ['edge', withRow(BOARD, 4, '.E.*...')],
    ['crystals', withRow(BOARD, 1, '.......')],
    ['crystals', withRow(withRow(BOARD, 7, '******.'), 8, '.......')],
    [
      'walls',
      [...BOARD.slice(0, 5), '#######', '#######', '#######', '####...'],
    ],
    ['fixed mirrors', withRow(BOARD, 7, '/\\/\\/..')],
  ]
  for (const [word, rows] of reasons) {
    const r = checkBoard(rows)
    assert.equal(r.ok, false, `expected a refusal mentioning "${word}"`)
    if (!r.ok) assert.match(r.reason, new RegExp(word), r.reason)
  }
})

test('refuses a board the light already solves, and one no route can solve', () => {
  const easy = checkBoard(withRow(withRow(BOARD, 1, '.......'), 4, 'E..*.*.'))
  assert.equal(easy.ok, false)
  if (!easy.ok) assert.match(easy.reason, /without a mirror/)
  // the second crystal is boxed in by walls on all four sides
  const boxed = [
    '.....#.',
    '....#*#',
    '.....#.',
    '.......',
    'E..*...',
    '.......',
    '.......',
    '.......',
    '.......',
  ]
  const r = checkBoard(boxed)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.reason, /No route|too tangled/)
})

test('board ids: from a post id, never confused with a day', () => {
  assert.equal(boardIdFor('t3_abc123'), 'b-abc123')
  assert.equal(isBoardId('b-abc123'), true)
  assert.equal(isBoardId('2026-11-20'), false)
  assert.equal(isBoardId('b-'), false)
  assert.equal(isBoardId('b-ABC'), false)
  assert.equal(isBoardId('b-abc/../x'), false)
  assert.equal(isBoardId(7), false)
})

test('post text: title, user content and fallback show only symbols and numbers', () => {
  const r = checkBoard(BOARD)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(
    boardTitle(r.puzzle),
    'Lampwright community board: light 2 crystals, par 1',
  )
  const text = boardText(r.puzzle)
  const lines = text.split('\n')
  assert.equal(lines[0], 'Lampwright community board, par 1.')
  assert.deepEqual(lines.slice(2), BOARD)
  assert.match(boardFallback(r.puzzle), /par 1/)
})
