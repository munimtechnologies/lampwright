// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Sends Lampwright's journey events (see src/shared/journey.ts) to Devvit Journeys, in order, one at a time.
// Telemetry never blocks or breaks play: every call is chained and every failure is swallowed.
// v0.8b: the analytics client is loaded on the first event, like the SDK in consent.ts, so a module that
// cannot start (for example outside Reddit) costs the journey, never the game.
import type {JourneyEvent} from '../shared/journey.ts'

type Telemetry = typeof import('@devvit/analytics/client/reddit')['telemetry']

let client: Promise<Telemetry> | undefined
let chain: Promise<unknown> = Promise.resolve()

function load(): Promise<Telemetry> {
  client ??= import('@devvit/analytics/client/reddit').then(m => m.telemetry)
  return client
}

function queue(call: (t: Telemetry) => Promise<unknown>): void {
  chain = chain
    .then(() => load())
    .then(call)
    .catch(() => undefined)
}

function one(t: Telemetry, e: JourneyEvent): Promise<unknown> {
  switch (e.kind) {
    case 'start':
      return t.startJourney()
    case 'progress':
      return t.progress({
        progress: e.progress,
        action: e.action,
        actionDetails: e.actionDetails,
      })
    case 'interaction':
      return t.interaction({action: e.action})
    case 'end':
      return t.endJourney({complete: e.complete, game: e.game})
  }
}

export function sendJourney(events: JourneyEvent[]): void {
  for (const e of events) queue(t => one(t, e))
}

/** Once, when the board is on screen and playable. */
export function sendAppReady(): void {
  queue(t => t.appReady())
}
