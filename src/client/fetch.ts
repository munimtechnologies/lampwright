// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Typed calls from the Lampwright client to its server.
import type {
  BoardPostReq,
  BoardPostRsp,
  BoardsRsp,
  ErrorRsp,
  JoinRsp,
  RevealRsp,
  ShareReq,
  ShareRsp,
  SubmitReq,
  SubmitRsp,
  TodayRsp,
} from '../shared/api.ts'
import {Endpoint} from '../shared/api.ts'

export type Result<T> =
  | {ok: true; value: T}
  | {ok: false; status: number; error: string}

/** GET when `json` is undefined, else POST it. Never throws. */
async function call<T>(url: string, json?: string): Promise<Result<T>> {
  const init: RequestInit =
    json === undefined
      ? {headers: {Accept: 'application/json'}}
      : {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: json,
        }
  let rsp: Response
  try {
    rsp = await fetch(url, init)
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
  let body: unknown
  try {
    body = await rsp.json()
  } catch {
    body = undefined
  }
  if (!rsp.ok) {
    const e = body as Partial<ErrorRsp> | undefined
    return {ok: false, status: rsp.status, error: e?.error ?? rsp.statusText}
  }
  return {ok: true, value: body as T}
}

export function fetchToday(): Promise<Result<TodayRsp>> {
  return call<TodayRsp>(Endpoint.Today)
}

export function fetchSubmit(req: SubmitReq): Promise<Result<SubmitRsp>> {
  return call<SubmitRsp>(Endpoint.Submit, JSON.stringify(req))
}

/** Only called from the Share confirm button. */
export function fetchShare(req: ShareReq): Promise<Result<ShareRsp>> {
  return call<ShareRsp>(Endpoint.Share, JSON.stringify(req))
}

/** A past day's par routes (the server refuses until the day is over). */
export function fetchReveal(day: string): Promise<Result<RevealRsp>> {
  return call<RevealRsp>(`${Endpoint.Reveal}?day=${encodeURIComponent(day)}`)
}

/** Only called from the builder's Post button, after the player confirms. */
export function fetchBoardPost(
  req: BoardPostReq,
): Promise<Result<BoardPostRsp>> {
  return call<BoardPostRsp>(Endpoint.BoardPost, JSON.stringify(req))
}

export function fetchBoards(): Promise<Result<BoardsRsp>> {
  return call<BoardsRsp>(Endpoint.Boards)
}

/** Only called from the result card's Join button. */
export function fetchJoin(): Promise<Result<JoinRsp>> {
  return call<JoinRsp>(Endpoint.Join, '{}')
}
