// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Local harness: serves public/ and routes api/* to the real Lampwright handler
// with an in-memory Redis and stand-ins for Reddit posts and comments, so the
// client can be played in a browser offline. Nothing here ever reaches Reddit.
// Usage (from the app root, after `npm run build`):
//   node --experimental-strip-types tools/harness.ts [port]
// Headers: x-test-user: <name> | anon; x-test-post: archive (plays yesterday's post)
// or a post id such as t3_hb1 (v0.5: a community board posted through the harness).
// v0.7: Journeys events are recorded here (never sent anywhere) and the Join button is counted.
import {readFile} from 'node:fs/promises'
import {createServer, type ServerResponse} from 'node:http'
import {extname, join, normalize} from 'node:path'
import {type Context, reddit, runWithContext} from '@devvit/web/server'
import {dbDay, dbRecordSolve} from '../src/server/db.ts'
import {installFakeRedis} from '../src/server/fake-redis.ts'
import {onReq} from '../src/server/server.ts'
import {
  addDays,
  dayId,
  generate,
  isDayId,
  search,
  solutionKey,
} from '../src/shared/puzzle.ts'

const port = Number(process.argv[2] ?? '8787')
const root = join(process.cwd(), 'public')
const types: {[ext: string]: string} = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.png': 'image/png',
  '.css': 'text/css',
}
const fake = installFakeRedis()
const comments: {id: string; text: string; runAs: string}[] = []
const posts: {id: string; title: string; runAs: string; ugc: string}[] = []
reddit.submitComment = (async (opts: {
  id: string
  text: string
  runAs?: string
}) => {
  comments.push({id: opts.id, text: opts.text, runAs: opts.runAs ?? 'APP'})
  return {id: `t1_h${comments.length}`, distinguish: async () => undefined}
}) as unknown as typeof reddit.submitComment
reddit.submitCustomPost = (async (opts: {
  title: string
  runAs?: string
  userGeneratedContent?: {text: string}
}) => {
  const id = `t3_hb${posts.length + 1}`
  posts.push({
    id,
    title: opts.title,
    runAs: opts.runAs ?? 'APP',
    ugc: opts.userGeneratedContent?.text ?? '',
  })
  return {id, url: `https://reddit.example/${id}`}
}) as unknown as typeof reddit.submitCustomPost
let joins = 0
reddit.subscribeToCurrentSubreddit = (async () => {
  joins++
}) as typeof reddit.subscribeToCurrentSubreddit
const journeyLog: {path: string; body: unknown}[] = []

let ready = false
const today = dayId(new Date())
const yesterday = addDays(today, -1)

/** Yesterday's post exists and one other player found one of its par routes. */
async function seed(): Promise<void> {
  fake.strings.set('post:t3_archive', yesterday)
  const rec = await dbDay(yesterday)
  const first = search(rec.puzzle, rec.puzzle.par).solutions[0] ?? []
  await dbRecordSolve(
    't2_other',
    'other',
    rec,
    first.length,
    solutionKey(first),
    yesterday,
  )
  await dbDay(today)
  ready = true
  console.log(`seeded ${yesterday} (archive) and ${today}`)
}

function postFor(header: string | string[] | undefined): string {
  if (header === 'archive') return 't3_archive'
  if (typeof header === 'string' && /^t3_[a-z0-9]{1,16}$/.test(header))
    return header
  return 't3_harness'
}

function json(rsp: ServerResponse, status: number, body: unknown): void {
  rsp.writeHead(status, {'Content-Type': 'application/json'})
  rsp.end(JSON.stringify(body))
}

const server = createServer((req, rsp) => {
  const url = new URL(req.url ?? '/', 'http://harness.invalid')
  const path = url.pathname
  if (path.startsWith('/api/telemetry/')) {
    let raw = ''
    req.on('data', chunk => {
      raw += chunk
    })
    req.on('end', () => {
      let body: unknown = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        body = raw
      }
      journeyLog.push({path: path.slice('/api/telemetry'.length), body})
      const receipt = {
        status: 'JOURNEY_RECEIPT_DENIED_PLAYTEST',
        message: 'harness',
      }
      json(
        rsp,
        200,
        path.endsWith('/start')
          ? {journeyId: `hj${journeyLog.length}`, receipt}
          : {receipt},
      )
    })
    return
  }
  if (path.startsWith('/api/') || path.startsWith('/internal/')) {
    const user = req.headers['x-test-user']
    const ctx = {
      appName: 'lampwright',
      postId: postFor(req.headers['x-test-post']),
      ...(user === 'anon'
        ? {}
        : {
            userId: 't2_tester',
            username: typeof user === 'string' ? user : 'tester',
          }),
    }
    void runWithContext(ctx as unknown as Context, () => onReq(req, rsp))
    return
  }
  if (path === '/__test/ready') {
    json(rsp, ready ? 200 : 503, {ready, today, yesterday})
    return
  }
  if (path === '/__test/solution') {
    const asked = url.searchParams.get('day')
    const p = generate(isDayId(asked) ? asked : today)
    json(rsp, 200, {puzzle: p, solutions: search(p, p.par).solutions})
    return
  }
  if (path === '/__test/comments') {
    json(rsp, 200, comments)
    return
  }
  if (path === '/__test/posts') {
    json(rsp, 200, posts)
    return
  }
  if (path === '/__test/journey') {
    json(rsp, 200, journeyLog)
    return
  }
  if (path === '/__test/joins') {
    json(rsp, 200, {joins})
    return
  }
  const file = normalize(join(root, path === '/' ? 'game.html' : path))
  if (!file.startsWith(root)) {
    rsp.writeHead(403)
    rsp.end()
    return
  }
  void readFile(file).then(
    data => {
      rsp.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      })
      rsp.end(data)
    },
    () => {
      rsp.writeHead(404)
      rsp.end()
    },
  )
})
server.listen(port, '127.0.0.1', () => {
  console.log(`harness on http://127.0.0.1:${port}`)
  seed().catch(err =>
    console.error(`seed failed: ${err instanceof Error ? err.stack : err}`),
  )
})
