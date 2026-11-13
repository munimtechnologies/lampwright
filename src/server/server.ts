// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Lampwright request handler for Devvit Web (plain Node HTTP).
import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {telemetryRouter} from '@devvit/analytics/server/reddit'
import {context, reddit} from '@devvit/web/server'
import type {
  OnCommentDeleteRequest,
  OnPostDeleteRequest,
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from '@devvit/web/shared'
import express from 'express'
import type {
  BoardPostRsp,
  BoardsRsp,
  ErrorRsp,
  JoinRsp,
  PuzzleView,
  RevealRsp,
  ShareRsp,
  SubmitRsp,
  TodayRsp,
  YesterdayView,
} from '../shared/api.ts'
import {Endpoint, EndpointMethod} from '../shared/api.ts'
import {
  boardFallback,
  boardIdFor,
  boardText,
  boardTitle,
  checkBoard,
  isBoardId,
} from '../shared/board.ts'
import {
  addDays,
  checkSubmission,
  dayDiff,
  dayId,
  isDayId,
  parseKey,
} from '../shared/puzzle.ts'
import {BOARD_LABEL, shareText} from '../shared/share.ts'
import {
  type DayRecord,
  dbClaimBoardPost,
  dbClaimDaily,
  dbClaimShare,
  dbDay,
  dbDayIfCached,
  dbDoneDaily,
  dbFeatured,
  dbForgetBoard,
  dbForgetFeatured,
  dbForgetPost,
  dbForgetSticky,
  dbMe,
  dbPostDay,
  dbRecentBoards,
  dbRecordSolve,
  dbReleaseBoardPost,
  dbReleaseDaily,
  dbReleaseShare,
  dbReveal,
  dbSaveBoard,
  dbSetFeatured,
  dbSetPostDay,
  dbSetSticky,
  dbStats,
  dbSticky,
} from './db.ts'

/** Day 1 of Lampwright. */
export const LAUNCH_DAY = '2026-11-12'

type T1 = `t1_${string}`
type T3 = `t3_${string}`
type AnyRsp =
  | ErrorRsp
  | TodayRsp
  | SubmitRsp
  | ShareRsp
  | RevealRsp
  | BoardPostRsp
  | BoardsRsp
  | JoinRsp
  | UiResponse
  | TriggerResponse

/** Overridable clock so tests can move between days. */
export const clock = {now: (): Date => new Date()}

/** v0.7: Devvit Journeys events go to Reddit's own telemetry router (it validates them itself). */
const telemetryApp = express().use(telemetryRouter)

export async function onReq(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  // v0.7: Devvit Journeys events from the client go to Reddit's own telemetry router
  if ((reqMsg.url ?? '').startsWith('/api/telemetry/')) {
    telemetryApp(reqMsg, rspMsg)
    return
  }
  let rsp: AnyRsp
  try {
    rsp = await route(reqMsg)
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`
    console.error(msg)
    rsp = {error: 'server error', status: 500}
  }
  writeJson('status' in rsp ? rsp.status : 200, rsp, rspMsg)
}

function isEndpoint(s: string): s is Endpoint {
  return (Object.values(Endpoint) as string[]).includes(s)
}

async function route(req: IncomingMessage): Promise<AnyRsp> {
  const path = (req.url ?? '/').split('?')[0]?.replace(/^\/+/, '') ?? ''
  if (!isEndpoint(path) || EndpointMethod[path] !== req.method)
    return {error: 'not found', status: 404}
  switch (path) {
    case Endpoint.Today:
      return routeToday()
    case Endpoint.Submit:
      return routeSubmit(req)
    case Endpoint.Share:
      return routeShare(req)
    case Endpoint.Reveal:
      return routeReveal(req)
    case Endpoint.BoardPost:
      return routeBoardPost(req)
    case Endpoint.Boards:
      return routeBoards()
    case Endpoint.Join:
      return routeJoin()
    case Endpoint.OnMenuNewPost:
      return routeMenuNewPost()
    case Endpoint.OnMenuFeature:
      return routeMenuFeature(req)
    case Endpoint.OnAppInstall:
    case Endpoint.OnDailyPost:
    case Endpoint.OnDailyPostRetry:
      return routeDailyPost()
    case Endpoint.OnPostDelete:
      return routePostDelete(req)
    case Endpoint.OnCommentDelete:
      return routeCommentDelete(req)
    default:
      path satisfies never
      return {error: 'not found', status: 404}
  }
}

function view(rec: DayRecord): PuzzleView {
  const p = rec.puzzle
  return {
    id: p.id,
    w: p.w,
    h: p.h,
    rows: p.rows,
    dir: p.dir,
    budget: p.budget,
    par: p.par,
  }
}

function dayNumber(day: string): number {
  return dayDiff(LAUNCH_DAY, day) + 1
}

/**
 * What this post plays: a day id, or a community board id ("b-<post>").
 * A post with nothing stored plays today and keeps it.
 */
async function postScope(today: string): Promise<string> {
  const t3 = context.postId
  if (!t3) throw Error('no post')
  const stored = await dbPostDay(t3)
  if (stored && (isDayId(stored) || isBoardId(stored))) return stored
  await dbSetPostDay(t3, today)
  return today
}

/** The record a post plays. A day is generated on first use; a board only ever comes from storage. */
async function recFor(scope: string): Promise<DayRecord | undefined> {
  return isBoardId(scope) ? dbDayIfCached(scope) : dbDay(scope)
}

/** How results and comments name what was played. */
function labelFor(scope: string): string {
  return isBoardId(scope) ? BOARD_LABEL : `Lampwright #${dayNumber(scope)}`
}

/** Counts for the day before, if its puzzle was ever made (never generates one). */
async function yesterdayView(day: string): Promise<YesterdayView | null> {
  const rec = await dbDayIfCached(day)
  if (!rec) return null
  const s = await dbStats(rec)
  return {
    day,
    number: dayNumber(day),
    par: rec.puzzle.par,
    solvers: s.solvers,
    atPar: s.atPar,
    parFound: s.parFound,
    parRoutes: s.parRoutes,
    parRoutesExact: s.parRoutesExact,
  }
}

const GONE: ErrorRsp = {error: 'this board is no longer available', status: 404}

async function routeToday(): Promise<TodayRsp | ErrorRsp> {
  const today = dayId(clock.now())
  const scope = await postScope(today)
  const board = isBoardId(scope)
  const rec = await recFor(scope)
  if (!rec) return GONE
  const [stats, me, yesterday] = await Promise.all([
    dbStats(rec),
    dbMe(context.userId, context.username ?? '', scope, today),
    !board && scope === today
      ? yesterdayView(addDays(today, -1))
      : Promise.resolve(null),
  ])
  return {
    kind: board ? 'board' : 'daily',
    day: scope,
    number: board ? 0 : dayNumber(scope),
    isToday: !board && scope === today,
    puzzle: view(rec),
    stats,
    me,
    yesterday,
  }
}

async function routeSubmit(
  req: IncomingMessage,
): Promise<SubmitRsp | ErrorRsp> {
  const body = await readJson(req)
  if (typeof body !== 'object' || body === null)
    return {error: 'bad request', status: 400}
  const {day, placed} = body as {day: unknown; placed: unknown}
  const today = dayId(clock.now())
  const scope = await postScope(today)
  if (day !== scope) return {error: 'wrong day for this post', status: 400}
  const user = context.userId
  if (!user) return {error: 'log in to save your result', status: 401}
  const rec = await recFor(scope)
  if (!rec) return GONE
  const v = checkSubmission(rec.puzzle, placed)
  if (!v.ok) return {error: v.reason ?? 'bad submission', status: 400}
  const username = context.username ?? 'someone'
  let newForMe = false
  let firstFinder = false
  let routeCount = 0
  if (v.solved) {
    const r = await dbRecordSolve(user, username, rec, v.mirrors, v.key, today)
    newForMe = r.newForMe
    firstFinder = r.firstFinder
    routeCount = r.routeCount
  }
  const [stats, me] = await Promise.all([
    dbStats(rec),
    dbMe(user, username, scope, today),
  ])
  return {
    solved: v.solved,
    mirrors: v.mirrors,
    key: v.key,
    newForMe,
    firstFinder,
    routeShare: stats.solvers > 0 ? Math.min(1, routeCount / stats.solvers) : 0,
    stats,
    me,
  }
}

/**
 * A past day's par routes. Opens the day after (UTC), so today's puzzle is never
 * spoiled; only days whose puzzle was already made are answered. Not for boards.
 */
async function routeReveal(
  req: IncomingMessage,
): Promise<RevealRsp | ErrorRsp> {
  const asked = new URL(
    req.url ?? '/',
    'http://lampwright.invalid',
  ).searchParams.get('day')
  const today = dayId(clock.now())
  const t3 = context.postId
  const day = asked ?? (t3 ? await dbPostDay(t3) : undefined)
  if (!isDayId(day)) return {error: 'bad day', status: 400}
  if (dayDiff(day, today) < 1)
    return {error: 'par routes open the day after', status: 403}
  const rec = await dbDayIfCached(day)
  if (!rec) return {error: 'no puzzle stored for that day', status: 404}
  const r = await dbReveal(rec)
  return {
    day,
    par: rec.puzzle.par,
    routes: r.keys.map(parseKey),
    found: r.found,
    exact: rec.exact,
  }
}

const STICKY_TEXT = (label: string): string =>
  [
    `Share your ${label} result as a reply to this comment.`,
    'The Share button in the game posts a reply from your own account, only when you tap it.',
    'Shared results show counts only, never where the mirrors go.',
  ].join(' ')

/**
 * The app's pinned comment that result comments reply to (Devvit Rules: generic
 * score comments reply to one sticky comment). Created once per post.
 */
async function stickyFor(t3: string, label: string): Promise<T1> {
  const stored = await dbSticky(t3)
  if (stored) return stored as T1
  const c = await reddit.submitComment({
    id: t3 as T3,
    text: STICKY_TEXT(label),
    runAs: 'APP',
  })
  try {
    await c.distinguish(true)
  } catch (err) {
    console.error(
      `could not pin the share comment on ${t3}: ${err instanceof Error ? err.message : err}`,
    )
  }
  await dbSetSticky(t3, c.id)
  return c.id as T1
}

/**
 * Posts the player's spoiler-free result as a reply from their own account.
 * Only ever called from the in-game Share button after the player confirms.
 */
async function routeShare(req: IncomingMessage): Promise<ShareRsp | ErrorRsp> {
  const body = await readJson(req)
  if (typeof body !== 'object' || body === null)
    return {error: 'bad request', status: 400}
  const {day} = body as {day: unknown}
  const today = dayId(clock.now())
  const scope = await postScope(today)
  if (day !== scope) return {error: 'wrong day for this post', status: 400}
  const user = context.userId
  if (!user) return {error: 'log in to share your result', status: 401}
  const t3 = context.postId
  if (!t3) return {error: 'no post', status: 400}
  const rec = await recFor(scope)
  if (!rec) return GONE
  const board = isBoardId(scope)
  const [stats, me] = await Promise.all([
    dbStats(rec),
    dbMe(user, context.username ?? '', scope, today),
  ])
  if (!me.solved || me.best <= 0)
    return {error: 'solve the puzzle first', status: 400}
  if (!(await dbClaimShare(user, scope)))
    return {error: 'you already shared this puzzle', status: 409}
  const label = labelFor(scope)
  const text = shareText({
    number: board ? 0 : dayNumber(scope),
    label,
    par: rec.puzzle.par,
    best: me.best,
    routes: me.routes,
    parRoutes: stats.parRoutes,
    parRoutesExact: stats.parRoutesExact,
    streak: board ? 0 : me.streak,
  })
  try {
    const parent = await stickyFor(t3, label)
    const c = await reddit.submitComment({id: parent, text, runAs: 'USER'})
    return {commentId: c.id, text}
  } catch (err) {
    await dbReleaseShare(user, scope)
    throw err
  }
}

/**
 * v0.5: posts a player's board to the subreddit from their own account. Only ever
 * called from the builder's Post button, after the player has seen what it does and
 * Reddit has asked them for permission. The server re-checks the board itself.
 */
async function routeBoardPost(
  req: IncomingMessage,
): Promise<BoardPostRsp | ErrorRsp> {
  const body = await readJson(req)
  if (typeof body !== 'object' || body === null)
    return {error: 'bad request', status: 400}
  const user = context.userId
  if (!user) return {error: 'log in to post a board', status: 401}
  const check = checkBoard((body as {rows: unknown}).rows)
  if (!check.ok) return {error: check.reason, status: 400}
  const now = clock.now()
  const today = dayId(now)
  const claim = await dbClaimBoardPost(user, today, now.getTime())
  if (claim === 'again')
    return {error: 'you already posted a board today', status: 429}
  if (claim === 'full')
    return {
      error: 'this community has posted enough boards for today',
      status: 429,
    }
  let post: {id: string; url: string}
  try {
    post = await reddit.submitCustomPost({
      title: boardTitle(check.puzzle),
      runAs: 'USER',
      userGeneratedContent: {text: boardText(check.puzzle)},
      textFallback: {text: boardFallback(check.puzzle)},
    })
  } catch (err) {
    await dbReleaseBoardPost(user, today)
    throw err
  }
  const puzzle = {...check.puzzle, id: boardIdFor(post.id)}
  await dbSaveBoard(
    post.id,
    {puzzle, parKeys: check.parKeys, exact: check.exact},
    post.url,
    now.getTime(),
  )
  return {postId: post.id, url: post.url, par: puzzle.par}
}

async function routeBoards(): Promise<BoardsRsp> {
  return {boards: await dbRecentBoards()}
}

/** v0.7: subscribe the player to this subreddit. Only the result card's Join button calls this. */
async function routeJoin(): Promise<JoinRsp | ErrorRsp> {
  if (!context.userId) return {error: 'log in to join', status: 401}
  await reddit.subscribeToCurrentSubreddit()
  return {joined: true}
}

function prettyDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

async function createDayPost(day: string): Promise<{id: string; url: string}> {
  const n = dayNumber(day)
  const post = await reddit.submitCustomPost({
    title: `Lampwright #${n} (${prettyDay(day)}): bend the light through every crystal`,
    textFallback: {
      text: `Lampwright #${n}: today's light-and-mirror puzzle. Open the post in the Reddit app or on the web to play.`,
    },
  })
  await dbSetPostDay(post.id, day)
  try {
    await stickyFor(post.id, labelFor(day))
  } catch (err) {
    // the post still works; the pinned comment is made on the first share instead
    console.error(
      `share comment not created for ${post.id}: ${err instanceof Error ? err.message : err}`,
    )
  }
  return {id: post.id, url: post.url}
}

async function routeMenuNewPost(): Promise<UiResponse> {
  const post = await createDayPost(dayId(clock.now()))
  return {
    showToast: {text: `Post ${post.id} created.`, appearance: 'success'},
    navigateTo: post.url,
  }
}

function toast(text: string, appearance: 'neutral' | 'success'): UiResponse {
  return {showToast: {text, appearance}}
}

/**
 * v0.8: a moderator pins a community board (sticky slot 2), replacing the board
 * featured before. Daily posts and anything else are refused with a note.
 */
async function routeMenuFeature(req: IncomingMessage): Promise<UiResponse> {
  const body = (await readJson(req)) as {targetId?: unknown} | undefined
  const t3 = body?.targetId
  if (typeof t3 !== 'string' || !t3.startsWith('t3_'))
    return toast('Open this from a Lampwright post.', 'neutral')
  const scope = await dbPostDay(t3)
  if (!scope || !isBoardId(scope) || !(await dbDayIfCached(scope)))
    return toast('Only community boards can be featured.', 'neutral')
  const prev = await dbFeatured()
  if (prev === t3) return toast('This board is already featured.', 'neutral')
  try {
    await (await reddit.getPostById(t3 as T3)).sticky(2)
  } catch (err) {
    console.error(
      `could not pin ${t3}: ${err instanceof Error ? err.message : err}`,
    )
    return toast(
      'Could not pin this board right now. Try again in a minute.',
      'neutral',
    )
  }
  await dbSetFeatured(t3)
  if (prev) {
    try {
      await (await reddit.getPostById(prev as T3)).unsticky()
    } catch (err) {
      // already unpinned by hand or deleted; the new board is pinned either way
      console.error(
        `could not unpin ${prev}: ${err instanceof Error ? err.message : err}`,
      )
    }
  }
  return toast('Board featured: pinned to the top of the community.', 'success')
}

/**
 * Install trigger, daily scheduler and its two retries: one post per UTC day.
 * A retry does nothing once the day's post exists; it takes over only a claim
 * that failed or went stale without a post.
 */
async function routeDailyPost(): Promise<TriggerResponse> {
  const now = clock.now()
  const day = dayId(now)
  if (!(await dbClaimDaily(day, now.getTime()))) return {}
  let post: {id: string; url: string}
  try {
    post = await createDayPost(day)
  } catch (err) {
    await dbReleaseDaily(day)
    throw err
  }
  await dbDoneDaily(day, post.id)
  try {
    await dbDay(day) // warm the cache
  } catch (err) {
    console.error(
      `could not warm ${day}: ${err instanceof Error ? err.message : err}`,
    )
  }
  return {}
}

/**
 * A Lampwright post was deleted: drop what pointed at it, and if it was a
 * community board, the board and its counts too (Devvit Rules). Idempotent.
 */
async function routePostDelete(req: IncomingMessage): Promise<TriggerResponse> {
  const body = (await readJson(req)) as Partial<OnPostDeleteRequest> | undefined
  const t3 = body?.postId
  if (typeof t3 === 'string' && t3.startsWith('t3_')) {
    await dbForgetPost(t3)
    await dbForgetBoard(t3)
    await dbForgetFeatured(t3)
  }
  return {}
}

/** The pinned share comment was deleted: the next share makes a new one. Idempotent. */
async function routeCommentDelete(
  req: IncomingMessage,
): Promise<TriggerResponse> {
  const body = (await readJson(req)) as
    | Partial<OnCommentDeleteRequest>
    | undefined
  const t1 = body?.commentId
  const t3 = body?.postId
  if (typeof t1 !== 'string' || typeof t3 !== 'string') return {}
  if ((await dbSticky(t3)) === t1) await dbForgetSticky(t3)
  return {}
}

const MAX_BODY = 65_536

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size <= MAX_BODY) chunks.push(chunk)
  })
  await once(req, 'end')
  if (size > MAX_BODY) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

function writeJson<T extends PartialJsonValue>(
  status: number,
  json: T,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json)
  rsp.writeHead(status, {
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json',
  })
  rsp.end(body)
}
