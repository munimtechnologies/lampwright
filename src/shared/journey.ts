// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Lampwright's Devvit Journeys rules, kept free of Reddit imports so they can be tested in Node.
//
// A journey is one attempt at the post's puzzle:
// - it starts on the player's first placed mirror, a committed action (never on a view or page load);
// - it reports progress only when more crystals glow than ever before in this journey, so there is at most one
//   progress event per crystal (a puzzle has 3 to 6), never one per tap;
// - it ends when a result is locked in: complete, with win = at par and score = mirrors used (fewer is better).
// After a lock-in, the next placed mirror (the player hunting another route) starts a new journey.

export type JourneyAction = 'lock_in' | 'share' | 'help' | 'join' | 'play_again'

export type JourneyEvent =
  | {kind: 'start'}
  | {
      kind: 'progress'
      progress: number
      action: 'crystals_lit'
      actionDetails: string
    }
  | {kind: 'interaction'; action: JourneyAction}
  | {kind: 'end'; complete: boolean; game: {win: boolean; score: number}}

/** Share of crystals lit, as Journeys wants it: 0.1 to 1, two decimals. */
export function progressOf(lit: number, total: number): number {
  if (!(total > 0)) return 0.1
  const f = Math.round((Math.max(0, Math.min(lit, total)) / total) * 100) / 100
  return Math.max(0.1, Math.min(1, f))
}

export class JourneyRules {
  #active = false
  #best = 0

  get active(): boolean {
    return this.#active
  }

  /** The player placed, flipped or removed a mirror (or undid one); `lit` crystals now glow out of `total`. */
  changed(lit: number, total: number): JourneyEvent[] {
    const out: JourneyEvent[] = []
    if (!this.#active) {
      this.#active = true
      this.#best = 0
      out.push({kind: 'start'})
    }
    if (total > 0 && lit > this.#best) {
      this.#best = Math.min(lit, total)
      out.push({
        kind: 'progress',
        progress: progressOf(this.#best, total),
        action: 'crystals_lit',
        actionDetails: `${this.#best}/${total}`,
      })
    }
    return out
  }

  /** A result was saved by the server. Ends the journey once; a second call without a new start sends nothing. */
  lockedIn(mirrors: number, par: number): JourneyEvent[] {
    if (!this.#active) return []
    this.#active = false
    return [
      {kind: 'interaction', action: 'lock_in'},
      {
        kind: 'end',
        complete: true,
        game: {win: mirrors <= par, score: mirrors},
      },
    ]
  }

  /** A tap on one of the few buttons worth counting (share, help, join, play again). */
  interaction(action: Exclude<JourneyAction, 'lock_in'>): JourneyEvent[] {
    return [{kind: 'interaction', action}]
  }
}
