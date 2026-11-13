// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// The spoiler-free result comment a player can choose to post as themselves.
// Shared so the client preview and the server's real comment are the same text.
import type {YesterdayView} from './api.ts'
import {keySize} from './puzzle.ts'

export type ShareInput = {
  number: number // puzzle number since launch
  label?: string | undefined // v0.5: replaces "Lampwright #<number>" (community boards)
  par: number
  best: number // the player's fewest mirrors (0 = unsolved)
  routes: readonly string[] // the player's solution keys for the day
  parRoutes: number // par routes that exist (lower bound when not exact)
  parRoutesExact: boolean
  streak: number
}

const FOUND = '◆' // black diamond
const OPEN = '◇' // white diamond
const MAX_DIAMONDS = 12

/** What community board posts are called in results and comments. */
export const BOARD_LABEL = 'Lampwright community board'

/** How many distinct par routes this player found. */
export function myParRoutes(routes: readonly string[], par: number): number {
  return new Set(routes.filter(k => keySize(k) === par)).size
}

/**
 * Markdown for the comment. Never contains where the mirrors go: only counts.
 * Lines are separated by blank lines so Reddit keeps them apart.
 */
export function shareText(s: ShareInput): string {
  if (s.best <= 0) throw Error('nothing to share before a solve')
  const name = s.label ?? `Lampwright #${s.number}`
  const lines: string[] = []
  lines.push(
    s.best <= s.par
      ? `${name}: par! Every crystal lit with ${s.best} mirror${s.best === 1 ? '' : 's'}.`
      : `${name}: every crystal lit with ${s.best} mirrors (par ${s.par}).`,
  )
  const mine = myParRoutes(s.routes, s.par)
  if (mine > 0) {
    const total = Math.max(s.parRoutes, mine)
    const shown = Math.min(total, MAX_DIAMONDS)
    const diamonds =
      FOUND.repeat(Math.min(mine, shown)) +
      OPEN.repeat(Math.max(0, shown - mine))
    const of = s.parRoutesExact ? String(total) : `${total}+`
    lines.push(
      `${diamonds} I found ${mine} of ${of} par route${total === 1 ? '' : 's'}.`,
    )
  }
  if (s.streak > 1) lines.push(`Daily streak: ${s.streak} days.`)
  return lines.join('\n\n')
}

/** One line about the day before, counts only (never positions). '' when there is none. */
export function yesterdayLine(y: YesterdayView | null): string {
  if (!y) return ''
  const total = y.parRoutesExact ? String(y.parRoutes) : `${y.parRoutes}+`
  if (y.solvers === 0)
    return `Yesterday, #${y.number}: nobody solved it. Its par routes are on yesterday's post.`
  const who = `${y.solvers} solver${y.solvers === 1 ? '' : 's'}`
  const routes = `${y.parFound} of ${total} par route${y.parRoutes === 1 ? '' : 's'}`
  return `Yesterday, #${y.number}: ${who} found ${routes}. See them all on yesterday's post.`
}
