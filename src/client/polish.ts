// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// v0.6 polish for the game view: the how-to-play dialog, the next-puzzle countdown on the
// result card, arrow-key movement between squares, and a short buzz on a saved solve.
// v0.9 accessibility: one Tab stop for the whole board (roving tabindex), dialogs keep
// keyboard focus inside them and make the page behind them inert, Escape closes them.
// v0.9b: arrowKeys takes the square's data attribute, so the builder (data-bcell) shares it.
import {nextPuzzleText} from '../shared/countdown.ts'

function byId<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw Error(`missing #${id}`)
  return e as T
}

/** The game page behind a dialog is inert (no Tab, no screen reader) while any dialog is open. */
export function syncInert(): void {
  const open = ['help', 'result'].some(id => {
    const d = document.getElementById(id)
    return d !== null && !d.hidden
  })
  byId('app').toggleAttribute('inert', open)
}

/** Buttons a keyboard user can reach inside `dlg`, in page order. */
function tabbable(dlg: HTMLElement): HTMLElement[] {
  return Array.from(dlg.querySelectorAll<HTMLButtonElement>('button')).filter(
    b => !b.disabled && b.getClientRects().length > 0,
  )
}

/** Tab and Shift+Tab wrap around inside an open dialog instead of leaving it. */
export function trapFocus(dlg: HTMLElement): void {
  dlg.addEventListener('keydown', ev => {
    if (ev.key !== 'Tab' || dlg.hidden) return
    const list = tabbable(dlg)
    const first = list[0]
    const last = list[list.length - 1]
    if (!first || !last) return
    const at = document.activeElement
    if (ev.shiftKey && (at === first || !dlg.contains(at))) {
      ev.preventDefault()
      last.focus()
    } else if (!ev.shiftKey && (at === last || !dlg.contains(at))) {
      ev.preventDefault()
      first.focus()
    }
  })
}

/** The "?" button opens a short how-to-play card; Got it, Escape or a tap outside closes it. */
export function setupHelp(): void {
  const dlg = byId('help')
  const open = byId<HTMLButtonElement>('help-btn')
  const close = byId<HTMLButtonElement>('help-close')
  const hide = (): void => {
    if (dlg.hidden) return
    dlg.hidden = true
    syncInert()
    open.focus()
  }
  open.addEventListener('click', () => {
    dlg.hidden = false
    syncInert()
    close.focus()
  })
  close.addEventListener('click', hide)
  dlg.addEventListener('click', ev => {
    if (ev.target === dlg) hide()
  })
  trapFocus(dlg)
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || dlg.hidden) return
    ev.preventDefault() // this Escape is used up: it must not also close the result card
    hide()
  })
}

let timer: ReturnType<typeof setInterval> | undefined

/** Shows "Next puzzle in ..." in `box` and keeps it current while the result card is open. */
export function startCountdown(box: HTMLElement): void {
  stopCountdown()
  const tick = (): void => {
    box.textContent = nextPuzzleText(Date.now())
  }
  tick()
  box.hidden = false
  timer = setInterval(tick, 20_000)
}

export function stopCountdown(): void {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}

const STEP: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** Makes `cell` the single Tab stop among the elements matching `sel` inside `box`. */
export function rove(box: HTMLElement, cell: HTMLElement, sel: string): void {
  for (const c of Array.from(box.querySelectorAll<HTMLElement>(sel)))
    c.tabIndex = c === cell ? 0 : -1
}

/**
 * Arrow keys move focus between the board's squares; Enter or Space taps the focused one.
 * Home and End jump to the first and last square of the row. The board is one Tab stop:
 * Tab goes from the board straight to the next control instead of through every square.
 * `attr` is the squares' data attribute without "data-": "cell" in the game, "bcell" in the builder.
 */
export function arrowKeys(
  board: HTMLElement,
  w: number,
  h: number,
  attr = 'cell',
): void {
  const sel = `[data-${attr}]`
  const first = board.querySelector<HTMLElement>(sel)
  if (first) rove(board, first, sel)
  board.addEventListener('focusin', ev => {
    const cell = (ev.target as HTMLElement | null)?.closest<HTMLElement>(sel)
    if (cell && cell.tabIndex !== 0) rove(board, cell, sel)
  })
  board.addEventListener('keydown', ev => {
    const from = (ev.target as HTMLElement | null)?.closest<HTMLElement>(sel)
    if (!from) return
    const i = Number(from.dataset[attr])
    let x = i % w
    let y = Math.floor(i / w)
    const step = STEP[ev.key]
    if (step) {
      x += step[0]
      y += step[1]
    } else if (ev.key === 'Home') {
      x = 0
    } else if (ev.key === 'End') {
      x = w - 1
    } else {
      return
    }
    ev.preventDefault()
    if (x < 0 || x >= w || y < 0 || y >= h) return
    board.querySelector<HTMLElement>(`[data-${attr}="${y * w + x}"]`)?.focus()
  })
}

/** A short vibration when a solve is saved, where the device and the post frame allow it. */
export function buzz(): void {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(40)
  } catch {
    // not allowed inside this frame
  }
}
