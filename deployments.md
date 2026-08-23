# Deployments

Running log of every account, credential, and verify-script output collected
during the build. M0 (accounts and credentials) closed 2026-08-22 21:55 CDT; `npm run check-env` 7 of 7. M1 items (seed data, dry-run channel) still OPEN (see `SETUP.md`) — this file is also the source for the
DoraHacks submission form fields and the S4 writeup.

## Minds

- Mind name: Callback
- Mind ID: ee7b4f3e-f36b-1410-8466-00039ce7df11
- Mind email: callback@hellominds.ai
- Mind wallet address: 0x3C88f1c398C6a7cA2Ae9dCf804Bb34790E7f088b
- `MINDS_BUILDER_API_KEY` set in `.env`: DONE 2026-08-22 21:00 CDT (key name `callback-build`, 90 days; `minds doctor` all checks ok; CLI 0.1.3). `MINDS_MIND_ID` set.
- Telegram linked: @CallbackMind_bot (display name CallbackMind), created 2026-08-22 ~20:48 CDT via Minds' `tg://newbot?manager=hellomindsbot` flow from the iPhone (no Telegram app on the Mac, so the desktop button does nothing). First Telegram reply at 20:50 referenced the earlier email greeting unprompted: cross-channel memory confirmed on day 0.
- Cognition balance: 183.03 cognitions at creation (2026-08-22), 181.69 after first chats; profile shows "≈119 days left at recent usage". US$25 top-up: OPEN (decide after M1 usage data; low-balance warning comes from the Mind itself)
- Cognition boost applied for: DONE (DoraHacks registration form submitted 2026-08-22 with Mind ID, email, wallet; track Audience growth & community engagement)
- `minds doctor` / `MindClient.doctor()` output: DONE 2026-08-22 21:02 CDT (F0 acceptance)

```
minds list: mindId ee7b4f3e-f36b-1410-8466-00039ce7df11 · name Callback · model minimax/minimax-m3 · species moca · hasTelegram true · createdAt 2026-08-23T01:06:22Z
minds mind show: email callback@hellominds.ai · walletAddress 0x3C88f1c398C6a7cA2Ae9dCf804Bb34790E7f088b · chain base
minds cognition balance: 170.75
MindClient.doctor(): roundTrip.timedOut=false · messageText "<p>ok</p>" · senderEmail callback@hellominds.ai · alias callback-main · conversationType 5 · senderType 0 · createdAt 2026-08-23T02:02:24Z · elapsed 24,655 ms
```
Build consequence: `messageText` is HTML-wrapped (`<p>…</p>`); strip tags / decode entities before locating the fenced JSON block. Round-trip latency for a trivial turn: ~25 s; budget 60-120 s for extraction turns, 180 s timeout stays.
FIXED (build terminal): `stripHtml()` in `src/mind/parse.js`, applied to every `MindClient.ask()` reply.

### DNA message (identity set 2026-08-22 20:57 CDT, app.hellominds.ai, thread "You are Callback...")
Sent: "You are Callback, a Mind for a YouTube creator. Your job: read comments I send you, remember every person who asks a question (name, what they asked, when), merge repeat askers, tell me on Sundays what people most want next, and when I publish a video that answers them, draft one short personal reply per asker in my own voice. You never post anything yourself; I approve every batch. Plain tone, no emoji, no links, no hashtags. Confirm what you understood in three lines." (a few characters were dropped by the web input; meaning intact)

Reply sequence (total 1:52): status chips Thinking -> Still thinking -> Evaluating; interim message at 20:58 "I'll notify you here when I've finished."; final at 20:58:
> Understood. I will track every commenter you send me by name, what they asked, and when, merge repeat askers into one record, give you a Sunday report on what people want most next, and when a new video answers an asker I will draft one short personal reply per asker in your voice for your approval.
> I will never post, reply, or send anything on your behalf without your explicit approval on the batch, and I will keep everything plain - no emoji, no links, no hashtags.
> Send the first comment whenever you are ready and I will start the log.

Build consequence (F2/F4, src/mind): the Mind can answer an instruction with an interim acknowledgment ("I'll notify you...") followed by the real answer as a SECOND message. `waitForReply` must not accept an interim ack as the final reply: keep listening until a message containing the requested fenced JSON block arrives (or the 180 s timeout), and treat "I'll notify you" / "I'll get back to you" style messages as non-final. Identity-setting turns took ~2 min; structured extraction turns should be timed at M1 before the demo script relies on them.
FIXED (build terminal): `MindClient.ask()` in `src/mind/client.js` now loops past any reply matching `isInterimAck()` (`src/mind/parse.js`), re-calling `waitForReply` with `afterFingerprint` set to the ack's own fingerprint, within the same overall timeout. Unit-tested with a fake event stream sending the ack first and the real reply second (`test/mind-client.test.js`).

## YouTube

- `YOUTUBE_API_KEY` set: DONE 2026-08-22 21:25 CDT — Google Cloud project `callback-hackathon` (created 21:12, last free project slot), YouTube Data API v3 enabled, key `callback-youtube-read` restricted to YouTube Data API v3; verified with commentThreads.list on a public video (2 items, API key only, no OAuth)
- OAuth client (Testing mode) created, test channel added as test user: DONE 2026-08-22 21:28 CDT — Google Auth Platform configured (app "Callback", External, Testing, user cap 2/100); test users: lmiller.phd.dabt@gmail.com (project owner) and solutions@3rdaillc.com (channel owner); OAuth client `callback-desktop` (Desktop app)
- `YOUTUBE_OAUTH_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` set: DONE 2026-08-22 21:50 CDT via `npm run setup:oauth` (scripts/setup/oauth-token.js; scope youtube.force-ssl, access_type=offline, prompt=consent). First grant landed on Science Experts AI by default; re-run choosing the brand account on Google's "Choose your account or a brand account" screen. Verified: channels.list mine=true → Mei makes things. Leftover grant on the main account: revoke "Callback" at https://myaccount.google.com/permissions?authuser=2 (manual, low priority)
- Persona test channel name: Mei makes things (@meimakesthings_callback), brand account under solutions@3rdaillc.com (Workspace-managed), created 2026-08-22 21:38 CDT; YouTube showed an "Oops, sign out and sign in again" page right after creation — the channel existed anyway
- Persona test channel id (`YOUTUBE_TEST_CHANNEL_ID`): UCwgJK_Fm5G_xxf4P6WoOMKw (uploads playlist UUwgJK_Fm5G_xxf4P6WoOMKw); 0 videos as of 21:55 CDT
- Dry-run channel (see `seed/dryrun-channel.md`): OPEN

## Submission form fields (DoraHacks)

- Mind ID: ee7b4f3e-f36b-1410-8466-00039ce7df11
- Mind email: callback@hellominds.ai
- Mind wallet address: 0x3C88f1c398C6a7cA2Ae9dCf804Bb34790E7f088b
- X handle, WhatsApp number: see `private/submission-fields.md` (gitignored — personal contact data)
- School: N/A
- Track: Audience growth & community engagement
- Other AI tech: Claude, Other: YouTube Data API

## Verify script outputs

Paste each script's console output here as it passes. See `README.md` "Verify
walkthrough" for how to run each one.

### T-01 (F1 harvest idempotent)
```
2026-08-22 21:55 CDT — NOT YET PASSABLE: `npm run verify:t01` → "The playlist identified with the request's playlistId parameter cannot be found."
Root cause confirmed with the raw API: channels.list → videoCount 0; playlistItems.list(UUwgJK_Fm5G_xxf4P6WoOMKw) → 404 playlistNotFound.
YouTube returns 404 for the uploads playlist of a channel that has never uploaded. Harvest (F1) and upload polling (F4) must treat playlistNotFound as "0 videos", not as an error. Re-run after video 1 is uploaded (M1).

2026-08-22 (build terminal) — FIXED: src/youtube/client.js's listRecentVideos now catches 404 playlistNotFound from playlistItems.list and returns []. Re-run against the live channel:
First run:  0 videos, 0 new comments, comments-off: []
Second run: 0 videos, 0 new comments
T-01 PASS: re-run added zero duplicates.
(0 videos is correct and expected until M1's video 1 is uploaded; the fix is that this no longer throws.)
```

### T-02 (F6 reply.parentId)
```
OPEN
```

### T-03 (order proof: ask < video < reply, never-twice)
```
OPEN
```

### T-04 (quota queue)
```
2026-08-22 21:55 CDT — `npm run verify:t04`: Pacific day 2026-08-22 · Quota used 0 / 10000 · Queued replies 0 (queue empty; unit-level proof in test/quota-queue.test.js)
```

### T-05 (match+draft QA grep)
```
OPEN
```

### T-06 (Mind memory query, three consecutive runs)
```
Run 1: OPEN
Run 2: OPEN
Run 3: OPEN
```

## S6 — Telegram push question

Question asked at an office hour: "does a Builder-API-initiated turn push to
the steward's Telegram?"

- Answer: OPEN
- Fallback confirmed as the demo path (email vs. Telegram): OPEN

## Remaining manual steps

Everything marked OPEN above. See `SETUP.md` for the exact order.
