// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// v0.8: the moderator menu "Feature this board" through the real request handler,
// with an in-memory Redis and stand-ins for Reddit posts and pins.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import type {AddressInfo, Server} from 'node:net'
import {after, before, beforeEach, test} from 'node:test'
import {type Context, reddit, runWithContext} from '@devvit/web/server'
import type {BoardPostRsp, ErrorRsp} from '../shared/api.ts'
import {Endpoint} from '../shared/api.ts'
import {type FakeRedis, installFakeRedis} from './fake-redis.ts'
import {clock, onReq} from './server.ts'

type Ctx = {postId?: string; userId?: string; username?: string}
type Toast = {showToast?: {text: string; appearance?: string}}
let ctx: Ctx = {}
let fake: FakeRedis
let server: Server
let serverURL = ''
let posted = 0
let failSticky = false
const pins: string[] = [] // "sticky:<t3>:<slot>" or "unsticky:<t3>"
const savedSubmit = reddit.submitCustomPost
const savedGet = reddit.getPostById
const savedNow = clock.now

// Same solvable board as boards.test.ts: par 1, one route.
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
  clock.now = () => new Date('2026-11-20T12:00:00Z')
  reddit.submitCustomPost = (async () => {
    posted++
    const id = `t3_new${posted}`
    return {id, url: `https://reddit.example/${id}`}
  }) as unknown as typeof reddit.submitCustomPost
  reddit.getPostById = (async (id: string) => ({
    id,
    sticky: async (slot?: number) => {
      if (failSticky) throw Error('pins are down')
      pins.push(`sticky:${id}:${slot ?? 'any'}`)
    },
    unsticky: async () => {
      pins.push(`unsticky:${id}`)
    },
  })) as unknown as typeof reddit.getPostById
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
  pins.length = 0
  failSticky = false
  ctx = {postId: 't3_day', userId: 't2_alice', username: 'alice'}
})

after(() => {
  fake.restore()
  clock.now = savedNow
  reddit.submitCustomPost = savedSubmit
  reddit.getPostById = savedGet
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

async function postBoard(user: string): Promise<string> {
  ctx = {postId: 't3_day', userId: user, username: user.slice(3)}
  const r = await post<BoardPostRsp>(Endpoint.BoardPost, {rows: BOARD})
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body.postId
}

function feature(
  targetId: unknown,
): Promise<{status: number; body: Toast & ErrorRsp}> {
  ctx = {userId: 't2_mod', username: 'mod'}
  return post<Toast>(Endpoint.OnMenuFeature, {location: 'post', targetId})
}

test('feature: pins a community board in slot 2', async () => {
  const t3 = await postBoard('t2_alice')
  const r = await feature(t3)
  assert.equal(r.status, 200)
  assert.equal(r.body.showToast?.appearance, 'success')
  assert.deepEqual(pins, [`sticky:${t3}:2`])
})

test('feature: a second board replaces the first, and the same board twice is a no-op', async () => {
  const a = await postBoard('t2_alice')
  const b = await postBoard('t2_bob')
  await feature(a)
  await feature(b)
  // pin the new board first, then unpin the old one, so the community is never left without a featured board
  assert.deepEqual(pins, [`sticky:${a}:2`, `sticky:${b}:2`, `unsticky:${a}`])
  const again = await feature(b)
  assert.equal(again.body.showToast?.appearance, 'neutral')
  assert.equal(pins.length, 3)
})

test('feature: refuses daily posts, unknown posts and bad bodies without pinning', async () => {
  ctx = {postId: 't3_daily', userId: 't2_alice', username: 'alice'}
  assert.equal((await fetch(`${serverURL}/${Endpoint.Today}`)).status, 200) // t3_daily now plays today
  for (const target of ['t3_daily', 't3_unknown', 't5_sub', 42, undefined]) {
    const r = await feature(target)
    assert.equal(r.status, 200)
    assert.equal(r.body.showToast?.appearance, 'neutral', String(target))
  }
  const junk = await post<Toast>(Endpoint.OnMenuFeature, 'not json')
  assert.equal(junk.status, 200)
  assert.equal(pins.length, 0)
})

test('feature: a failed pin is not remembered, so the next try pins again', async () => {
  const t3 = await postBoard('t2_alice')
  failSticky = true
  const failed = await feature(t3)
  assert.equal(failed.status, 200)
  assert.equal(failed.body.showToast?.appearance, 'neutral')
  failSticky = false
  const r = await feature(t3)
  assert.equal(r.body.showToast?.appearance, 'success')
  assert.deepEqual(pins, [`sticky:${t3}:2`])
})

test('feature: deleting the featured post forgets it; the menu is POST only', async () => {
  const a = await postBoard('t2_alice')
  await feature(a)
  await post(Endpoint.OnPostDelete, {
    type: 'PostDelete',
    postId: a,
    source: 1,
    reason: 1,
  })
  const b = await postBoard('t2_bob')
  await feature(b)
  assert.deepEqual(pins, [`sticky:${a}:2`, `sticky:${b}:2`]) // no unsticky of the deleted post
  assert.equal(
    (await fetch(`${serverURL}/${Endpoint.OnMenuFeature}`)).status,
    404,
  )
})
