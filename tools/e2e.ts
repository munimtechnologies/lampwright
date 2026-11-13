// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Plays today's Lampwright in headless Chromium against tools/harness.ts, opens
// yesterday's (archive) post and steps through its revealed par routes, then (v0.5)
// builds a community board, posts it as the player and plays it.
// v0.6: how-to-play card, arrow keys, countdown. v0.7: Journeys and Join. v0.8: splash countdown.
// v0.9: keyboard and dialog accessibility checks (checks named "a11y: ...").
// v0.9b: the same for the board builder (checks named "a11y: builder ..." and "a11y: palette ...").
// v0.9c: one splash contrast check (every visible text on the splash against its brightest background).
// Usage: node --experimental-strip-types tools/e2e.ts <base-url> <out-dir>
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {type BrowserContext, chromium, type Page} from 'playwright'

type Check = {name: string; ok: boolean; detail: string}
type Sol = {
  puzzle: {par: number; budget: number; rows: string[]; w: number}
  solutions: {i: number; m: string}[][]
}
type Sent = {id: string; text: string; runAs: string}
type SentPost = {id: string; title: string; runAs: string; ugc: string}
type Ready = {ready: boolean; today: string; yesterday: string}

const base = process.argv[2] ?? 'http://127.0.0.1:8787'
const out = process.argv[3] ?? 'e2e-out'
mkdirSync(out, {recursive: true})
const checks: Check[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({name, ok, detail})
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

async function text(page: Page, sel: string): Promise<string> {
  return ((await page.textContent(sel)) ?? '').trim()
}

async function tapCell(page: Page, i: number, times: number): Promise<void> {
  for (let k = 0; k < times; k++) await page.click(`[data-cell="${i}"]`)
}

/** v0.9: what has keyboard focus, as "#id", "cell:N", "bcell:N", "tool:X" or the tag name. */
async function focusName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    if (!a) return 'none'
    if (a.dataset.cell !== undefined) return `cell:${a.dataset.cell}`
    if (a.dataset.bcell !== undefined) return `bcell:${a.dataset.bcell}`
    if (a.dataset.tool !== undefined) return `tool:${a.dataset.tool}`
    return a.id ? `#${a.id}` : a.tagName.toLowerCase()
  })
}

async function appInert(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.getElementById('app')?.hasAttribute('inert') ?? false,
  )
}

/** Builder: tap Check board and wait until the solver is done; returns the status line. */
async function checkBoardIn(page: Page): Promise<string> {
  await page.click('#b-check')
  await page.waitForSelector('#b-check:not([disabled])', {timeout: 30_000})
  return text(page, '#status')
}

/** Outside Reddit there is no permission prompt to answer; the client reads this flag instead. */
async function grantConsent(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    ;(
      window as unknown as {lampwrightTestConsent?: boolean}
    ).lampwrightTestConsent = true
  })
}

/** The harness seeds yesterday's puzzle after it starts listening. */
async function waitReady(): Promise<Ready> {
  for (let k = 0; k < 120; k++) {
    try {
      const rsp = await fetch(`${base}/__test/ready`)
      if (rsp.status === 200) return (await rsp.json()) as Ready
    } catch {
      // not listening yet
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw Error('harness never became ready')
}

const phone = {
  viewport: {width: 390, height: 844},
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}
const browser = await chromium.launch()
const errors: string[] = []
function watch(page: Page, name: string): void {
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`)
  })
}
try {
  const days = await waitReady()
  const ctx = await browser.newContext(phone)
  await grantConsent(ctx)
  const page = await ctx.newPage()
  watch(page, 'game')
  await page.goto(`${base}/game.html`)
  await page.waitForSelector('body[data-ready="1"]', {timeout: 30_000})
  await page.screenshot({path: join(out, 'game-start.png')})
  const sol = (await (await fetch(`${base}/__test/solution`)).json()) as Sol
  const p = sol.puzzle
  check(
    'title shows number',
    /^Lampwright #\d+$/.test(await text(page, '#title')),
    await text(page, '#title'),
  )
  check(
    'par shown',
    (await text(page, '#par')) === String(p.par),
    await text(page, '#par'),
  )
  check(
    'cells rendered',
    (await page.locator('[data-cell]').count()) === p.rows.length * p.w,
  )
  const board = await page.locator('#board').boundingBox()
  const lock = await page.locator('#undo').boundingBox()
  check(
    'board and controls fit a 390x844 phone',
    !!board &&
      !!lock &&
      board.x >= 0 &&
      board.x + board.width <= 390 &&
      lock.y + lock.height <= 844,
    JSON.stringify({board, undo: lock}),
  )
  check(
    'cells are at least 40px',
    !!board && board.width / p.w >= 40,
    String(board ? board.width / p.w : 0),
  )
  check('hint visible on first visit', await page.isVisible('#hint'))
  // v0.9: the whole board is a single Tab stop
  const stops = await page.locator('[data-cell][tabindex="0"]').count()
  check('a11y: the board is one Tab stop', stops === 1, String(stops))
  const boardLabel = (await page.getAttribute('#board', 'aria-label')) ?? ''
  check(
    'a11y: the board says its size',
    boardLabel.includes(`${p.w} columns by ${p.rows.length} rows`),
    boardLabel,
  )
  // v0.6: how to play, and arrow keys between squares
  check('help button shown', await page.isVisible('#help-btn'))
  await page.click('#help-btn')
  await page.waitForSelector('#help:not([hidden])', {timeout: 5_000})
  await page.screenshot({path: join(out, 'game-help.png')})
  check(
    'help explains par',
    (await text(page, '#help')).includes('par + 1'),
    await text(page, '#help-head'),
  )
  check('a11y: the page behind the help card is inert', await appInert(page))
  await page.click('#help-close')
  check('help closes', !(await page.isVisible('#help')))
  check(
    'a11y: the page is live again after help closes',
    !(await appInert(page)),
  )
  // v0.9: Tab stays inside the open help card; Escape closes it and focus returns to "?"
  await page.click('#help-btn')
  await page.waitForSelector('#help:not([hidden])', {timeout: 5_000})
  await page.keyboard.press('Tab')
  const inHelp = await focusName(page)
  check(
    'a11y: Tab stays inside the help card',
    inHelp === '#help-close',
    inHelp,
  )
  await page.keyboard.press('Escape')
  const afterEsc = await focusName(page)
  check(
    'a11y: Escape closes help, focus back on "?"',
    !(await page.isVisible('#help')) && afterEsc === '#help-btn',
    afterEsc,
  )
  await page.focus('[data-cell="0"]')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  const focused = await page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.dataset.cell ?? '',
  )
  check('arrow keys move between squares', focused === String(1 + p.w), focused)
  await page.keyboard.press('End')
  const atEnd = await focusName(page)
  check(
    'a11y: End jumps to the end of the row',
    atEnd === `cell:${2 * p.w - 1}`,
    atEnd,
  )
  const roved = await page.getAttribute(
    `[data-cell="${2 * p.w - 1}"]`,
    'tabindex',
  )
  check(
    'a11y: the Tab stop follows focus',
    roved === '0' &&
      (await page.locator('[data-cell][tabindex="0"]').count()) === 1,
    String(roved),
  )
  await page.keyboard.press('Tab')
  const leftBoard = await focusName(page)
  check(
    'a11y: one Tab leaves the board',
    !leftBoard.startsWith('cell:'),
    leftBoard,
  )
  check("no reveal on today's post", !(await page.isVisible('#reveal')))
  // over-budget taps are refused
  const empties = p.rows
    .join('')
    .split('')
    .map((c, i) => (c === '.' ? i : -1))
    .filter(i => i >= 0)
  for (const i of empties.slice(0, p.budget + 1)) await tapCell(page, i, 1)
  check(
    'budget enforced',
    (await text(page, '#mirrors')) === `${p.budget}/${p.budget}`,
    await text(page, '#mirrors'),
  )
  check(
    'budget message',
    (await text(page, '#status')).includes('only have'),
    await text(page, '#status'),
  )
  await page.click('#reset')
  check('reset clears', (await text(page, '#mirrors')) === `0/${p.budget}`)
  check('hint hidden after first tap', !(await page.isVisible('#hint')))
  // play a par solution
  const first = sol.solutions[0] ?? []
  for (const pl of first) await tapCell(page, pl.i, pl.m === '/' ? 1 : 2)
  const lit = await text(page, '#lit')
  const [a, b] = lit.split('/')
  check('all crystals lit', a === b && a !== '0', lit)
  check('lock in shown when solved', await page.isVisible('#lock'))
  const ring = await page.evaluate(() => {
    const c = document.querySelector('.cell.crystal.lit')
    return c ? getComputedStyle(c).boxShadow : 'no lit crystal'
  })
  check(
    'a11y: a lit crystal has a ring, not only a colour',
    ring.includes('inset'),
    ring,
  )
  await page.screenshot({path: join(out, 'game-solved.png')})
  await page.click('#lock')
  await page.waitForSelector('#result:not([hidden])', {timeout: 15_000})
  await page.screenshot({path: join(out, 'game-result.png')})
  check(
    'result says par',
    (await text(page, '#r-head')).startsWith('Par!'),
    await text(page, '#r-head'),
  )
  check(
    'first finder credited',
    (await text(page, '#r-line')).includes('first'),
    await text(page, '#r-line'),
  )
  check(
    'route progress shown',
    /found by everyone today: 1 of \d+/.test(await text(page, '#r-routes')),
    await text(page, '#r-routes'),
  )
  check(
    'streak shown',
    (await text(page, '#r-streak')).includes('1 day'),
    await text(page, '#r-streak'),
  )
  const next = await text(page, '#r-next')
  check(
    'countdown to the next puzzle',
    /^Next puzzle in (\d+h \d+m|\d+m|under a minute)\.$/.test(next),
    next,
  )
  // v0.9: the result card holds focus and the game behind it is inert
  const onOpen = await focusName(page)
  check(
    'a11y: the result card focuses Keep exploring',
    onOpen === '#r-again',
    onOpen,
  )
  check('a11y: the page behind the result card is inert', await appInert(page))
  await page.keyboard.press('Tab')
  const wrapped = await focusName(page)
  check(
    'a11y: Tab wraps inside the result card',
    wrapped === '#r-join',
    wrapped,
  )
  // v0.4: yesterday's counts on today's result card (the harness seeds one solver)
  check(
    "yesterday's counts on the result card",
    /^Yesterday, #\d+: 1 solver found 1 of \d+\+? par routes?\./.test(
      await text(page, '#r-yesterday'),
    ),
    await text(page, '#r-yesterday'),
  )
  // v0.7: Devvit Journeys (recorded by the harness) and the Join button
  type Tele = {path: string; body: unknown}
  let jr: Tele[] = []
  for (let k = 0; k < 30; k++) {
    jr = (await (await fetch(`${base}/__test/journey`)).json()) as Tele[]
    if (jr.at(-1)?.path === '/journey/end') break
    await page.waitForTimeout(100)
  }
  const kinds = jr.map(e => e.path.replace('/journey/', ''))
  check(
    'journey: app-ready, then start on the first tap',
    kinds[0] === 'app-ready' && kinds[1] === 'start',
    kinds.join(','),
  )
  check(
    'journey: one start before the lock-in',
    kinds.filter(k => k === 'start').length === 1,
    kinds.join(','),
  )
  const prog = jr
    .filter(e => e.path === '/journey/progress')
    .map(e => (e.body as {progress: number}).progress)
  check(
    'journey: progress rises, at most one event per crystal',
    prog.length >= 1 &&
      prog.length <= Number(b) &&
      prog.every(
        (v, k) => v >= 0.1 && v <= 1 && (k === 0 || v > (prog[k - 1] ?? 1)),
      ),
    JSON.stringify(prog),
  )
  const end = jr.at(-1)?.body as
    | {complete?: boolean; game?: {win: boolean; score: number}}
    | undefined
  check(
    'journey: the lock-in ends it, complete and at par',
    kinds.at(-2) === 'interaction' &&
      end?.complete === true &&
      end.game?.win === true &&
      end.game.score === first.length,
    JSON.stringify(jr.slice(-2)),
  )
  check('join offered on the result card', await page.isVisible('#r-join'))
  const joins0 = (
    (await (await fetch(`${base}/__test/joins`)).json()) as {joins: number}
  ).joins
  check('nothing joined before the player asks', joins0 === 0, String(joins0))
  await page.click('#r-join')
  await page.waitForSelector('#r-joined:not([hidden])', {timeout: 10_000})
  const joins1 = (
    (await (await fetch(`${base}/__test/joins`)).json()) as {joins: number}
  ).joins
  check(
    'join subscribes once, from the button',
    joins1 === 1 && !(await page.isVisible('#r-join')),
    String(joins1),
  )
  await page.screenshot({path: join(out, 'game-joined.png')})
  // v0.3 share: optional, previewed, posts only after the player confirms
  const before = (await (
    await fetch(`${base}/__test/comments`)
  ).json()) as Sent[]
  check(
    'nothing posted before the player asks',
    before.length === 0,
    JSON.stringify(before),
  )
  check('share button offered after a solve', await page.isVisible('#r-share'))
  await page.click('#r-share')
  await page.waitForSelector('#share:not([hidden])', {timeout: 5_000})
  const preview = await text(page, '#s-preview')
  const note = await text(page, '#s-note')
  await page.screenshot({path: join(out, 'game-share.png')})
  check(
    'share preview is the result, counts only',
    /^Lampwright #\d+: par!/.test(preview) && !/\d+[sb]\b/.test(preview),
    preview,
  )
  check(
    'share says it posts from your account',
    note.includes('from your account, u/tester') && note.includes('username'),
    note,
  )
  const mid = (await (await fetch(`${base}/__test/comments`)).json()) as Sent[]
  check(
    'opening the preview posts nothing',
    mid.length === 0,
    JSON.stringify(mid),
  )
  await page.click('#s-post')
  await page.waitForSelector('#r-shared:not([hidden])', {timeout: 15_000})
  check(
    'shared confirmation names the account',
    (await text(page, '#r-shared')).includes('u/tester'),
    await text(page, '#r-shared'),
  )
  check('share button gone after sharing', !(await page.isVisible('#r-share')))
  const sent = (await (await fetch(`${base}/__test/comments`)).json()) as Sent[]
  const [pin, reply] = sent
  check(
    'one pinned app comment, one reply as the player',
    sent.length === 2 &&
      pin?.runAs === 'APP' &&
      pin.id === 't3_harness' &&
      reply?.runAs === 'USER' &&
      reply.id === 't1_h1',
    JSON.stringify(sent),
  )
  check(
    'posted text equals the preview',
    (reply?.text ?? '').replaceAll('\n\n', '\n') === preview,
    JSON.stringify(reply?.text),
  )
  await page.screenshot({path: join(out, 'game-shared.png')})
  await page.click('#r-again')
  check('result closes', !(await page.isVisible('#result')))
  check(
    'status knows the route',
    (await text(page, '#status')).includes('already found'),
    await text(page, '#status'),
  )
  const last = first[first.length - 1]
  // v0.9: focus goes back to the last square the player tapped, and the page is live again
  const back = await focusName(page)
  check(
    'a11y: closing the result card returns focus to the board',
    !!last && back === `cell:${last.i}` && !(await appInert(page)),
    back,
  )
  // undo walks back exactly one tap
  if (last) {
    await page.click('#undo')
    const cls =
      (await page.getAttribute(`[data-cell="${last.i}"]`, 'class')) ?? ''
    const ok =
      last.m === '/'
        ? !cls.includes('placed')
        : cls.includes('m-s') && cls.includes('placed')
    check('undo works', ok, cls)
  }
  // v0.4: yesterday's post (archive) reveals its par routes, one per tap
  const arch = await browser.newContext({
    ...phone,
    extraHTTPHeaders: {'x-test-post': 'archive'},
  })
  const ap = await arch.newPage()
  watch(ap, 'archive')
  await ap.goto(`${base}/game.html`)
  await ap.waitForSelector('body[data-ready="1"]', {timeout: 30_000})
  const ysol = (await (
    await fetch(`${base}/__test/solution?day=${days.yesterday}`)
  ).json()) as Sol
  check(
    'archive post is marked',
    (await text(ap, '#day')).endsWith('(archive)'),
    await text(ap, '#day'),
  )
  check('reveal offered on the archive post', await ap.isVisible('#reveal'))
  await ap.click('#reveal')
  await ap.waitForFunction(
    () =>
      (document.getElementById('status')?.textContent ?? '').startsWith(
        'Par route 1 of',
      ),
    undefined,
    {
      timeout: 15_000,
    },
  )
  const ylit = await text(ap, '#lit')
  const [ya, yb] = ylit.split('/')
  check('a revealed route lights every crystal', ya === yb && ya !== '0', ylit)
  check(
    'revealed route uses par mirrors',
    (await text(ap, '#mirrors')).startsWith(`${ysol.puzzle.par}/`),
    await text(ap, '#mirrors'),
  )
  check('no lock-in after a reveal', !(await ap.isVisible('#lock')))
  const s1 = await text(ap, '#status')
  check(
    'reveal says whether players found it',
    /Players found this one\.|Nobody found this one\./.test(s1),
    s1,
  )
  await ap.screenshot({path: join(out, 'game-reveal.png')})
  if (ysol.solutions.length > 1) {
    await ap.click('#reveal')
    const s2 = await text(ap, '#status')
    check('next tap shows route 2', s2.startsWith('Par route 2 of'), s2)
  } else {
    check('next tap shows route 2', true, 'only one par route yesterday')
  }
  const abox = await ap.locator('#undo').boundingBox()
  check(
    'archive layout fits a 390x844 phone',
    !!abox && abox.y + abox.height <= 844,
    JSON.stringify(abox),
  )

  // v0.5: build a community board, check it, post it as the player, then play it
  const bctx = await browser.newContext(phone)
  await grantConsent(bctx)
  const bp = await bctx.newPage()
  watch(bp, 'builder')
  await bp.goto(`${base}/build.html`)
  await bp.waitForSelector('body[data-ready="1"]', {timeout: 30_000})
  await bp.screenshot({path: join(out, 'build-start.png')})
  const lampCls = (await bp.getAttribute('[data-bcell="28"]', 'class')) ?? ''
  check(
    'builder starts with a lamp on the left edge',
    lampCls.includes('emitter'),
    lampCls,
  )
  const bb = await bp.locator('#board').boundingBox()
  check(
    'builder board fits a 390px phone',
    !!bb && bb.x >= 0 && bb.x + bb.width <= 390,
    JSON.stringify(bb),
  )
  check(
    'builder cells are at least 40px',
    !!bb && bb.width / 7 >= 40,
    String(bb ? bb.width / 7 : 0),
  )
  check(
    'builder lists no boards yet',
    (await bp.locator('#boards li').count()) === 0 &&
      (await bp.isVisible('#boards-empty')),
  )
  // v0.9b: builder keyboard checks. They leave the board as they found it (no crystals) and pick the
  // Wall tool; the checks below click the Crystal tool before painting, so nothing after depends on it.
  const bRows = (await bp.locator('[data-bcell]').count()) / 7
  const bStops = await bp.locator('[data-bcell][tabindex="0"]').count()
  check('a11y: builder board is one Tab stop', bStops === 1, String(bStops))
  const bLabel = (await bp.getAttribute('#board', 'aria-label')) ?? ''
  check(
    'a11y: builder board says its size',
    bLabel.includes(`7 columns by ${bRows} rows`),
    bLabel,
  )
  const toolStops = await bp.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.tool'))
      .filter(t => t.tabIndex === 0)
      .map(t => t.dataset.tool ?? ''),
  )
  check(
    'a11y: palette is one Tab stop, on the chosen tool',
    toolStops.length === 1 && toolStops[0] === '*',
    JSON.stringify(toolStops),
  )
  await bp.focus('[data-bcell="0"]')
  await bp.keyboard.press('ArrowRight')
  await bp.keyboard.press('ArrowDown')
  const bMoved = await focusName(bp)
  check(
    'a11y: arrow keys move between builder squares',
    bMoved === 'bcell:8',
    bMoved,
  )
  await bp.keyboard.press('Enter')
  const painted = (await bp.getAttribute('[data-bcell="8"]', 'class')) ?? ''
  await bp.keyboard.press('Enter')
  const erased = (await bp.getAttribute('[data-bcell="8"]', 'class')) ?? ''
  const stillOn = await focusName(bp)
  check(
    'a11y: builder Enter paints the focused square, again clears it',
    painted.includes('crystal') &&
      !erased.includes('crystal') &&
      stillOn === 'bcell:8',
    `${painted} | ${erased} | ${stillOn}`,
  )
  await bp.keyboard.press('Tab')
  const bLeft = await focusName(bp)
  check(
    'a11y: one Tab leaves the builder board for Check board',
    bLeft === '#b-check',
    bLeft,
  )
  await bp.focus('[data-tool="*"]')
  await bp.keyboard.press('ArrowRight')
  const nextTool = await focusName(bp)
  check(
    'a11y: palette arrow keys move to the next tool',
    nextTool === 'tool:#',
    nextTool,
  )
  await bp.keyboard.press('Enter')
  const wallOn = await bp.getAttribute('[data-tool="#"]', 'aria-pressed')
  const crystalOff = await bp.getAttribute('[data-tool="*"]', 'aria-pressed')
  check(
    'a11y: palette Enter picks the focused tool',
    wallOn === 'true' && crystalOff === 'false',
    `${wallOn} ${crystalOff}`,
  )
  const bCredit = await bp.evaluate(
    () =>
      getComputedStyle(document.getElementById('credit') as HTMLElement).color,
  )
  check(
    'a11y: builder credit uses the brighter colour',
    bCredit === 'rgb(138, 147, 196)',
    bCredit,
  )
  const r0 = await checkBoardIn(bp)
  check(
    'a board without crystals is refused with a reason',
    /crystals/.test(r0),
    r0,
  )
  check(
    'no post button before a passing check',
    !(await bp.isVisible('#b-post')),
  )
  // crystals at row 5 column 4 (cell 31) and row 2 column 6 (cell 12): one mirror on cell 33 lights both
  await bp.click('[data-tool="*"]')
  await bp.click('[data-bcell="31"]')
  await bp.click('[data-bcell="12"]')
  // v0.9b: the crystal in the lamp's row is lit, and it has a ring like in the game
  const bRing = await bp.evaluate(() => {
    const c = document.querySelector('[data-bcell].crystal.lit')
    return c ? getComputedStyle(c).boxShadow : 'no lit crystal'
  })
  check(
    'a11y: builder lit crystal has a ring, not only a colour',
    bRing.includes('inset'),
    bRing,
  )
  const r1 = await checkBoardIn(bp)
  check(
    'the solver sets par 1 with one route',
    r1.startsWith('Solvable! Par 1: 1 par route.'),
    r1,
  )
  check('post offered after a passing check', await bp.isVisible('#b-post'))
  const bnote = await text(bp, '#b-note')
  check(
    'post note says it posts from your account',
    bnote.includes('from your account, u/tester') && bnote.includes('username'),
    bnote,
  )
  await bp.click('[data-tool="#"]')
  await bp.click('[data-bcell="0"]')
  check(
    'an edit hides Post until the board is checked again',
    !(await bp.isVisible('#b-post')),
  )
  const r2 = await checkBoardIn(bp)
  check('the edited board passes again', r2.startsWith('Solvable! Par 1'), r2)
  await bp.screenshot({path: join(out, 'build-checked.png')})
  const noPosts = (await (
    await fetch(`${base}/__test/posts`)
  ).json()) as SentPost[]
  check(
    'no board posted before the player asks',
    noPosts.length === 0,
    JSON.stringify(noPosts),
  )
  await bp.click('#b-post')
  await bp.waitForSelector('#b-posted:not([hidden])', {timeout: 15_000})
  // v0.9b: the Post button disappeared with its panel, so focus must not fall back to the page
  const afterPost = await focusName(bp)
  check(
    'a11y: after posting, focus is on Open the post',
    afterPost === '#b-open',
    afterPost,
  )
  const sentPosts = (await (
    await fetch(`${base}/__test/posts`)
  ).json()) as SentPost[]
  const bpost = sentPosts[0]
  check(
    'board posted once, as the player, with its grid as user content',
    sentPosts.length === 1 &&
      bpost?.runAs === 'USER' &&
      (bpost?.ugc ?? '').includes('E..*...'),
    JSON.stringify(sentPosts),
  )
  check(
    'posted confirmation names the account',
    (await text(bp, '#b-posted-text')).includes('u/tester'),
    await text(bp, '#b-posted-text'),
  )
  await bp.waitForFunction(
    () => document.querySelectorAll('#boards li').length === 1,
    undefined,
    {timeout: 10_000},
  )
  check(
    'the new board is listed',
    (await text(bp, '#boards li')).startsWith('Par 1 · 2 crystals · 0 solved'),
    await text(bp, '#boards li'),
  )
  await bp.screenshot({path: join(out, 'build-posted.png')})
  const pctx = await browser.newContext({
    ...phone,
    extraHTTPHeaders: {'x-test-post': bpost?.id ?? 't3_hb1'},
  })
  const pg = await pctx.newPage()
  watch(pg, 'board')
  await pg.goto(`${base}/game.html`)
  await pg.waitForSelector('body[data-ready="1"]', {timeout: 30_000})
  check(
    'board post shows its community title',
    (await text(pg, '#title')) === 'Community board',
    await text(pg, '#title'),
  )
  check(
    'board post has its own par',
    (await text(pg, '#par')) === '1',
    await text(pg, '#par'),
  )
  check('no reveal on a board post', !(await pg.isVisible('#reveal')))
  await tapCell(pg, 33, 1)
  check(
    'the board solves with one mirror',
    (await text(pg, '#lit')) === '2/2',
    await text(pg, '#lit'),
  )
  await pg.click('#lock')
  await pg.waitForSelector('#result:not([hidden])', {timeout: 15_000})
  check(
    'board result reads "Par! 1 mirror"',
    (await text(pg, '#r-head')) === 'Par! 1 mirror',
    await text(pg, '#r-head'),
  )
  const bline = await text(pg, '#r-line')
  const broutes = await text(pg, '#r-routes')
  check(
    'board result has no day wording',
    bline === 'You are the first to find this route.' &&
      broutes.startsWith('Par routes found by everyone: 1 of 1'),
    `${bline} | ${broutes}`,
  )
  check('no countdown on a board post', !(await pg.isVisible('#r-next')))
  await pg.screenshot({path: join(out, 'board-result.png')})
  // v0.9: Escape closes the result card like Keep exploring, focus back on the tapped square
  await pg.keyboard.press('Escape')
  const pgBack = await focusName(pg)
  check(
    'a11y: Escape closes the result card',
    !(await pg.isVisible('#result')) && pgBack === 'cell:33',
    pgBack,
  )

  // desktop size
  const desk = await browser.newContext({viewport: {width: 1280, height: 800}})
  const dp = await desk.newPage()
  dp.on('pageerror', e => errors.push(`desktop pageerror: ${e.message}`))
  await dp.goto(`${base}/game.html`)
  await dp.waitForSelector('body[data-ready="1"]', {timeout: 30_000})
  await dp.screenshot({path: join(out, 'game-desktop.png')})
  // splash: outside Reddit the client SDK may complain; record, do not fail
  const sp = await ctx.newPage()
  const splashErrors: string[] = []
  sp.on('pageerror', e => splashErrors.push(e.message))
  await sp.goto(`${base}/splash.html`)
  // poll for the countdown line instead of a fixed wait (it is set before the fetch, so it shows early)
  for (let k = 0; k < 150 && !(await sp.isVisible('#next')); k++)
    await sp.waitForTimeout(100)
  await sp.screenshot({path: join(out, 'splash.png')})
  check(
    'splash renders title',
    (await text(sp, '#title')).startsWith('Lampwright'),
    await text(sp, '#title'),
  )
  check('splash offers Build a board', await sp.isVisible('#build-btn'))
  const nextLine = await text(sp, '#next')
  check(
    'splash shows the next-puzzle countdown',
    /^Next puzzle in (\d+h \d+m|\d+m|under a minute)\.$/.test(nextLine),
    nextLine,
  )
  // v0.9c: every visible splash text that sits on the page gradient, against the gradient's brightest stop
  // (#1b2470, worst case), must reach 4.5:1 (WCAG 2.2 AA for normal text). The two buttons have their own
  // solid backgrounds and are measured against those.
  const contrast = await sp.evaluate(() => {
    const parse = (c: string): number[] =>
      (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const lum = (rgb: number[]): number => {
      const [r, g, b] = rgb.map(v => {
        const s = v / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
    }
    const ratio = (f: number[], bg: number[]): number => {
      const [hi, lo] = [lum(f), lum(bg)].sort((x, y) => y - x)
      return Math.round((((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)) * 100) / 100
    }
    const page = [0x1b, 0x24, 0x70]
    const rows: {id: string; ratio: number}[] = []
    for (const id of [
      'title',
      'day',
      'pitch',
      'crowd',
      'streak',
      'yesterday',
      'next',
    ]) {
      const e = document.getElementById(id)
      if (!e || e.hidden || (e.textContent ?? '').trim() === '') continue
      rows.push({id, ratio: ratio(parse(getComputedStyle(e).color), page)})
    }
    const btn = (id: string, bg: number[]): void => {
      const e = document.getElementById(id)
      if (e) rows.push({id, ratio: ratio(parse(getComputedStyle(e).color), bg)})
    }
    btn('start-btn', [0xff, 0xd1, 0x66]) // the darker end of its gradient is the worst case for dark text
    btn('build-btn', [0x10, 0x16, 0x3a])
    return rows
  })
  const lowest = contrast.reduce((m, r) => Math.min(m, r.ratio), 99)
  check(
    'a11y: splash text contrast is at least 4.5:1',
    contrast.length >= 5 && lowest >= 4.5,
    JSON.stringify(contrast),
  )
  console.log(
    `splash yesterday line (informational): ${JSON.stringify(await text(sp, '#yesterday'))}`,
  )
  console.log(`splash errors (informational): ${JSON.stringify(splashErrors)}`)
  check('no game page errors', errors.length === 0, JSON.stringify(errors))
} catch (err) {
  check(
    'e2e ran to the end',
    false,
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  )
} finally {
  await browser.close()
}
const failed = checks.filter(c => !c.ok).length
writeFileSync(
  join(out, 'result.json'),
  `${JSON.stringify({failed, checks, errors}, null, 2)}\n`,
)
console.log(`e2e: ${checks.length - failed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
