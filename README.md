# Lampwright

A daily light-and-mirror puzzle for Reddit, built on Devvit Web.

Every day there is one new puzzle, the same for everyone. A lamp shines a single beam of light
across a small board. Place mirrors to bend the beam so it passes through every crystal. Use as
few mirrors as you can: the fewest possible is **par**.

The community part is the rarity of your route. Most days have two to six par routes. When you lock
in a solution, Lampwright shows how many of the day's solvers found your exact route, whether you were
the first to find it, and how many of the day's par routes the whole subreddit has found so far.
The goal everyone shares each day is to find all of them.

Players can also **build their own boards** and post them to the subreddit for everyone to play.

## Status

Work in progress, being made for Reddit's Daily Games Hackathon (2026). The app has not been uploaded to
Reddit yet; everything below runs in the local harness.

Last sealed check (2026-11-13, Node 24 in a fresh container): type check passes, 61 unit and server tests
pass, the build succeeds, and 103 of 103 browser checks pass (Chromium via Playwright, 390x844 phone
viewport, including the keyboard and dialog checks under Accessibility). Not yet clean: `npm run lint`
reports 5 errors and 5 warnings (two board containers that Biome wants as `<fieldset>`, an empty result
heading, an untitled help picture, the browser-check script's undeclared Playwright import, and two CSS
style rules), so `npm test` stops at lint. The fix is being checked in the next sealed run.

## How to play

1. Open the day's Lampwright post and tap **Play**. Tap **?** at any time for a short how-to-play card.
2. Tap an empty square to place a mirror (`/`). Tap it again to flip it (`\`), and a third time to remove it.
3. The beam updates as you go. Walls stop it, crystals let it pass, and the grey fixed mirrors are part of the map.
4. When every crystal glows, tap **Lock in**. Your result is checked on the server.
5. Try again for par, or look for a par route nobody has found yet. Solve on the day itself to keep your daily streak.
   After you lock in, the result card counts down to the next puzzle.
6. If you like, tap **Share result as a comment**. You see the exact text first. Only when you tap
   **Post comment** does it go up, from your own account, as a reply to the pinned Lampwright comment on
   the post. Reddit may first ask for your permission. The comment shows counts only (par or not,
   how many par routes you found), never where your mirrors go. Sharing is optional and never needed to play.
7. The result card can also join you to the community from your own account, only when you tap **Join this community**.

You have par + 1 mirrors to place. A mirror the beam never touches does not count.
The post itself shows when the next daily puzzle arrives (00:05 UTC).

## Accessibility

- **Keyboard:** the board is a single Tab stop. Arrow keys move between squares, Home and End jump to the
  ends of a row, and Enter or Space places or flips a mirror. Tab moves on to Undo, Reset and Lock in.
- **Dialogs:** the how-to-play and result cards keep keyboard focus inside them while open, and the game
  behind them is inert. Escape closes them. Closing the result card puts focus back on the square you
  last tapped.
- **Builder:** the builder works the same way. Its board and its row of square types are one Tab stop
  each; arrow keys move inside them and Enter paints or picks. The chosen square type is also bold and
  underlined, and after you post a board, focus moves to **Open the post**.
- **Screen readers:** every square has a label (for example "row 3, column 4: crystal, lit"), and the
  status line under the board announces how many crystals are still dark and when you can lock in.
- **Not by colour alone:** a lit crystal also gets a gold ring, and keyboard focus is a white outline, so
  neither depends on telling gold from purple. In Windows high-contrast mode the board keeps its own colours.
- **Contrast:** every text on the post's first screen reaches at least 4.5:1 against the brightest part of
  its background, and the browser checks measure it on every build.
- **Motion:** the shake and shine animations are off when your device asks for reduced motion.

## Build a board

1. On any Lampwright post, tap **Build a board**.
2. Pick a square type (crystal, wall, fixed mirror, lamp or eraser) and tap the board to paint it. The lamp
   sits on an edge and shines inward. You can see where its light goes as you build.
3. Tap **Check board**. Lampwright's solver tries every placement of up to 5 mirrors. If the board can
   be solved, it tells you its par and how many par routes it has. Players get par + 1 mirrors.
4. If you want to share it, tap **Post my board**. This makes a new post in the subreddit from your own
   account (Reddit may first ask for your permission). Nothing is posted unless you tap it.

Boards are made from map squares only: there is no free text anywhere in a board. Each player can post one
board a day. A board post plays like a daily puzzle (route rarity, first finders, an optional result
comment), but it never counts toward the daily streak and it has no day-after reveal. The builder lists
the subreddit's newest boards with their solver counts.

A board needs one lamp, 2 to 6 crystals, at most 24 walls and at most 4 fixed mirrors. The light must
not already reach every crystal on its own, and some route must exist with 5 mirrors or fewer.

## The day after

- Today's post shows how yesterday went: how many players solved it and how many of its par routes
  they found between them. Counts only, so nothing about today is given away.
- Older posts stay playable. Once their day is over (midnight UTC), they also offer **Show par routes**,
  which puts each par route on the board in turn and says whether any player found it. After that,
  the post no longer offers Lock in.

## What Lampwright stores

- Anonymous counts for each day and each board: solvers, players per mirror count, players per route.
- For each player who solves: their best and routes for that day or board, and their daily streak. These
  expire 30 days after the player last solved.
- The username of the first player to find each route, shown on the route diamonds. Expires 30 days
  after the latest first find.
- Which players shared a result, so each player shares at most once per puzzle. Expires after 30 days.
- Which players posted a board on a given day, so each player posts at most one a day. Expires after 2 days.
- Each community board, under its post. When the post is deleted, the board, its counts, its first-finder
  names and its share list are deleted too. A player's own best on that board expires within 30 days.
- Which day or board each post plays, and its pinned comment. Removed when the post is deleted.
- Which board post moderators featured last (a post, not a person). Forgotten when that post is deleted.

Nothing is sent outside Reddit.

## Measuring play

Lampwright reports play to Devvit Journeys, Reddit's own analytics for apps: a journey starts at your first
mirror, records how many crystals you lit, and ends when you lock in. It sends no text and no board, and
nothing is sent on a page view.

## For moderators

- A new puzzle is posted every day at 00:05 UTC, with two retries at 00:20 and 00:50 UTC in case
  the first attempt fails. There is only ever one scheduled post per day.
- The subreddit menu item **[Lampwright] Post today's puzzle** makes a post by hand.
- Open the mod menu on any community board post and choose **[Lampwright] Feature this board** to pin it
  to the top of the community. Featuring another board unpins the previous one.
- If you remove the pinned "share your result here" comment, the next shared result pins a new one.
- Community boards are ordinary posts by the players who made them, so the usual tools apply: they can
  be reported, removed or locked like any post. At most 30 boards can be posted in a subreddit per UTC day.

## How it works

- `src/shared/puzzle.ts`: the engine, shared by the client and the server. It traces the beam, runs an
  exhaustive solver (iterative deepening), and has a seeded daily generator that only accepts boards
  whose par is 2 to 4, and prefers boards with two to six par routes.
- `src/shared/board.ts`: community boards: the painting rules, the solver check that sets par, and the
  post's title and text. The builder and the server run the same check.
- `src/shared/share.ts`: the spoiler-free result text and yesterday's summary line, shared so the
  preview and the posted comment match.
- `src/shared/countdown.ts` and `src/shared/journey.ts`: the next-puzzle countdown and the Journeys rules,
  kept free of Reddit imports so they are tested in plain Node.
- `src/server/`: a plain Node request handler for Devvit Web. It caches each day's puzzle and par
  routes in Redis, re-checks every submission and every board, and keeps per-day counts (solvers,
  best-score histogram, players per route, first finder of each route) and per-player bests and streaks.
  The daily post is claimed in Redis, so the scheduler, its retries and the install trigger never
  post twice. Delete triggers clean up the post's keys and, for a board, the board itself.
- `src/client/`: the inline splash (the puzzle's number, crowd progress, yesterday, Play, Build a board,
  the next-puzzle countdown), the expanded game view (board, live beam, undo, reset, lock in, result card,
  optional share and join, par routes on old posts, how-to-play card) and the board builder.
  `src/client/polish.ts` holds the keyboard and dialog behaviour described under Accessibility; the game
  and the builder share its arrow-key board.
- `ci/sealed-job.sh`: the sealed check, one phase per call (engine, install, types, lint, unit, build,
  browser checks), as run in a fresh container before each change is published.

## Development

Requires Node 24.

```sh
npm install
npm test        # type check, lint, unit and server tests, build
node --experimental-strip-types tools/harness.ts 8787   # play locally at http://127.0.0.1:8787/
node --experimental-strip-types tools/e2e.ts http://127.0.0.1:8787 e2e-out   # browser checks (needs Playwright)
```

The local harness uses an in-memory store and never contacts Reddit. Open `/build.html` for the builder.

## Credits and licence

Lampwright is an original game by MV2 of Munim, Inc. (mv2@munimtech.com). It was made with AI agents
working in MV2's name.

Code: Apache-2.0. The project layout and build scripts started from Reddit's
`devvit-template-bare`, which is BSD-3-Clause; its licence is kept in `LICENSE-devvit-template-bare`.
