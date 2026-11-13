// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Asks Reddit for permission to post or comment from the player's own account.
// Called only from the button the player just tapped (a trusted event).

type TestWindow = {lampwrightTestConsent?: unknown}

/**
 * True when the player has granted the app's "as user" permissions. Reddit shows
 * its own permission prompt if needed. The client SDK is loaded only here, on tap,
 * so the game itself never depends on it. The local test harness (never on Reddit)
 * sets `lampwrightTestConsent` instead, because there is no Reddit to ask.
 */
export async function askToPostAsUser(ev: MouseEvent): Promise<boolean> {
  if ((globalThis as unknown as TestWindow).lampwrightTestConsent === true)
    return true
  try {
    const {canRunAsUser} = await import('@devvit/web/client')
    return await canRunAsUser(ev)
  } catch (err) {
    console.warn(
      `permission check failed: ${err instanceof Error ? err.message : err}`,
    )
    return false
  }
}

/** Opens a post (or any Reddit URL) in the Reddit client. */
export async function openOnReddit(url: string): Promise<void> {
  try {
    const {navigateTo} = await import('@devvit/web/client')
    navigateTo(url)
  } catch (err) {
    console.warn(
      `could not open ${url}: ${err instanceof Error ? err.message : err}`,
    )
  }
}
