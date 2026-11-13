// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// v0.5 community boards through the real request handler, with an in-memory Redis
// and stand-ins for Reddit posts and comments.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import type {AddressInfo, Server} from 'node:net'
import {after, before, beforeEach, test} from 'node:test'
import {type Context, reddit, runWithContext} from '@devvit/web/server'
import type {
  BoardPostRsp,
  BoardsRsp,
  ErrorRsp,
  ShareRsp,
  SubmitRsp,
  TodayRsp,
} from '../shared/api.ts'
import {Endpoint} from '../shared/api.ts'
import {BOARD_CLAIM_TTL, MAX_BOARDS_PER_DAY} from './db.ts'
import {type FakeRedis, installFakeRedis} from './fake-redis.ts'
import {clock, onReq} from './server.ts'

type Ctx = {postId?: string; userId?: string; username?: string}
type SentPost = {title: string; runAs: string; ugc: string; fallback: string}
let ctx: Ctx = {}
let now = new Date('2026-11-20T12:00:00Z')
let fake: FakeRedis
let server: Server
let serverURL = ''
let failPosts = false
const posts: SentPost[] = []
const comments: {id: string; text: string; runAs: string}[] = []
const savedSubmit = reddit.submitCustomPost
const savedComment = reddit.submitComment
const savedNow = clock.now

// Lamp on the left edge of row 5 shining right; crystals at row 5 column 4 and row 2
// column 6. One '/' mirror on cell 33 (row 5, column 6) lights both: par 1, one route.
const BOARD = [
  '.......',
  '.....*.',
  '.......',
  '.......',
  'E..*...',
  '.......',
  '.......',
  '.......',
  '.......',
]

before(async () => {
  fake = installFakeRedis()
  clock.now = () => now
  reddit.submitCustomPost = (async (opts: {
    title: string
    runAs?: string
    userGeneratedContent?: {text: string}
    textFallback?: {text: string}
  }) => {
    if (failPosts) throw Error('posts are down')
    posts.push({
      title: opts.title,
      runAs: opts.runAs ?? 'APP',
      ugc: opts.userGeneratedContent?.text ?? '',
      fallback: opts.textFallback?.text ?? '',
    })
    const id = `t3_new${posts.length}`
    return {id, url: `https://reddit.example/${id}`}
  }) as unknown as typeof reddit.submitCustomPost
  reddit.submitComment = (async (opts: {
    id: string
    text: string
    runAs?: string
  }) => {
    comments.push({id: opts.id, text: opts.text, runAs: opts.runAs ?? 'APP'})
    return {id: `t1_c${comments.length}`, distinguish: async () => undefined}
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

async function get<T>(
  endpoint: Endpoint,
): Promise<{status: number; body: T & ErrorRsp}> {
  const rsp = await fetch(`${serverURL}/${endpoint}`)
  return {status: rsp.status, body: (await rsp.json()) as T & ErrorRsp}
}

function postBoard(
  rows: unknown,
): Promise<{status: number; body: BoardPostRsp & ErrorRsp}> {
  return post<BoardPostRsp>(Endpoint.BoardPost, {rows})
}

test('boards: a checked board is posted as the player, with its grid as user content', async () => {
  const r = await postBoard(BOARD)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, {
    postId: 't3_new1',
    url: 'https://reddit.example/t3_new1',
    par: 1,
  })
  assert.equal(posts.length, 1)
  const sent = posts[0]
  assert.equal(sent?.runAs, 'USER')
  assert.equal(
    sent?.title,
    'Lampwright community board: light 2 crystals, par 1',
  )
  assert.deepEqual(sent?.ugc.split('\n').slice(2), BOARD)
  assert.match(sent?.fallback ?? '', /par 1/)
  assert.equal(fake.strings.get('post:t3_new1'), 'b-new1')
  const stored = JSON.parse(fake.strings.get('puz:b-new1') ?? '{}') as {
    puzzle: {id: string; par: number}
    parKeys: string[]
  }
  assert.equal(stored.puzzle.id, 'b-new1')
  assert.deepEqual(stored.parKeys, ['33s'])
  // no comment is made when a board is posted
  assert.equal(comments.length, 0)
})

test('boards: one a day per player, kept two days; a failed post can be retried', async () => {
  failPosts = true
  assert.equal((await postBoard(BOARD)).status, 500)
  failPosts = false
  assert.equal((await postBoard(BOARD)).status, 200)
  const again = await postBoard(BOARD)
  assert.equal(again.status, 429)
  assert.match(again.body.error, /already posted a board today/)
  assert.equal(fake.ttl.get('bposts:2026-11-20'), BOARD_CLAIM_TTL)
  // another player may post the same day; the first player may post again tomorrow
  ctx = {postId: 't3_day', userId: 't2_bob', username: 'bob'}
  assert.equal((await postBoard(BOARD)).status, 200)
  ctx = {postId: 't3_day', userId: 't2_alice', username: 'alice'}
  now = new Date('2026-11-21T08:00:00Z')
  assert.equal((await postBoard(BOARD)).status, 200)
  assert.equal(posts.length, 3)
})

test('boards: a subreddit-wide daily cap', async () => {
  const day = new Map<string, string>()
  for (let k = 0; k < MAX_BOARDS_PER_DAY; k++) day.set(`t2_p${k}`, '1')
  fake.hashes.set('bposts:2026-11-20', day)
  const r = await postBoard(BOARD)
  assert.equal(r.status, 429)
  assert.match(r.body.error, /enough boards for today/)
  assert.equal(posts.length, 0)
})

test('boards: refuses junk, unsolvable boards and logged-out players, and posts nothing', async () => {
  assert.equal((await post(Endpoint.BoardPost, 'nope')).status, 400)
  assert.equal((await postBoard(['E'])).status, 400)
  const easy = await postBoard(
    BOARD.map((r, k) => (k === 1 ? '.......' : k === 4 ? 'E..*.*.' : r)),
  )
  assert.equal(easy.status, 400)
  assert.match(easy.body.error, /without a mirror/)
  ctx = {postId: 't3_day'}
  assert.equal((await postBoard(BOARD)).status, 401)
  assert.equal(posts.length, 0)
  assert.equal(fake.hashes.has('bposts:2026-11-20'), false)
})

test('boards: the post plays the board, apart from the daily streak, and shares as a board', async () => {
  await postBoard(BOARD)
  ctx = {postId: 't3_new1', userId: 't2_bob', username: 'bob'}
  const t = (await get<TodayRsp>(Endpoint.Today)).body
  assert.equal(t.kind, 'board')
  assert.equal(t.day, 'b-new1')
  assert.equal(t.number, 0)
  assert.equal(t.isToday, false)
  assert.equal(t.yesterday, null)
  assert.equal(t.puzzle.par, 1)
  assert.equal(t.puzzle.budget, 2)
  assert.deepEqual(t.puzzle.rows, BOARD)
  assert.equal(t.stats.parRoutes, 1)
  assert.equal(t.stats.parRoutesExact, true)
  // a daily day id is refused on a board post
  assert.equal(
    (await post(Endpoint.Submit, {day: '2026-11-20', placed: []})).status,
    400,
  )
  const s = await post<SubmitRsp>(Endpoint.Submit, {
    day: 'b-new1',
    placed: [{i: 33, m: '/'}],
  })
  assert.equal(s.status, 200)
  assert.equal(s.body.solved, true)
  assert.equal(s.body.mirrors, 1)
  assert.equal(s.body.firstFinder, true)
  assert.equal(s.body.stats.solvers, 1)
  assert.deepEqual(s.body.stats.firstFinders, ['bob'])
  assert.equal(s.body.me.streak, 0)
  assert.equal(fake.hashes.has('u:t2_bob'), false) // a board never moves the daily streak
  const sh = await post<ShareRsp>(Endpoint.Share, {day: 'b-new1'})
  assert.equal(sh.status, 200)
  assert.equal(
    sh.body.text,
    'Lampwright community board: par! Every crystal lit with 1 mirror.\n\n◆ I found 1 of 1 par route.',
  )
  assert.equal(comments[0]?.id, 't3_new1')
  assert.equal(comments[0]?.runAs, 'APP')
  assert.match(
    comments[0]?.text ?? '',
    /^Share your Lampwright community board result/,
  )
  assert.equal(comments[1]?.runAs, 'USER')
  // boards have no day-after reveal
  assert.equal((await get(Endpoint.Reveal)).status, 400)
})

test('boards: the newest boards are listed with solver counts, newest first, no usernames', async () => {
  await postBoard(BOARD)
  ctx = {postId: 't3_day', userId: 't2_bob', username: 'bob'}
  now = new Date('2026-11-20T13:00:00Z')
  await postBoard(BOARD.map((r, k) => (k === 8 ? '...*...' : r)))
  ctx = {postId: 't3_new1', userId: 't2_carol', username: 'carol'}
  await post<SubmitRsp>(Endpoint.Submit, {
    day: 'b-new1',
    placed: [{i: 33, m: '/'}],
  })
  const list = (await get<BoardsRsp>(Endpoint.Boards)).body.boards
  assert.deepEqual(
    list.map(b => [b.postId, b.solvers, b.crystals]),
    [
      ['t3_new2', 0, 3],
      ['t3_new1', 1, 2],
    ],
  )
  assert.equal(list[1]?.url, 'https://reddit.example/t3_new1')
  assert.doesNotMatch(JSON.stringify(list), /alice|bob|carol|t2_/)
})

test('boards: deleting the post deletes the board, its counts and its list entry', async () => {
  await postBoard(BOARD)
  ctx = {postId: 't3_new1', userId: 't2_bob', username: 'bob'}
  await post<SubmitRsp>(Endpoint.Submit, {
    day: 'b-new1',
    placed: [{i: 33, m: '/'}],
  })
  await post<ShareRsp>(Endpoint.Share, {day: 'b-new1'})
  assert.equal(fake.strings.get('d:b-new1:solvers'), '1')
  const del = {type: 'PostDelete', postId: 't3_new1', source: 1, reason: 1}
  assert.equal((await post(Endpoint.OnPostDelete, del)).status, 200)
  assert.equal((await post(Endpoint.OnPostDelete, del)).status, 200)
  for (const k of [
    'puz:b-new1',
    'post:t3_new1',
    'sticky:t3_new1',
    'd:b-new1:solvers',
  ])
    assert.equal(fake.strings.has(k), false, k)
  for (const k of [
    'd:b-new1:hist',
    'd:b-new1:routes',
    'd:b-new1:first',
    'd:b-new1:shared',
  ])
    assert.equal(fake.hashes.has(k), false, k)
  assert.deepEqual((await get<BoardsRsp>(Endpoint.Boards)).body.boards, [])
  // deleting a daily post leaves every board alone
  ctx = {postId: 't3_day', userId: 't2_alice', username: 'alice'}
  now = new Date('2026-11-21T08:00:00Z')
  await postBoard(BOARD)
  await post(Endpoint.OnPostDelete, {
    type: 'PostDelete',
    postId: 't3_day',
    source: 1,
    reason: 1,
  })
  assert.equal(fake.strings.has('puz:b-new2'), true)
  assert.equal((await get<BoardsRsp>(Endpoint.Boards)).body.boards.length, 1)
})

test('boards: routing', async () => {
  assert.equal((await fetch(`${serverURL}/${Endpoint.BoardPost}`)).status, 404)
  assert.equal(
    (
      await fetch(`${serverURL}/${Endpoint.Boards}`, {
        method: 'POST',
        body: '{}',
      })
    ).status,
    404,
  )
  assert.equal((await get<BoardsRsp>(Endpoint.Boards)).status, 200)
})
