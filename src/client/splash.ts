// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Lampwright inline post view: the puzzle's number, the crowd so far, yesterday,
// Play, (v0.5) Build a board, and (v0.8) when the next daily puzzle arrives.
import {requestExpandedMode} from '@devvit/web/client'
import {nextPuzzleText} from '../shared/countdown.ts'
import {yesterdayLine} from '../shared/share.ts'
import {fetchToday} from './fetch.ts'

function el(id: string): HTMLElement {
  const e = document.getElementById(id)
  if (!e) throw Error(`missing #${id}`)
  return e
}

el('start-btn').addEventListener('click', ev => requestExpandedMode(ev, 'game'))
el('build-btn').addEventListener('click', ev =>
  requestExpandedMode(ev, 'build'),
)

async function init(): Promise<void> {
  const res = await fetchToday()
  if (!res.ok) return
  const t = res.value
  const board = t.kind === 'board'
  if (board) {
    el('title').textContent = 'Community board'
    el('day').textContent = 'Built by a player in this community'
    el('pitch').textContent =
      'Bend one beam of light through every crystal on a board a player made.'
  } else {
    el('title').textContent = `Lampwright #${t.number}`
    el('day').textContent = new Date(`${t.day}T00:00:00Z`).toLocaleDateString(
      'en-US',
      {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      },
    )
  }
  const s = t.stats
  const total = s.parRoutesExact ? String(s.parRoutes) : `${s.parRoutes}+`
  el('crowd').textContent =
    s.solvers === 0
      ? `Par ${t.puzzle.par}. Be the first to light it.`
      : `${s.solvers} solved so far. ${s.parFound} of ${total} par routes found.`
  if (t.me.solved) el('start-btn').textContent = 'Find another route'
  else if (!board && !t.isToday)
    el('start-btn').textContent = 'Play or see the par routes'
  if (!board && t.me.streak > 0)
    el('streak').textContent =
      `Your streak: ${t.me.streak} day${t.me.streak === 1 ? '' : 's'}`
  const y = yesterdayLine(t.yesterday)
  el('yesterday').textContent = y
  el('yesterday').hidden = y === ''
  document.body.dataset.ready = '1'
}

/** v0.8: the next daily puzzle's countdown, refreshed every 20 s (runs even if the fetch fails). */
function tick(): void {
  const n = el('next')
  n.textContent = nextPuzzleText(Date.now())
  n.hidden = false
}
tick()
setInterval(tick, 20_000)

void init()
