// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Measures the daily generator: par spread, distinct par routes, time per day.
// Usage: node --experimental-strip-types tools/genstats.ts <first-day YYYY-MM-DD> <days> <out.jsonl>
import {writeFileSync} from 'node:fs'
import {crystals, generate, search} from '../src/shared/puzzle.ts'

const first = new Date(`${process.argv[2] ?? '2026-11-12'}T00:00:00Z`)
const days = Number(process.argv[3] ?? '90')
const out = process.argv[4] ?? 'genstats.jsonl'
const lines: string[] = []
const pars: {[par: string]: number} = {}
const times: number[] = []
const routeTimes: number[] = []
const minimal: number[] = []
let failed = 0
let incomplete = 0
let inRange = 0
for (let k = 0; k < days; k++) {
  const id = new Date(first.getTime() + k * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const t0 = performance.now()
  try {
    const p = generate(id)
    const ms = performance.now() - t0
    const t1 = performance.now()
    const r = search(p, p.par, 64, 3_000_000) // the same call the server makes
    const routeMs = performance.now() - t1
    if (!r.complete) incomplete++
    if (r.complete && r.solutions.length >= 2 && r.solutions.length <= 6)
      inRange++
    const walls = p.rows.join('').split('#').length - 1
    times.push(ms)
    routeTimes.push(routeMs)
    minimal.push(r.solutions.length)
    pars[p.par] = (pars[p.par] ?? 0) + 1
    lines.push(
      JSON.stringify({
        id,
        par: p.par,
        budget: p.budget,
        crystals: crystals(p).length,
        walls,
        parRoutes: r.solutions.length,
        complete: r.complete,
        ms: Math.round(ms),
        routeMs: Math.round(routeMs),
        rows: p.rows,
        dir: p.dir,
      }),
    )
    if (k < 6) {
      console.log(
        `${id} par ${p.par} dir ${p.dir} par routes ${r.solutions.length} (${Math.round(ms)} + ${Math.round(routeMs)} ms)`,
      )
      for (const row of p.rows) console.log(`  ${row}`)
    }
  } catch (err) {
    failed++
    lines.push(
      JSON.stringify({
        id,
        error: String(err),
        ms: Math.round(performance.now() - t0),
      }),
    )
  }
}
writeFileSync(out, `${lines.join('\n')}\n`)
const q = (xs: number[], f: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? -1)
}
console.log(
  JSON.stringify({
    days,
    failed,
    incomplete,
    pars,
    ms_median: q(times, 0.5),
    ms_p95: q(times, 0.95),
    ms_max: q(times, 1),
    route_ms_p95: q(routeTimes, 0.95),
    route_ms_max: q(routeTimes, 1),
    par_routes_median: q(minimal, 0.5),
    par_routes_max: q(minimal, 1),
    days_with_one_par_route: minimal.filter(m => m === 1).length,
    days_with_2_to_6_par_routes: inRange,
  }),
)
