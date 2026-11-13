// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// v0.6: time until the next daily puzzle post (00:05 UTC, see devvit.json's scheduler).
// v0.8: the splash uses the same text, so the post and the result card always agree.

/** Minute past midnight UTC at which the scheduler posts the day's puzzle. */
export const POST_MINUTE_UTC = 5

const DAY_MS = 86_400_000

/** Milliseconds from `now` until the next daily post, always in (0, 24h]. */
export function msToNextPuzzle(now: number): number {
  const d = new Date(now)
  let next = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    0,
    POST_MINUTE_UTC,
  )
  if (next <= now) next += DAY_MS
  return next - now
}

/** "Next puzzle in 9h 35m." / "Next puzzle in 3m." / "Next puzzle in under a minute." */
export function nextPuzzleText(now: number): string {
  const mins = Math.ceil(msToNextPuzzle(now) / 60_000)
  if (mins <= 1) return 'Next puzzle in under a minute.'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `Next puzzle in ${h}h ${m}m.` : `Next puzzle in ${m}m.`
}
