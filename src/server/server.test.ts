// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// End-to-end tests of the Lampwright request handler with an in-memory Redis.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import type {AddressInfo, Server} from 'node:net'
import {after, before, beforeEach, test} from 'node:test'
import {type Context, reddit, runWithContext} from '@devvit/web/server'
import type {
  ErrorRsp,
  JoinRsp,
  RevealRsp,
  ShareRsp,
  SubmitReq,
  SubmitRsp,
  TodayRsp,
} from '../shared/api.ts'
import {Endpoint} from '../shared/api.ts'
import type {Placement} from '../shared/puzzle.ts'
import {generate, search, solutionKey, trace} from '../shared/puzzle.ts'
import {CLAIM_STALE_MS, PLAYER_TTL} from './db.ts'
import {type FakeRedis, installFakeRedis} from './fake-redis.ts'
import {clock, onReq} from './server.ts'

type Ctx = {postId?: string; userId?: string; username?: string}
type SentComment = {
  id: string
  text: string
  runAs: string
  pinned: boolean
  newId: string
}
let ctx: Ctx = {}
let now = new Date('2026-11-20T12:00:00Z')
let fake: FakeRedis
let server: Server
let serverURL = ''
let failComments = false
let failPosts = false
const posts: {title: string}[] = []
const comments: SentComment[] = []
const savedSubmit = reddit.submitCustomPost
const savedComment = reddit.submitComment
const savedNow = clock.now

before(async () => {
  fake = installFakeRedis()
  clock.now = () => now
  reddit.submitCustomPost = (async (opts: {title: string}) => {
    if (failPosts) throw Error('posts are down')
    posts.push({title: opts.title})
    const id = `t3_new${posts.length}`
    return {id, url: `https://reddit.example/${id}`}
  }) as unknown as typeof reddit.submitCustomPost
  reddit.submitComment = (async (opts: {
    id: string
    text: string
    runAs?: string
  }) => {
    if (failComments) throw Error('comments are down')
    const sent: SentComment = {
      id: opts.id,
      text: opts.text,
      runAs: opts.runAs ?? 'APP',
      pinned: false,
      newId: `t1_c${comments.length + 1}`,
    }
    comments.push(sent)
    return {
      id: sent.newId,
      distinguish: async (sticky?: boolean) => {
        sent.pinned = sticky === true
      },
    }
  }) as unknown as typeof reddit.submitComment
  server = createServer((req, rsp) => {
    void runWithContext(
      {appName: 'lampwright', ...ctx} as unknown as Context,
      () => onReq(req, rsp),
    )
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  serverURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(() => {
  fake.clear()
  posts.length = 0
  comments.length = 0
  failComments = false
  failPosts = false
  now = new Date('2026-11-20T12:00:00Z')
  ctx = {postId: 't3_day', userId: 't2_alice', username: 'alice'}
})

after(() => {
  fake.restore()
  clock.now = savedNow
  reddit.submitCustomPost = savedSubmit
  reddit.submitComment = savedComment
  if (server.listening) server.close()
})

async function getToday(): Promise<TodayRsp> {
  const rsp = await fetch(`${serverURL}/${Endpoint.Today}`)
  assert.equal(rsp.status, 200)
  return (await rsp.json()) as TodayRsp
}

async function post<T>(
  endpoint: Endpoint,
  body: unknown,
): Promise<{status: number; body: T & ErrorRsp}> {
  const rsp = await fetch(`${serverURL}/${endpoint}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return {status: rsp.status, body: (await rsp.json()) as T & ErrorRsp}
}

function submit(
  day: string,
  placed: Placement[] | string,
): Promise<{status: number; body: SubmitRsp & ErrorRsp}> {
  return post<SubmitRsp>(Endpoint.Submit, {day, placed} as SubmitReq)
}

function share(
  day: string,
): Promise<{status: number; body: ShareRsp & ErrorRsp}> {
  return post<ShareRsp>(Endpoint.Share, {day})
}

async function reveal(
  day?: string,
): Promise<{status: number; body: RevealRsp & ErrorRsp}> {
  const q = day === undefined ? '' : `?day=${encodeURIComponent(day)}`
  const rsp = await fetch(`${serverURL}/${Endpoint.Reveal}${q}`)
  return {status: rsp.status, body: (await rsp.json()) as RevealRsp & ErrorRsp}
}

function parSolutions(day: string): Placement[][] {
  const p = generate(day)
  return search(p, p.par).solutions
}

test('today: a new post plays today and hides nothing it should not', async () => {
  const t = await getToday()
  assert.equal(t.day, '2026-11-20')
  assert.equal(t.number, 9)
  assert.equal(t.isToday, true)
  assert.equal(t.puzzle.id, '2026-11-20')
  assert.equal(t.puzzle.budget, t.puzzle.par + 1)
  assert.deepEqual(Object.keys(t.puzzle).sort(), [
    'budget',
    'dir',
    'h',
    'id',
    'par',
    'rows',
    'w',
  ])
  assert.equal(t.stats.solvers, 0)
  assert.equal(t.stats.parFound, 0)
  assert.ok(t.stats.parRoutes >= 1)
  assert.equal(t.me.loggedIn, true)
  assert.equal(t.me.solved, false)
  assert.equal(t.me.shared, false)
  assert.equal(t.yesterday, null) // nobody made Nov 19's puzzle
  // the post keeps its day after midnight
  now = new Date('2026-11-21T01:00:00Z')
  const later = await getToday()
  assert.equal(later.day, '2026-11-20')
  assert.equal(later.isToday, false)
  assert.equal(later.yesterday, null) // archive posts carry no summary
})

test('submit: a par solve is verified, counted once and credited', async () => {
  const t = await getToday()
  const sols = parSolutions(t.day)
  const first = sols[0] ?? []
  const a = await submit(t.day, first)
  assert.equal(a.status, 200)
  assert.equal(a.body.solved, true)
  assert.equal(a.body.mirrors, t.puzzle.par)
  assert.equal(a.body.newForMe, true)
  assert.equal(a.body.firstFinder, true)
  assert.equal(a.body.routeShare, 1)
  assert.equal(a.body.stats.solvers, 1)
  assert.equal(a.body.stats.atPar, 1)
  assert.equal(a.body.stats.parFound, 1)
  assert.deepEqual(a.body.stats.firstFinders, ['alice'])
  assert.equal(a.body.me.streak, 1)
  assert.equal(a.body.me.best, t.puzzle.par)
  // the same route again changes nothing
  const again = await submit(t.day, first)
  assert.equal(again.body.newForMe, false)
  assert.equal(again.body.firstFinder, false)
  assert.equal(again.body.stats.solvers, 1)
  // a second player finds the same route
  ctx = {postId: 't3_day', userId: 't2_bob', username: 'bob'}
  const b = await submit(t.day, first)
  assert.equal(b.body.firstFinder, false)
  assert.equal(b.body.newForMe, true)
  assert.equal(b.body.stats.solvers, 2)
  assert.equal(b.body.routeShare, 1)
  assert.deepEqual(b.body.stats.firstFinders, ['alice'])
  // a different par route, if the day has one, is a new discovery
  const second = sols[1]
  if (second) {
    const c = await submit(t.day, second)
    assert.equal(c.body.firstFinder, true)
    assert.equal(c.body.stats.parFound, 2)
    assert.equal(c.body.routeShare, 0.5)
    assert.deepEqual(c.body.stats.firstFinders, ['alice', 'bob'])
  }
})

test('privacy: player-linked keys expire within 30 days; counts do not', async () => {
  const t = await getToday()
  await submit(t.day, parSolutions(t.day)[0] ?? [])
  assert.equal(PLAYER_TTL, 30 * 24 * 60 * 60)
  assert.equal(fake.ttl.get(`u:t2_alice:${t.day}`), PLAYER_TTL)
  assert.equal(fake.ttl.get('u:t2_alice'), PLAYER_TTL)
  assert.equal(fake.ttl.get(`d:${t.day}:first`), PLAYER_TTL)
  assert.equal(fake.ttl.has(`d:${t.day}:hist`), false)
  // once the first-finder names expire, counts still add up and names read ''
  fake.hashes.delete(`d:${t.day}:first`)
  const later = await getToday()
  assert.equal(later.stats.parFound, 1)
  assert.deepEqual(later.stats.firstFinders, [''])
})

test('submit: a worse solve then a better one moves the histogram', async () => {
  const t = await getToday()
  const best = parSolutions(t.day)[0] ?? []
  // add a mirror the beam never touches: still par, same key
  const onPath = new Set(trace(generate(t.day), best).path)
  const unused = t.puzzle.rows
    .join('')
    .split('')
    .findIndex((c, i) => c === '.' && !onPath.has(i))
  assert.ok(unused >= 0)
  const padded = [...best, {i: unused, m: '/' as const}]
  const r = await submit(t.day, padded)
  assert.equal(r.body.solved, true)
  assert.equal(r.body.mirrors, t.puzzle.par)
  assert.deepEqual(r.body.stats.histogram, {[String(t.puzzle.par)]: 1})
})

test('submit: refuses bad input, wrong days and logged-out players', async () => {
  const t = await getToday()
  assert.equal((await submit(t.day, 'nope')).status, 400)
  assert.equal((await submit(t.day, [{i: 9999, m: '/'}])).status, 400)
  assert.equal((await submit('2026-11-19', [])).status, 400)
  const miss = await submit(t.day, [])
  assert.equal(miss.status, 200)
  assert.equal(miss.body.solved, false)
  assert.equal(miss.body.stats.solvers, 0)
  ctx = {postId: 't3_day'}
  assert.equal((await submit(t.day, [])).status, 401)
  const anon = await getToday()
  assert.equal(anon.me.loggedIn, false)
})

test('streak: solving on consecutive days counts up, a gap resets', async () => {
  for (const [k, day] of ['2026-11-20', '2026-11-21', '2026-11-23'].entries()) {
    now = new Date(`${day}T08:00:00Z`)
    ctx = {postId: `t3_d${k}`, userId: 't2_alice', username: 'alice'}
    const t = await getToday()
    assert.equal(t.day, day)
    const r = await submit(day, parSolutions(day)[0] ?? [])
    assert.equal(r.body.solved, true)
    assert.equal(r.body.me.streak, [1, 2, 1][k])
  }
})

test('share: posts one spoiler-free reply as the player under the pinned comment', async () => {
  const t = await getToday()
  // nothing to share before a solve, and never for logged-out players
  assert.equal((await share(t.day)).status, 400)
  assert.equal(comments.length, 0)
  const sol = parSolutions(t.day)[0] ?? []
  await submit(t.day, sol)
  const s = await share(t.day)
  assert.equal(s.status, 200)
  assert.equal(comments.length, 2)
  const [pin, mine] = comments
  // the app's pinned comment on the post, then the player's reply to it
  assert.equal(pin?.id, 't3_day')
  assert.equal(pin?.runAs, 'APP')
  assert.equal(pin?.pinned, true)
  assert.equal(mine?.id, pin?.newId)
  assert.equal(mine?.runAs, 'USER')
  assert.equal(mine?.text, s.body.text)
  assert.equal(s.body.commentId, mine?.newId)
  assert.match(
    s.body.text,
    /^Lampwright #9: par! Every crystal lit with \d mirrors?\./,
  )
  for (const pl of sol)
    assert.doesNotMatch(s.body.text, new RegExp(`\\b${pl.i}[sb]\\b`))
  // once per player per day
  assert.equal((await share(t.day)).status, 409)
  assert.equal((await getToday()).me.shared, true)
  assert.equal(fake.ttl.get(`d:${t.day}:shared`), PLAYER_TTL)
  // a second player reuses the same pinned comment
  ctx = {postId: 't3_day', userId: 't2_bob', username: 'bob'}
  await submit(t.day, sol)
  assert.equal((await share(t.day)).status, 200)
  assert.equal(comments.length, 3)
  assert.equal(comments[2]?.id, pin?.newId)
  ctx = {postId: 't3_day'}
  assert.equal((await share(t.day)).status, 401)
  assert.equal((await share('2026-11-19')).status, 400)
})

test('share: a failed comment can be retried', async () => {
  const t = await getToday()
  await submit(t.day, parSolutions(t.day)[0] ?? [])
  failComments = true
  assert.equal((await share(t.day)).status, 500)
  assert.equal((await getToday()).me.shared, false)
  failComments = false
  assert.equal((await share(t.day)).status, 200)
})

test('daily post: the scheduler and install trigger make one post per day, with its pinned comment', async () => {
  const opts = {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}',
  }
  assert.equal(
    (await fetch(`${serverURL}/${Endpoint.OnDailyPost}`, opts)).status,
    200,
  )
  assert.equal(
    (await fetch(`${serverURL}/${Endpoint.OnAppInstall}`, opts)).status,
    200,
  )
  assert.equal(posts.length, 1)
  assert.match(posts[0]?.title ?? '', /^Lampwright #9 \(Nov 20\)/)
  assert.equal(fake.strings.get('post:t3_new1'), '2026-11-20')
  assert.equal(comments.length, 1)
  assert.equal(comments[0]?.id, 't3_new1')
  assert.equal(comments[0]?.pinned, true)
  assert.match(comments[0]?.text ?? '', /reply to this comment/)
  assert.equal(fake.strings.get('sticky:t3_new1'), 't1_c1')
  now = new Date('2026-11-21T00:05:00Z')
  await fetch(`${serverURL}/${Endpoint.OnDailyPost}`, opts)
  assert.equal(posts.length, 2)
  // a post still goes up when comments fail
  failComments = true
  now = new Date('2026-11-22T00:05:00Z')
  assert.equal(
    (await fetch(`${serverURL}/${Endpoint.OnDailyPost}`, opts)).status,
    200,
  )
  assert.equal(posts.length, 3)
})

test('daily post retries: no-op after a post, recover a failed or stale claim, respect a fresh one', async () => {
  const opts = {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}',
  }
  const retry = async (): Promise<number> =>
    (await fetch(`${serverURL}/${Endpoint.OnDailyPostRetry}`, opts)).status
  // after a successful post, the claim holds the post id and retries do nothing
  now = new Date('2026-11-20T00:05:00Z')
  await fetch(`${serverURL}/${Endpoint.OnDailyPost}`, opts)
  assert.equal(fake.hashes.get('daily-posts')?.get('2026-11-20'), 't3_new1')
  now = new Date('2026-11-20T00:20:00Z')
  assert.equal(await retry(), 200)
  assert.equal(posts.length, 1)
  // the first attempt fails: the claim is released and the retry posts
  failPosts = true
  now = new Date('2026-11-21T00:05:00Z')
  assert.equal(
    (await fetch(`${serverURL}/${Endpoint.OnDailyPost}`, opts)).status,
    500,
  )
  assert.equal(fake.hashes.get('daily-posts')?.has('2026-11-21'), false)
  failPosts = false
  now = new Date('2026-11-21T00:20:00Z')
  assert.equal(await retry(), 200)
  assert.equal(posts.length, 2)
  assert.equal(fake.hashes.get('daily-posts')?.get('2026-11-21'), 't3_new2')
  // an attempt that died mid-way leaves a pending claim: a fresh one is respected...
  now = new Date('2026-11-22T00:20:00Z')
  fake.hashes
    .get('daily-posts')
    ?.set('2026-11-22', `pending:${now.getTime() - 60_000}`)
  assert.equal(await retry(), 200)
  assert.equal(posts.length, 2)
  // ...a stale one is taken over
  fake.hashes
    .get('daily-posts')
    ?.set('2026-11-22', `pending:${now.getTime() - CLAIM_STALE_MS - 1}`)
  assert.equal(await retry(), 200)
  assert.equal(posts.length, 3)
  assert.equal(fake.hashes.get('daily-posts')?.get('2026-11-22'), 't3_new3')
  // a v0.3 claim (a bare timestamp) counts as done
  now = new Date('2026-11-23T00:20:00Z')
  fake.hashes
    .get('daily-posts')
    ?.set('2026-11-23', String(now.getTime() - 3_600_000))
  assert.equal(await retry(), 200)
  assert.equal(posts.length, 3)
})

test('delete triggers: a deleted post and a deleted pinned comment are forgotten', async () => {
  const opts = {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}',
  }
  await fetch(`${serverURL}/${Endpoint.OnDailyPost}`, opts)
  assert.equal(fake.strings.get('sticky:t3_new1'), 't1_c1')
  // some other comment on the post: nothing changes
  const other = {
    type: 'CommentDelete',
    commentId: 't1_zzz',
    postId: 't3_new1',
    parentId: 't3_new1',
    source: 1,
    reason: 1,
  }
  assert.equal((await post(Endpoint.OnCommentDelete, other)).status, 200)
  assert.equal(fake.strings.get('sticky:t3_new1'), 't1_c1')
  // the pinned comment itself: forgotten, so the next share pins a new one
  const pinned = {...other, commentId: 't1_c1'}
  assert.equal((await post(Endpoint.OnCommentDelete, pinned)).status, 200)
  assert.equal(fake.strings.has('sticky:t3_new1'), false)
  ctx = {postId: 't3_new1', userId: 't2_alice', username: 'alice'}
  await submit('2026-11-20', parSolutions('2026-11-20')[0] ?? [])
  assert.equal((await share('2026-11-20')).status, 200)
  const newPin = comments[comments.length - 2]
  const reply = comments[comments.length - 1]
  assert.equal(newPin?.id, 't3_new1')
  assert.equal(newPin?.runAs, 'APP')
  assert.equal(reply?.id, newPin?.newId)
  assert.equal(reply?.runAs, 'USER')
  // the post is deleted: its day and pinned comment go; twice is fine; junk is ignored
  const del = {type: 'PostDelete', postId: 't3_new1', source: 1, reason: 1}
  assert.equal((await post(Endpoint.OnPostDelete, del)).status, 200)
  assert.equal((await post(Endpoint.OnPostDelete, del)).status, 200)
  assert.equal(fake.strings.has('post:t3_new1'), false)
  assert.equal(fake.strings.has('sticky:t3_new1'), false)
  assert.equal((await post(Endpoint.OnPostDelete, 'not json')).status, 200)
  assert.equal((await post(Endpoint.OnCommentDelete, {})).status, 200)
  // the day's counts are untouched
  assert.equal(fake.strings.get('d:2026-11-20:solvers'), '1')
})

test('yesterday and reveal: counts on the next day, par routes only after the day ends', async () => {
  const day = '2026-11-20'
  const t = await getToday()
  const sols = parSolutions(day)
  await submit(day, sols[0] ?? [])
  // the same day: no reveal, for this post or any later day
  assert.equal((await reveal(day)).status, 403)
  assert.equal((await reveal()).status, 403)
  assert.equal((await reveal('2026-11-21')).status, 403)
  // next day, on the new post: yesterday's counts, no positions
  now = new Date('2026-11-21T09:00:00Z')
  ctx = {postId: 't3_next', userId: 't2_bob', username: 'bob'}
  const next = await getToday()
  assert.equal(next.day, '2026-11-21')
  assert.deepEqual(next.yesterday, {
    day,
    number: 9,
    par: t.puzzle.par,
    solvers: 1,
    atPar: 1,
    parFound: 1,
    parRoutes: t.stats.parRoutes,
    parRoutesExact: t.stats.parRoutesExact,
  })
  // the reveal lists every par route, marks the found one, and each really solves
  const r = await reveal(day)
  assert.equal(r.status, 200)
  assert.equal(r.body.day, day)
  assert.equal(r.body.par, t.puzzle.par)
  assert.equal(r.body.routes.length, Math.min(24, t.stats.parRoutes))
  assert.equal(r.body.found.filter(f => f).length, 1)
  const p = generate(day)
  for (const route of r.body.routes) {
    const tr = trace(p, route)
    assert.equal(tr.solved, true)
    assert.equal(tr.used.length, p.par)
  }
  const foundKey = solutionKey(sols[0] ?? [])
  const k = r.body.routes.findIndex(route => solutionKey(route) === foundKey)
  assert.ok(k >= 0)
  assert.equal(r.body.found[k], true)
  // on the old post itself, with no day given
  ctx = {postId: 't3_day'}
  assert.equal((await reveal()).status, 200)
  // never for days nobody played, never for junk
  assert.equal((await reveal('2026-11-10')).status, 404)
  assert.equal((await reveal('soon')).status, 400)
  assert.equal(fake.strings.has('puz:2026-11-10'), false)
})

test('routing: unknown paths and wrong methods are 404', async () => {
  const wrong = await fetch(`${serverURL}/${Endpoint.Submit}`)
  assert.equal(wrong.status, 404)
  assert.deepEqual((await wrong.json()) as ErrorRsp, {
    error: 'not found',
    status: 404,
  })
  assert.equal((await fetch(`${serverURL}/${Endpoint.Share}`)).status, 404)
  assert.equal(
    (
      await fetch(`${serverURL}/${Endpoint.Reveal}`, {
        method: 'POST',
        body: '{}',
      })
    ).status,
    404,
  )
  assert.equal(
    (await fetch(`${serverURL}/${Endpoint.OnPostDelete}`)).status,
    404,
  )
  assert.equal((await fetch(`${serverURL}/`)).status, 404)
  assert.equal((await fetch(`${serverURL}/${Endpoint.Today}?x=1`)).status, 200)
})

test('join: subscribes the player only from a POST, never a logged-out visitor', async () => {
  const saved = reddit.subscribeToCurrentSubreddit
  let calls = 0
  reddit.subscribeToCurrentSubreddit = (async () => {
    calls++
  }) as typeof reddit.subscribeToCurrentSubreddit
  try {
    const ok = await post<JoinRsp>(Endpoint.Join, {})
    assert.equal(ok.status, 200)
    assert.equal(ok.body.joined, true)
    assert.equal(calls, 1)
    assert.equal((await fetch(`${serverURL}/${Endpoint.Join}`)).status, 404)
    ctx = {postId: 't3_day'}
    const anon = await post<JoinRsp>(Endpoint.Join, {})
    assert.equal(anon.status, 401)
    assert.equal(calls, 1)
  } finally {
    reddit.subscribeToCurrentSubreddit = saved
  }
})

test('telemetry: journey routes reach the Devvit router and bad events are refused', async () => {
  const rsp = await fetch(`${serverURL}/api/telemetry/journey/interaction`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}',
  })
  assert.equal(rsp.status, 400)
  const body = (await rsp.json()) as {receipt?: {status?: string}}
  assert.equal(body.receipt?.status, 'JOURNEY_RECEIPT_INVALID')
})
