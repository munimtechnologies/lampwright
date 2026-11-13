// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Tests for the next-puzzle countdown.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {msToNextPuzzle, nextPuzzleText} from './countdown.ts'

const at = (day: number, h: number, m: number, s = 0): number =>
  Date.UTC(2026, 10, day, h, m, s)

test('afternoon: counts to 00:05 UTC tomorrow', () => {
  assert.equal(msToNextPuzzle(at(12, 14, 30)), (9 * 60 + 35) * 60_000)
  assert.equal(nextPuzzleText(at(12, 14, 30)), 'Next puzzle in 9h 35m.')
})

test('just after midnight, before the post: minutes only', () => {
  assert.equal(nextPuzzleText(at(13, 0, 2)), 'Next puzzle in 3m.')
  assert.equal(nextPuzzleText(at(12, 23, 59)), 'Next puzzle in 6m.')
})

test('at the post minute itself: a full day to the next one', () => {
  assert.equal(msToNextPuzzle(at(13, 0, 5)), 86_400_000)
  assert.equal(nextPuzzleText(at(13, 0, 5)), 'Next puzzle in 24h 0m.')
})

test('the last minute reads naturally; partial minutes round up', () => {
  assert.equal(
    nextPuzzleText(at(13, 0, 4, 30)),
    'Next puzzle in under a minute.',
  )
  assert.equal(nextPuzzleText(at(12, 22, 0, 1)), 'Next puzzle in 2h 5m.')
})

test('month and year ends roll over', () => {
  assert.equal(msToNextPuzzle(Date.UTC(2026, 10, 30, 12, 5)), 12 * 3_600_000)
  assert.equal(msToNextPuzzle(Date.UTC(2026, 11, 31, 23, 0)), 65 * 60_000)
})
