// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Request and response shapes shared by the Lampwright client and server.
import type {Dir, Placement} from './puzzle.ts'

export const Endpoint = {
  Today: 'api/today',
  Submit: 'api/submit',
  Share: 'api/share',
  Reveal: 'api/reveal',
  BoardPost: 'api/board/post',
  Boards: 'api/boards',
  Join: 'api/join',
  OnAppInstall: 'internal/on/app/install',
  OnMenuNewPost: 'internal/on/menu/new-post',
  OnMenuFeature: 'internal/on/menu/feature',
  OnDailyPost: 'internal/scheduler/daily-post',
  OnDailyPostRetry: 'internal/scheduler/daily-post-retry',
  OnPostDelete: 'internal/on/post/delete',
  OnCommentDelete: 'internal/on/comment/delete',
} as const
export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint]

export const EndpointMethod = {
  [Endpoint.Today]: 'GET',
  [Endpoint.Submit]: 'POST',
  [Endpoint.Share]: 'POST',
  [Endpoint.Reveal]: 'GET',
  [Endpoint.BoardPost]: 'POST',
  [Endpoint.Boards]: 'GET',
  [Endpoint.Join]: 'POST',
  [Endpoint.OnAppInstall]: 'POST',
  [Endpoint.OnMenuNewPost]: 'POST',
  [Endpoint.OnMenuFeature]: 'POST',
  [Endpoint.OnDailyPost]: 'POST',
  [Endpoint.OnDailyPostRetry]: 'POST',
  [Endpoint.OnPostDelete]: 'POST',
  [Endpoint.OnCommentDelete]: 'POST',
} as const satisfies {[endpoint: string]: 'GET' | 'POST'}

/** Generic error detail for all responses. */
export type ErrorRsp = {error: string; status: number}

/** The puzzle as the client sees it (no answers). */
export type PuzzleView = {
  id: string
  w: number
  h: number
  rows: string[]
  dir: Dir
  budget: number
  par: number
}

/** Shared progress of everyone who played this day. */
export type DayStats = {
  solvers: number // players who solved it at least once
  atPar: number // players whose best equals par
  parRoutes: number // distinct par routes that exist (exact when parRoutesExact)
  parRoutesExact: boolean
  parFound: number // distinct par routes found by anyone
  firstFinders: string[] // usernames who first found each found par route, in order found ('' once expired)
  histogram: {[mirrors: string]: number} // players by best mirror count
}

export type MyDay = {
  loggedIn: boolean
  username: string
  solved: boolean
  best: number // fewest mirrors so far, 0 if unsolved
  routes: string[] // distinct solution keys this player found for this day
  streak: number // days in a row solved on the day itself
  shared: boolean // already posted a result comment for this day
}

/** How the community did on the day before (counts only). */
export type YesterdayView = {
  day: string
  number: number
  par: number
  solvers: number
  atPar: number
  parFound: number
  parRoutes: number
  parRoutesExact: boolean
}

export type TodayRsp = {
  kind: 'daily' | 'board' // v0.5: a board post plays a player-made board
  day: string // the day id, or the board id ("b-<post>") on a board post
  number: number // puzzle number since launch, 1-based (0 on a board post)
  isToday: boolean // always false on a board post
  puzzle: PuzzleView
  stats: DayStats
  me: MyDay
  yesterday: YesterdayView | null // only on today's post, once yesterday's puzzle exists
}

export type SubmitReq = {day: string; placed: Placement[]}

export type SubmitRsp = {
  solved: boolean
  mirrors: number
  key: string
  newForMe: boolean // first time this player found this route
  firstFinder: boolean // first player anywhere to find this route
  routeShare: number // fraction of solvers (0-1) who found this exact route
  stats: DayStats
  me: MyDay
}

/** Post the player's result as a comment from their own account (explicit button only). */
export type ShareReq = {day: string}

export type ShareRsp = {commentId: string; text: string}

/**
 * GET api/reveal?day=YYYY-MM-DD: a past day's par routes, from the day after it.
 * `found[k]` tells whether any player found `routes[k]`.
 */
export type RevealRsp = {
  day: string
  par: number
  routes: Placement[][]
  found: boolean[]
  exact: boolean
}

/** v0.5: post a painted board from the player's own account (explicit button only). */
export type BoardPostReq = {rows: string[]}

export type BoardPostRsp = {postId: string; url: string; par: number}

/** v0.5: the newest community boards in this subreddit (counts only, no usernames). */
export type BoardSummary = {
  postId: string
  url: string
  par: number
  crystals: number
  solvers: number
  at: number
}

export type BoardsRsp = {boards: BoardSummary[]}

/** v0.7: join this subreddit from the player's account (Join button only). */
export type JoinRsp = {joined: true}
