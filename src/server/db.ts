// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Lampwright storage on Devvit Redis. Keys are scoped to the installation.
//
// Data kept about players (Devvit Rules: minimise, and delete within 30 days):
// - u:<t2>:<day>  the player's best and routes for one day      expires 30 days after their last solve that day
// - u:<t2>        last solve day and streak                      expires 30 days after their last solve
// - d:<day>:first first finder of each route ("<ms>|<username>") expires 30 days after the latest first find
// - d:<day>:shared players who posted a result comment            expires 30 days after the latest share
// - bposts:<day>  players who posted a community board that day  expires 2 days after the latest board
// Everything else is anonymous counts (solvers, histogram, players per route).
// v0.5: a community board is stored like a day under its board id "b-<post>", and is
// deleted with its counts when its post is deleted.
// v0.8: "featured" names the board post a moderator pinned last (a post, not a person).
import {redis} from '@devvit/web/server'
import type {BoardSummary, DayStats, MyDay} from '../shared/api.ts'
import {boardIdFor} from '../shared/board.ts'
import type {Puzzle} from '../shared/puzzle.ts'
import {
  crystals,
  dayDiff,
  generate,
  keySize,
  search,
  solutionKey,
} from '../shared/puzzle.ts'

export type DayRecord = {puzzle: Puzzle; parKeys: string[]; exact: boolean}

/** Seconds that player-linked data lives after it was last written. */
export const PLAYER_TTL = 30 * 24 * 60 * 60

/** A daily-post claim older than this with no post recorded may be taken over by a retry. */
export const CLAIM_STALE_MS = 5 * 60 * 1000

/** Most par routes a reveal lists. */
export const MAX_REVEAL = 24

/** Community boards: one per player per UTC day, and at most this many per subreddit per day. */
export const MAX_BOARDS_PER_DAY = 30

/** Seconds the record of who posted a board on a day is kept (only to enforce one a day). */
export const BOARD_CLAIM_TTL = 2 * 24 * 60 * 60

/** Newest community boards listed in the builder. */
export const RECENT_BOARDS = 20

const keyPuzzle = (day: string): string => `puz:${day}`
const keyPost = (t3: string): string => `post:${t3}`
const keySticky = (t3: string): string => `sticky:${t3}`
const keyDaily = 'daily-posts'
const keySolvers = (day: string): string => `d:${day}:solvers`
const keyHist = (day: string): string => `d:${day}:hist`
const keyRoutes = (day: string): string => `d:${day}:routes`
const keyFirst = (day: string): string => `d:${day}:first`
const keyShared = (day: string): string => `d:${day}:shared`
const keyMe = (user: string, day: string): string => `u:${user}:${day}`
const keyUser = (user: string): string => `u:${user}`
const keyBoardPosts = (day: string): string => `bposts:${day}`
const keyRecentBoards = 'boards:recent'
const keyFeatured = 'featured'

/** The day's puzzle and every par route, generated once and cached. */
export async function dbDay(day: string): Promise<DayRecord> {
  const cached = await dbDayIfCached(day)
  if (cached) return cached
  const puzzle = generate(day)
  const r = search(puzzle, puzzle.par, 64, 3_000_000)
  const rec: DayRecord = {
    puzzle,
    parKeys: r.solutions.map(solutionKey).sort(),
    exact: r.complete,
  }
  await redis.set(keyPuzzle(day), JSON.stringify(rec))
  return rec
}

/** The day's (or board's) record only if it was already stored (never generates). */
export async function dbDayIfCached(
  day: string,
): Promise<DayRecord | undefined> {
  const cached = await redis.get(keyPuzzle(day))
  return cached ? (JSON.parse(cached) as DayRecord) : undefined
}

export async function dbPostDay(t3: string): Promise<string | undefined> {
  return redis.get(keyPost(t3))
}

export async function dbSetPostDay(t3: string, day: string): Promise<void> {
  await redis.set(keyPost(t3), day)
}

/** The app's pinned "share your result here" comment on a post, if any. */
export async function dbSticky(t3: string): Promise<string | undefined> {
  return redis.get(keySticky(t3))
}

export async function dbSetSticky(t3: string, t1: string): Promise<void> {
  await redis.set(keySticky(t3), t1)
}

/** A deleted post: forget its day and its pinned comment. Safe to call twice. */
export async function dbForgetPost(t3: string): Promise<void> {
  await redis.del(keyPost(t3), keySticky(t3))
}

/** The pinned comment was deleted: the next share makes a new one. */
export async function dbForgetSticky(t3: string): Promise<void> {
  await redis.del(keySticky(t3))
}

/**
 * Claims the daily post for a day. The claim reads "pending:<ms>" until the post
 * exists, then the post id. A retry may take over a pending claim older than
 * CLAIM_STALE_MS (the first attempt died before it could release it).
 */
export async function dbClaimDaily(
  day: string,
  nowMs: number,
): Promise<boolean> {
  const pending = `pending:${nowMs}`
  if ((await redis.hSetNX(keyDaily, day, pending)) === 1) return true
  const v = await redis.hGet(keyDaily, day)
  if (v === undefined) return (await redis.hSetNX(keyDaily, day, pending)) === 1
  if (!v.startsWith('pending:')) return false
  const since = Number(v.slice('pending:'.length))
  if (Number.isFinite(since) && nowMs - since < CLAIM_STALE_MS) return false
  await redis.hSet(keyDaily, {[day]: pending})
  return true
}

/** Records the day's post once it exists, so later retries do nothing. */
export async function dbDoneDaily(day: string, t3: string): Promise<void> {
  await redis.hSet(keyDaily, {[day]: t3})
}

export async function dbReleaseDaily(day: string): Promise<void> {
  await redis.hDel(keyDaily, [day])
}

/** Par-sized routes any player found on a day. */
async function foundParKeys(day: string, par: number): Promise<string[]> {
  const routes = await redis.hGetAll(keyRoutes(day))
  return Object.keys(routes).filter(
    k => keySize(k) === par && Number(routes[k]) > 0,
  )
}

/** Every known par route of a past day (solver's list plus any players found), and which were found. */
export async function dbReveal(
  rec: DayRecord,
): Promise<{keys: string[]; found: boolean[]}> {
  const found = await foundParKeys(rec.puzzle.id, rec.puzzle.par)
  const keys = [...new Set([...rec.parKeys, ...found])]
    .sort()
    .slice(0, MAX_REVEAL)
  const foundSet = new Set(found)
  return {keys, found: keys.map(k => foundSet.has(k))}
}

export async function dbStats(rec: DayRecord): Promise<DayStats> {
  const day = rec.puzzle.id
  const par = rec.puzzle.par
  const [solversRaw, hist, routes, first] = await Promise.all([
    redis.get(keySolvers(day)),
    redis.hGetAll(keyHist(day)),
    redis.hGetAll(keyRoutes(day)),
    redis.hGetAll(keyFirst(day)),
  ])
  const histogram: {[m: string]: number} = {}
  for (const [m, n] of Object.entries(hist)) {
    const v = Number(n)
    if (v > 0) histogram[m] = v
  }
  const parFoundKeys = Object.keys(routes).filter(
    k => keySize(k) === par && Number(routes[k]) > 0,
  )
  const finders = parFoundKeys
    .map(k => {
      const v = first[k] ?? ''
      const bar = v.indexOf('|')
      return bar < 0
        ? {t: Number.MAX_SAFE_INTEGER, name: ''}
        : {t: Number(v.slice(0, bar)), name: v.slice(bar + 1)}
    })
    .sort((a, b) => a.t - b.t)
    .map(f => f.name)
  const known = new Set([...rec.parKeys, ...parFoundKeys])
  return {
    solvers: Number(solversRaw ?? 0),
    atPar: histogram[String(par)] ?? 0,
    parRoutes: known.size,
    parRoutesExact: rec.exact,
    parFound: parFoundKeys.length,
    firstFinders: finders,
    histogram,
  }
}

type MeRecord = {best: number; routes: string[]}

async function readMe(user: string, day: string): Promise<MeRecord> {
  const raw = await redis.get(keyMe(user, day))
  return raw ? (JSON.parse(raw) as MeRecord) : {best: 0, routes: []}
}

async function readStreak(user: string, today: string): Promise<number> {
  const u = await redis.hGetAll(keyUser(user))
  const last = u.last
  const streak = Number(u.streak ?? 0)
  if (!last) return 0
  const gap = dayDiff(last, today)
  return gap === 0 || gap === 1 ? streak : 0
}

export async function dbMe(
  user: string | undefined,
  username: string,
  day: string,
  today: string,
): Promise<MyDay> {
  if (!user)
    return {
      loggedIn: false,
      username: '',
      solved: false,
      best: 0,
      routes: [],
      streak: 0,
      shared: false,
    }
  const [me, streak, shared] = await Promise.all([
    readMe(user, day),
    readStreak(user, today),
    redis.hGet(keyShared(day), user),
  ])
  return {
    loggedIn: true,
    username,
    solved: me.best > 0 || me.routes.length > 0,
    best: me.best,
    routes: me.routes,
    streak,
    shared: shared !== undefined,
  }
}

export type RecordResult = {
  newForMe: boolean
  firstFinder: boolean
  routeCount: number
}

/** Record a verified solve. `mirrors` and `key` come from checkSubmission. */
export async function dbRecordSolve(
  user: string,
  username: string,
  rec: DayRecord,
  mirrors: number,
  key: string,
  today: string,
): Promise<RecordResult> {
  const day = rec.puzzle.id
  const me = await readMe(user, day)
  const firstSolve = me.routes.length === 0
  const newForMe = !me.routes.includes(key)
  if (firstSolve) await redis.incrBy(keySolvers(day), 1)
  if (firstSolve || mirrors < me.best) {
    if (!firstSolve) await redis.hIncrBy(keyHist(day), String(me.best), -1)
    await redis.hIncrBy(keyHist(day), String(mirrors), 1)
    me.best = mirrors
  }
  let firstFinder = false
  let routeCount = 0
  if (newForMe) {
    me.routes.push(key)
    routeCount = await redis.hIncrBy(keyRoutes(day), key, 1)
    firstFinder =
      (await redis.hSetNX(keyFirst(day), key, `${Date.now()}|${username}`)) ===
      1
    if (firstFinder) await redis.expire(keyFirst(day), PLAYER_TTL)
  } else {
    routeCount = Number((await redis.hGet(keyRoutes(day), key)) ?? 0)
  }
  await redis.set(keyMe(user, day), JSON.stringify(me))
  await redis.expire(keyMe(user, day), PLAYER_TTL)
  // only a daily puzzle solved on its own day moves the streak (never a community board)
  if (firstSolve && day === today) {
    const u = await redis.hGetAll(keyUser(user))
    const gap = u.last ? dayDiff(u.last, today) : -1
    const streak =
      gap === 1
        ? Number(u.streak ?? 0) + 1
        : gap === 0
          ? Number(u.streak ?? 1)
          : 1
    await redis.hSet(keyUser(user), {last: today, streak: String(streak)})
    await redis.expire(keyUser(user), PLAYER_TTL)
  }
  return {newForMe, firstFinder, routeCount}
}

/** Claims the player's one result comment for a day. False if already claimed. */
export async function dbClaimShare(
  user: string,
  day: string,
): Promise<boolean> {
  const ok =
    (await redis.hSetNX(keyShared(day), user, String(Date.now()))) === 1
  if (ok) await redis.expire(keyShared(day), PLAYER_TTL)
  return ok
}

export async function dbReleaseShare(user: string, day: string): Promise<void> {
  await redis.hDel(keyShared(day), [user])
}

// ---- community boards (v0.5) ---------------------------------------------

type RecentBoard = {
  postId: string
  url: string
  par: number
  crystals: number
  at: number
}

/**
 * Claims the player's one community board for a UTC day. 'again' if they already
 * posted one, 'full' if the subreddit reached MAX_BOARDS_PER_DAY.
 */
export async function dbClaimBoardPost(
  user: string,
  day: string,
  nowMs: number,
): Promise<'ok' | 'again' | 'full'> {
  const key = keyBoardPosts(day)
  const all = await redis.hGetAll(key)
  if (all[user] !== undefined) return 'again'
  if (Object.keys(all).length >= MAX_BOARDS_PER_DAY) return 'full'
  const ok = (await redis.hSetNX(key, user, String(nowMs))) === 1
  await redis.expire(key, BOARD_CLAIM_TTL)
  return ok ? 'ok' : 'again'
}

/** The post failed: the player may try again the same day. */
export async function dbReleaseBoardPost(
  user: string,
  day: string,
): Promise<void> {
  await redis.hDel(keyBoardPosts(day), [user])
}

async function readRecent(): Promise<RecentBoard[]> {
  const raw = await redis.get(keyRecentBoards)
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v as RecentBoard[]) : []
  } catch {
    return []
  }
}

/** Stores a just-posted board under its post and lists it first among recent boards. */
export async function dbSaveBoard(
  t3: string,
  rec: DayRecord,
  url: string,
  nowMs: number,
): Promise<void> {
  await redis.set(keyPuzzle(rec.puzzle.id), JSON.stringify(rec))
  await redis.set(keyPost(t3), rec.puzzle.id)
  const entry: RecentBoard = {
    postId: t3,
    url,
    par: rec.puzzle.par,
    crystals: crystals(rec.puzzle).length,
    at: nowMs,
  }
  const list = (await readRecent()).filter(b => b.postId !== t3)
  await redis.set(
    keyRecentBoards,
    JSON.stringify([entry, ...list].slice(0, RECENT_BOARDS)),
  )
}

/** The newest community boards with their solver counts. */
export async function dbRecentBoards(): Promise<BoardSummary[]> {
  const list = await readRecent()
  const solvers = await Promise.all(
    list.map(b => redis.get(keySolvers(boardIdFor(b.postId)))),
  )
  return list.map((b, k) => ({...b, solvers: Number(solvers[k] ?? 0)}))
}

/**
 * A post was deleted. If it was a community board, its board, its counts, its
 * first-finder names and its share list go, and it leaves the recent list.
 * Safe for any post and safe to call twice.
 */
export async function dbForgetBoard(t3: string): Promise<void> {
  const id = boardIdFor(t3)
  await redis.del(
    keyPuzzle(id),
    keySolvers(id),
    keyHist(id),
    keyRoutes(id),
    keyFirst(id),
    keyShared(id),
  )
  const list = await readRecent()
  if (list.some(b => b.postId === t3))
    await redis.set(
      keyRecentBoards,
      JSON.stringify(list.filter(b => b.postId !== t3)),
    )
}

// ---- featured board (v0.8) -------------------------------------------------

/** The board post a moderator featured last (not player data: it names a post, not a person). */
export async function dbFeatured(): Promise<string | undefined> {
  return redis.get(keyFeatured)
}

export async function dbSetFeatured(t3: string): Promise<void> {
  await redis.set(keyFeatured, t3)
}

/** The featured post was deleted: forget it so nothing tries to unpin it later. */
export async function dbForgetFeatured(t3: string): Promise<void> {
  if ((await redis.get(keyFeatured)) === t3) await redis.del(keyFeatured)
}
