// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// In-memory stand-in for the Devvit Redis methods Lampwright uses. Tests and the
// local harness only; production code never imports this file.
import {redis} from '@devvit/web/server'

export type FakeRedis = {
  strings: Map<string, string>
  hashes: Map<string, Map<string, string>>
  ttl: Map<string, number> // key -> seconds from the last expire() call
  clear(): void
  restore(): void
}

export function installFakeRedis(): FakeRedis {
  const strings = new Map<string, string>()
  const hashes = new Map<string, Map<string, string>>()
  const ttl = new Map<string, number>()
  const hash = (key: string): Map<string, string> => {
    let h = hashes.get(key)
    if (!h) {
      h = new Map<string, string>()
      hashes.set(key, h)
    }
    return h
  }
  const saved = {
    get: redis.get,
    set: redis.set,
    del: redis.del,
    incrBy: redis.incrBy,
    expire: redis.expire,
    hGet: redis.hGet,
    hGetAll: redis.hGetAll,
    hSet: redis.hSet,
    hSetNX: redis.hSetNX,
    hIncrBy: redis.hIncrBy,
    hDel: redis.hDel,
  }
  redis.get = async (key: string): Promise<string | undefined> =>
    strings.get(key)
  redis.set = async (key: string, value: string): Promise<string> => {
    strings.set(key, value)
    ttl.delete(key) // like Redis SET without options, a new value has no expiry
    return 'OK'
  }
  redis.del = async (...keys: string[]): Promise<void> => {
    for (const k of keys) {
      strings.delete(k)
      hashes.delete(k)
      ttl.delete(k)
    }
  }
  redis.incrBy = async (key: string, value: number): Promise<number> => {
    const v = Number(strings.get(key) ?? 0) + value
    strings.set(key, String(v))
    return v
  }
  redis.expire = async (key: string, seconds: number): Promise<void> => {
    if (strings.has(key) || hashes.has(key)) ttl.set(key, seconds)
  }
  redis.hGet = async (
    key: string,
    field: string,
  ): Promise<string | undefined> => hashes.get(key)?.get(field)
  redis.hGetAll = async (key: string): Promise<Record<string, string>> =>
    Object.fromEntries(hashes.get(key) ?? new Map<string, string>())
  redis.hSet = async (
    key: string,
    fieldValues: {[field: string]: string},
  ): Promise<number> => {
    const h = hash(key)
    let added = 0
    for (const [f, v] of Object.entries(fieldValues)) {
      if (!h.has(f)) added++
      h.set(f, v)
    }
    return added
  }
  redis.hSetNX = async (
    key: string,
    field: string,
    value: string,
  ): Promise<number> => {
    const h = hash(key)
    if (h.has(field)) return 0
    h.set(field, value)
    return 1
  }
  redis.hIncrBy = async (
    key: string,
    field: string,
    value: number,
  ): Promise<number> => {
    const h = hash(key)
    const v = Number(h.get(field) ?? 0) + value
    h.set(field, String(v))
    return v
  }
  redis.hDel = async (key: string, fields: string[]): Promise<number> => {
    const h = hashes.get(key)
    let n = 0
    for (const f of fields) if (h?.delete(f)) n++
    return n
  }
  return {
    strings,
    hashes,
    ttl,
    clear(): void {
      strings.clear()
      hashes.clear()
      ttl.clear()
    },
    restore(): void {
      Object.assign(redis, saved)
    },
  }
}
