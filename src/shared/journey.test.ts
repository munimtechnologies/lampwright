// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {JourneyRules, progressOf} from './journey.ts'

test('journey: nothing is sent before the first placed mirror, then start and progress', () => {
  const j = new JourneyRules()
  assert.equal(j.active, false)
  assert.deepEqual(j.changed(0, 3), [{kind: 'start'}])
  assert.equal(j.active, true)
  assert.deepEqual(j.changed(1, 3), [
    {
      kind: 'progress',
      progress: 0.33,
      action: 'crystals_lit',
      actionDetails: '1/3',
    },
  ])
})

test('journey: progress only on a new best, at most one event per crystal', () => {
  const j = new JourneyRules()
  let sent = j.changed(1, 4).length // start + progress
  assert.equal(sent, 2)
  assert.deepEqual(j.changed(1, 4), [])
  assert.deepEqual(j.changed(0, 4), [])
  assert.deepEqual(j.changed(2, 4), [
    {
      kind: 'progress',
      progress: 0.5,
      action: 'crystals_lit',
      actionDetails: '2/4',
    },
  ])
  sent = 0
  for (const lit of [1, 3, 2, 3, 4, 4, 0, 4]) sent += j.changed(lit, 4).length
  assert.equal(sent, 2) // 3/4 and 4/4 only
})

test('journey: progress values stay between 0.1 and 1', () => {
  assert.equal(progressOf(1, 20), 0.1)
  assert.equal(progressOf(0, 3), 0.1)
  assert.equal(progressOf(3, 3), 1)
  assert.equal(progressOf(9, 3), 1)
  assert.equal(progressOf(2, 3), 0.67)
  assert.equal(progressOf(1, 0), 0.1)
  const j = new JourneyRules()
  assert.deepEqual(j.changed(5, 0), [{kind: 'start'}]) // a board with no crystals never reports progress
})

test('journey: a lock-in ends the journey once, with win at par', () => {
  const j = new JourneyRules()
  j.changed(3, 3)
  assert.deepEqual(j.lockedIn(2, 2), [
    {kind: 'interaction', action: 'lock_in'},
    {kind: 'end', complete: true, game: {win: true, score: 2}},
  ])
  assert.equal(j.active, false)
  assert.deepEqual(j.lockedIn(2, 2), [])
  const k = new JourneyRules()
  k.changed(3, 3)
  assert.deepEqual(k.lockedIn(3, 2)[1], {
    kind: 'end',
    complete: true,
    game: {win: false, score: 3},
  })
  assert.deepEqual(new JourneyRules().lockedIn(2, 2), []) // no journey, nothing to end
})

test('journey: hunting another route after a lock-in starts a new journey from zero', () => {
  const j = new JourneyRules()
  j.changed(3, 3)
  j.lockedIn(2, 2)
  assert.deepEqual(j.changed(1, 3), [
    {kind: 'start'},
    {
      kind: 'progress',
      progress: 0.33,
      action: 'crystals_lit',
      actionDetails: '1/3',
    },
  ])
  assert.deepEqual(j.interaction('play_again'), [
    {kind: 'interaction', action: 'play_again'},
  ])
})
