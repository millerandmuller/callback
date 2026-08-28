# Deployments

Running log of every account, credential, and verify-script output collected
during the build. M0 (accounts and credentials) closed 2026-08-22 21:55 CDT; `npm run check-env` 7 of 7. M1 items (seed data, dry-run channel) still OPEN (see `SETUP.md`) — this file is also the source for the
DoraHacks submission form fields and the S4 writeup.

## Repository

- Submission URL: https://github.com/millerandmuller/callback (pushed 2026-08-28 with full history)
- Visibility: starts PRIVATE (team decision); MIT license (auto-detected from the committed `LICENSE` file)
- **Must be switched to public before the 2026-08-28 10:59 CDT submission deadline** — DoraHacks requires a public code repository. The flip is done by hand in the GitHub repo settings. Track this as an open item until flipped.

## Minds

- Mind name: Callback
- Mind ID: ee7b4f3e-f36b-1410-8466-00039ce7df11
- Mind email: callback@hellominds.ai
- Mind wallet address: 0x3C88f1c398C6a7cA2Ae9dCf804Bb34790E7f088b
- `MINDS_BUILDER_API_KEY` set in `.env`: DONE 2026-08-22 21:00 CDT (key name `callback-build`, 90 days; `minds doctor` all checks ok; CLI 0.1.3). `MINDS_MIND_ID` set.
- Telegram linked: @CallbackMind_bot (display name CallbackMind), created 2026-08-22 ~20:48 CDT via Minds' `tg://newbot?manager=hellomindsbot` flow from the iPhone (no Telegram app on the Mac, so the desktop button does nothing). First Telegram reply at 20:50 referenced the earlier email greeting unprompted: cross-channel memory confirmed on day 0.
- Cognition balance: 183.03 cognitions at creation (2026-08-22), 181.69 after first chats; profile shows "≈119 days left at recent usage". US$25 top-up: DONE 2026-08-25 ~09:05 CDT via Stripe checkout from the Mind's Top Up menu (one-time, transaction ref `cs_live_a1AfTfW5svNtZICYtZPKGecdtk5CCcyMGhv1BPUQCYkIym5D211nOhPfsn`). Balance after top-up: **1,064.25 cognitions** (`getCognitionBalance`), i.e. ~1,000 added to the ~64 that remained — the Mind's Aug 23 "down to a sliver" warnings were accurate. Usage to date: Aug 23: 185.2 · Aug 24: 64.3 · Aug 25 (to ~09:00): 63.1. At the Day-1 heavy rate (~185/day) the new balance covers ~5 rehearsal-grade days; comfortably past the Thu submission. Note: the app's "runway" chip is unreliable (flapped between "<1 day" and "8.5 days" pre-top-up, and lagged after payment) — trust `getCognitionBalance`.
- Cognition boost applied for: DONE (DoraHacks registration form submitted 2026-08-22 with Mind ID, email, wallet; track Audience growth & community engagement)
- `minds doctor` / `MindClient.doctor()` output: DONE 2026-08-22 21:02 CDT (F0 acceptance)

```
minds list: mindId ee7b4f3e-f36b-1410-8466-00039ce7df11 · name Callback · model minimax/minimax-m3 · species moca · hasTelegram true · createdAt 2026-08-23T01:06:22Z
minds mind show: email callback@hellominds.ai · walletAddress 0x3C88f1c398C6a7cA2Ae9dCf804Bb34790E7f088b · chain base
minds cognition balance: 170.75
MindClient.doctor(): roundTrip.timedOut=false · messageText "<p>ok</p>" · senderEmail callback@hellominds.ai · alias callback-main · conversationType 5 · senderType 0 · createdAt 2026-08-23T02:02:24Z · elapsed 24,655 ms
```
Build consequence: `messageText` is HTML-wrapped (`<p>…</p>`); strip tags / decode entities before locating the fenced JSON block. Round-trip latency for a trivial turn: ~25 s; budget 60-120 s for extraction turns, 180 s timeout stays.
FIXED (build session): `stripHtml()` in `src/mind/parse.js`, applied to every `MindClient.ask()` reply.

### DNA message (identity set 2026-08-22 20:57 CDT, app.hellominds.ai, thread "You are Callback...")
Sent: "You are Callback, a Mind for a YouTube creator. Your job: read comments I send you, remember every person who asks a question (name, what they asked, when), merge repeat askers, tell me on Sundays what people most want next, and when I publish a video that answers them, draft one short personal reply per asker in my own voice. You never post anything yourself; I approve every batch. Plain tone, no emoji, no links, no hashtags. Confirm what you understood in three lines." (a few characters were dropped by the web input; meaning intact)

Reply sequence (total 1:52): status chips Thinking -> Still thinking -> Evaluating; interim message at 20:58 "I'll notify you here when I've finished."; final at 20:58:
> Understood. I will track every commenter you send me by name, what they asked, and when, merge repeat askers into one record, give you a Sunday report on what people want most next, and when a new video answers an asker I will draft one short personal reply per asker in your voice for your approval.
> I will never post, reply, or send anything on your behalf without your explicit approval on the batch, and I will keep everything plain - no emoji, no links, no hashtags.
> Send the first comment whenever you are ready and I will start the log.

Build consequence (F2/F4, src/mind): the Mind can answer an instruction with an interim acknowledgment ("I'll notify you...") followed by the real answer as a SECOND message. `waitForReply` must not accept an interim ack as the final reply: keep listening until a message containing the requested fenced JSON block arrives (or the 180 s timeout), and treat "I'll notify you" / "I'll get back to you" style messages as non-final. Identity-setting turns took ~2 min; structured extraction turns should be timed at M1 before the demo script relies on them.
FIXED (build session): `MindClient.ask()` in `src/mind/client.js` now loops past any reply matching `isInterimAck()` (`src/mind/parse.js`), re-calling `waitForReply` with `afterFingerprint` set to the ack's own fingerprint, within the same overall timeout. Unit-tested with a fake event stream sending the ack first and the real reply second (`test/mind-client.test.js`).

### Round 2 adversarial review findings (build session, 2026-08-22)

- **stripHtml angle-bracket bug (adversarial find):** the tag-stripping regex treated any `<...>` span as a tag, silently deleting real reply content containing two literal angle brackets (e.g. "ISO < 800 and f-stop > 2.8"). FIXED: regex now requires a letter, `/`, or `!` right after `<`. Live round trip confirming the fix (asked the Mind to echo `ISO < 800 and f-stop > 2.8` verbatim): the reply that came back on this attempt did not actually answer the question (see the concurrency finding below for why) — retry after the concurrency fix, or during M1, before fully trusting this against a live reply containing real angle brackets.
- **Empty-reply-as-final bug:** `isInterimAck('')` is correctly `false`, but `ask()` was returning a blank post-strip reply as final anyway. FIXED: `ask()` now waits past blank replies too.
- **Concurrency cross-talk (live-discovered, serious):** while live-testing the angle-bracket fix, a direct raw-client call returned a different concurrent caller's reply instead of its own — confirmed via `getHistory()` timestamps that a concurrent review process's own dry-run extraction call was mid-flight on the same `callback-main` conversation at the same moment. Root cause: `waitForReply` isn't scoped strictly enough to guarantee it returns the calling request's own reply when two calls overlap on one conversation. Reachable in production whenever the harvest (30 min) and upload-poll (10 min) crons fire close enough together — Beat 3/4 territory, could attach the wrong drafted reply to a real live comment. FIXED: `MindClient` now serializes every `ask()` call against a per-instance queue; regression-tested (`test/mind-client.test.js`) by simulating exactly this overlap.
- **E5 timing (demo-strategy item, not a bug):** a real dry run against a public channel with realistic comment volume took 4-5 minutes for a single video's classification, far past E5's "under 90s" acceptance criterion. The mechanism itself was correct (real harvest, real on-topic extraction, no ack leakage, correct HTML stripping) — the Mind's live classification latency is just much higher than the brief assumed. Mitigation already built in for free: `harvest()` is idempotent and only unclassified comments get sent to the Mind, so a second dry run of an already-seen channel with nothing new is near-instant. **Action: pre-warm the chosen dry-run channel during rehearsal, well before recording** (now noted in `SETUP.md` section 7 and `README.md`'s verify walkthrough).
- **Corrected finding:** a round-2 review pass reported the runtime `data/callback.sqlite` vanishing from disk mid-session with an unidentified cause. Traced to a cleanup command (`rm -f data/callback.sqlite ...`) colliding with a concurrently running background test server, which still had the file open (delete-while-open, not an external actor). No tracked file affected; no real seed data existed yet to lose. Lesson: don't `rm` the runtime DB path without checking for a running server first.

## YouTube

- `YOUTUBE_API_KEY` set: DONE 2026-08-22 21:25 CDT — Google Cloud project `callback-hackathon` (created 21:12, last free project slot), YouTube Data API v3 enabled, key `callback-youtube-read` restricted to YouTube Data API v3; verified with commentThreads.list on a public video (2 items, API key only, no OAuth)
- OAuth client (Testing mode) created, test channel added as test user: DONE 2026-08-22 21:28 CDT — Google Auth Platform configured (app "Callback", External, Testing, user cap 2/100); test users: lmiller.phd.dabt@gmail.com (project owner) and solutions@3rdaillc.com (channel owner); OAuth client `callback-desktop` (Desktop app)
- `YOUTUBE_OAUTH_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` set: DONE 2026-08-22 21:50 CDT via `npm run setup:oauth` (scripts/setup/oauth-token.js; scope youtube.force-ssl, access_type=offline, prompt=consent). First grant landed on Science Experts AI by default; re-run choosing the brand account on Google's "Choose your account or a brand account" screen. Verified: channels.list mine=true → Mei makes things. Leftover grant on the main account: revoke "Callback" at https://myaccount.google.com/permissions?authuser=2 (manual, low priority)
- Persona test channel name: Mei makes things (@meimakesthings_callback), brand account under solutions@3rdaillc.com (Workspace-managed), created 2026-08-22 21:38 CDT; YouTube showed an "Oops, sign out and sign in again" page right after creation — the channel existed anyway
- Persona test channel id (`YOUTUBE_TEST_CHANNEL_ID`): UCwgJK_Fm5G_xxf4P6WoOMKw (uploads playlist UUwgJK_Fm5G_xxf4P6WoOMKw); video 1 = 0IF_iEFkRE8 published 2026-08-23 07:03 CDT; video 2 = D8ZAgrpYRcM "Darn a hole in a jumper without it puckering" (4:38) published public 2026-08-23 07:06 CDT (12:06:40Z) with the same settings as video 1 (not made for kids, AI-use disclosure No, language English, comments On, moderation None, anyone; NotebookLM disclosed in the description); verified via videos.list privacyStatus=public and the API-key uploads playlist (2 items)
- Dry-run channel (see `seed/dryrun-channel.md`): CHOSEN 2026-08-23 07:40 CDT — @roxannerichardson (UCSPrWB2SZXVCj2-PH-36xBA, 166k subs, knitting/re-knitting, uploads every 2 weeks, 242 comments on the last 5 uploads, 18 unanswered questions older than 14 days); runner-up @xiaoxiaoyarn. Shortlist method: 3 `search.list` queries (300 units) + 1-unit reads over 16 band channels; `resolveChannel('@roxannerichardson')` verified. Pre-warm (~25 min of Mind time) still OPEN: first run during rehearsal 1 on Wed, never first on camera.

### Round 3 — unlisted-first flow implemented (build session, 2026-08-23)

- **F4:** the own-channel upload poll (`runUploadPollCycle`) now polls
  `listRecentVideos` with the same OAuth-authenticated write client used for
  posting (`createWriteClient`), not the API-key read client — a channel's
  public uploads-playlist listing never includes an unlisted video for an
  API-key caller, only the owner's own OAuth-authenticated request sees it.
  `index.js` creates `ytWrite` at startup alongside `ytRead`; schedulers
  only start once both plus the Mind are ready, same as before.
- **F6:** `postApprovedBatch` now reads the answering video's `privacyStatus`
  fresh (`videos.list`) before its first `comments.insert` per batch, and
  refuses to post while it's unlisted or private. A new posting-poll cron
  runs every `POSTING_POLL_INTERVAL_SEC` (default 30s, new env var, not
  required by `check-env` — it has a default) and retries every
  approved-but-unposted batch; the approval page shows "Waiting for the
  video to go public" with its own 30s refresh while waiting.
- No live-credential changes this round — `npm run check-env` still 7/7,
  re-verified after the change. App boots cleanly with all three schedulers
  (harvest 30m, upload poll 10m, posting poll 30s) and `GET /ledger` returns
  200 against a live smoke-test start/stop.
- These two flows (video 3 unlisted → drafted → approved → set public →
  posted within the 20s throttle) still need a real M1 upload to exercise
  end to end — tracked as the same M1 milestone as before, unchanged by this
  round. See the round 3 commits (`b59c4fb`..`f34219d`) for the full commit-by-commit
  breakdown.

### Round 3 — review + fixes (build session, 2026-08-23)

- Four independent review passes (baseline, features, demo, adversarial) covered the above. Baseline and features PASS
  (55/55 tests after this sub-phase's fixes; live-verified `privacyStatus`
  against the real YouTube API with both credentials, including the exact
  OAuth client F6 uses). Demo: `NOT STAGE-READY` (same M1 blocker as Round 2,
  unchanged) plus one new unresolved risk (below). Adversarial found and this
  session fixed: overlapping posting-poll cron ticks were breaking F6's 20s
  reply throttle (P2, fixed — `batchesInFlight` guard in `cron.js`); the
  approval page showed a misleading static "approved" state on a transient
  privacy-check failure instead of "waiting" (P3, fixed). Documented, not
  fixed: a deleted answering video causes an indefinite silent retry (P3, low
  reachability — README "after the hackathon").
- **Open risk, highest priority for M1:** whether the channel's uploads
  playlist actually returns an unlisted video to the OAuth-authenticated
  owner — F4's core detection mechanism assumes yes, never verified against
  a real unlisted video. See `SETUP.md` section 7 for the exact 5-minute
  check to run first, and the build log (2026-08-23) for the full
  reasoning on why this wasn't resolved by a speculative rewrite this
  session.
- `VERDICT: FAIL` (forced by `DEMO-VERDICT: NOT STAGE-READY`, same as every
  round since M0 — not moveable by code alone). Per the Round 1→2 precedent,
  the round stops here rather than looping further; only M1 can move it.

### Unlisted-upload detection assumption (F4) — VERIFIED 2026-08-23 05:17 CDT
```
Method: two 3-second throwaway clips uploaded UNLISTED via videos.insert with the Mei makes things OAuth token, then polled, then deleted (HTTP 204 each; channel back to 0 uploads).
t+8s   playlistItems.list(UUwgJK_Fm5G_xxf4P6WoOMKw, OAuth): 0 items (propagation lag)
t+16s  playlistItems.list(UUwgJK_Fm5G_xxf4P6WoOMKw, OAuth): 1 item, status.privacyStatus=unlisted, video processingStatus=processing
       search.list forMine=true: finds the same video (100 units; not needed)
       playlistItems.list with API key: 404 playlistNotFound (API key sees public uploads only)
Conclusion: the owner OAuth client sees unlisted uploads in the uploads playlist within ~15 s; the 10-minute F4 poll has margin. SETUP.md §7 5-minute check can be marked done.
Quota note: ~3,400 units of the 2026-08-23 Pacific day consumed by the probe (2 inserts at 1,600, 1 search at 100, 2 deletes at 50); resets at midnight Pacific.
```

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
2026-08-23 07:05 CDT — PASS. Video 1 published public (0IF_iEFkRE8, "The button that never falls off again", 7:43; not made for kids; comments on, moderation None, anyone; language English; AI-use disclosure: No (illustrated explainer, generic synthetic narrator; NotebookLM disclosed in the description)).
API-key uploads playlist now returns the video (the earlier 404 playlistNotFound was the zero-uploads case, as recorded).
`npm run verify:t01`: First run 1 videos, 0 new comments, comments-off []; Second run 1 videos, 0 new comments → T-01 PASS (re-run added zero duplicates). Re-run after tester comments land to confirm idempotency with real rows.
2026-08-23 07:08 CDT — after video 2 (D8ZAgrpYRcM) published: First run 2 videos, 0 new comments, comments-off []; Second run 2 videos, 0 new comments → T-01 PASS. Still 0 comments: the Sunday tester comments have not landed yet.
2026-08-25 ~08:15 CDT — with real tester comments: First run 2 videos, 13 new comments; Second run 0 new → PASS. Re-run after the Tuesday top-up (T7/T8/T10) and after pruning T10's two deleted duplicates from the DB: 17 comments, 0 new on re-run → PASS. DB mirrors YouTube exactly.
```

### M1 first live extraction (F2) — 2026-08-25, ops session

```
Seed state: 17 of 19 planned comments live (T9's c2 and T6's cuff c5 unsent; T4's Monday
non-ask was posted from the persona channel's own account, excluded via is_owner_reply).
Ledger result (after fixes below): 16 non-owner comments classified; 12 open asks from
9 distinct people; T1 merged to ONE row, first 2026-08-23 / last 2026-08-24, 2 events;
T4 Sunday filtered as non-ask; T10 flagged abusive, never an ask; T3's "Same here, moth
holes. Following." reply classified NON-ask by the Mind (defensible; prompt-tuning
question, noted in seed/testers.md ground truth).

REAL MIND EXTRACTION LATENCY (the pre-warm rule's justification):
- video 2 batch, 6 comments: 3m46s ask -> answer (13:35:33 -> 13:39:19 UTC)
- video 1 batch, 10 comments: ~10m10s from first ask (13:39:21 -> 13:49:31 UTC);
  a duplicate stricter re-ask at 13:42:23 muddies attribution. Far above the brief's
  original 90s target, consistent with Round 2's 4-5 min/video finding. The
  unlisted-first flow absorbs this for Beat 3; the E5 dry run MUST be pre-warmed.

THREE BUGS FOUND LIVE AND FIXED (uncommitted; tests 59/59):
1. parse.js parseFencedJson required a newline after the fence opener; the Builder
   API's HTML wrapping can collapse the reply to "```json[{...}]```" on one line, so
   a valid extraction was discarded. Regex now tolerates a missing newline.
2. client.js _askOnce called waitForReply with no initial afterFingerprint; the lib
   matches ANY prior Mind message then (sequential stale-reply: video 1's ask
   "received" video 2's answer from 2s before its own send; an Aug 23 credit-warning
   message was also matched as a reply). Now anchors with getLatestHistoryFingerprint
   before every send. (Round 2's lock only covered the concurrent variant.)
3. ledger.js bumpAsk only raised last_asked_at; a batch arriving out of chronological
   order left T1's first_asked_at a day late (Beat 3 shows "asked Sun - again Mon").
   bumpAsk now maintains both bounds; live rows recomputed from ask_events.

Platform findings: the Mind's reply wrapping varies per message — backtick fence
without newline (13:39) AND <pre><code class="language-json"> (13:49) observed within
10 minutes; parse handles both. Both answers were salvaged from conversation history
and merged at ZERO extra cognition cost.

Cognition usage (getCognitionUsage): Aug 23: 185.2, Aug 24: 64.3, Aug 25 so far: 63.1
(~313 total). The Mind warned twice on Aug 23 that credits are "down to a sliver".
Top-up decision (US$25) is now timely — before the Tue-evening Sunday-brief trigger
and Wed rehearsal.
```

### M2 F3 wiring + memory-scoping fix — 2026-08-27 evening, ops session (endgame)

```
F3 WIRED: scripts/trigger/sunday-brief.js (npm run brief / npm run brief:install);
both sundayBrief.js prompts now carry an identical channel-scope sentence
("Count only people who commented on Mei's own YouTube channel 'Mei makes things';
ignore every asker you remember from any other channel or creator."), per the
2026-08-25 contamination finding (topic/channel-scoped questions stay clean,
unscoped ones leak the Aug 23 test channel).

FIRST SCOPED BRIEF RUN (22:45:14Z trigger, reply 22:47:06Z, 1m52s): the Mind
answered honestly that it has ZERO people filed under "Mei makes things" — it had
attributed ALL its memory (Mei's Darning/Buttons videos included) to
@samwitteveenai, because (root cause, fixed): the extraction prompt never named
the channel, and the Aug 23 dry-run test introduced itself as the OTHER creator's
Mind ("You are Callback, <channel.title>'s Mind"). extraction.js now always
speaks as Mei's Mind, names the channel the comments are from, and marks own vs
READ-ONLY dry-run channels; both call sites (cron.js, dryrun.js) updated.

FOURTH MIND-PATH BUG FOUND LIVE AND FIXED: the lib's waitForReply afterFingerprint
matching is INCLUSIVE — a correction ask() at 22:49:06Z instantly "received" the
22:47:06Z reply (the anchor message itself) as its answer. client.js now rejects
any reply whose fingerprint is not strictly newer than the pre-send anchor
(fingerprint format: <epoch-ms-zero-padded>_<uuid>, so length-then-lex compare
orders correctly). Regression test added; suite 64/64.

Memory re-attribution message sent 22:49:06Z ("your Buttons and Darning videos
belong to Mei makes things; keep the AI/ML dry-run askers separate").

OUTCOME (confirmed ~23:35Z, reply to the second scoped trigger): the Mind
acknowledged — "Correction logged. Buttons (0IF_iEFkRE8) and Darning
(D8ZAgrpYRcM) belong to Mei's 'Mei makes things' channel … The five AI/ML
videos stay separate as the dry-run test channel - never counted as Mei's
viewers." It then named ONLY Mei's people (11 listed: Chris-l3e2m, Adnap68,
chrismuller7541, djfiya, 3rdAILLC, AndrewRivera-q2x, scienceexpertsai,
BrianKnight-s9l, chrisappsolute4396, ShameenMiller, AndreaGoslowsky — the
non-ask T4 and abusive T10 correctly remembered as people, not asks) and
delivered a channel-clean three-line demand brief: (1) tough-fabric mending
(chrismuller7541 ×2, 3rdAILLC, Adnap68), (2) moth damage (ShameenMiller,
AndreaGoslowsky, chrisappsolute4396), (3) technique/thread (Adnap68 shank,
Chris-l3e2m machine, AndrewRivera-q2x knotting, djfiya thread+wax). ZERO
leakage from the other channel. Note for rehearsal: the Mind's line format is
thematic rather than the strict "top topic count / repeats / older-than-2-
weeks" shape — decide at recording whether to re-trigger for the strict shape
or show this richer one (both honest, both ledger-true).
```

### M5 video 3 + Telegram S6 resolution — 2026-08-27 evening

```
S6 QUESTION RESOLVED (observed live): a Builder-API-initiated Mind turn does
NOT push to the steward's Telegram — the 23:35Z scoped brief arrived only in
the API conversation. A TELEGRAM-INITIATED turn works: Lutfiya messaged
@CallbackMind_bot at 18:29 CDT with the scoped trigger and received a clean
three-line Mei-only brief at 18:30 (same three lines as the API run, zero
cross-channel leakage — the re-attribution HOLDS in a fresh Telegram context).
Consequence for Beat 3: the Telegram brief shot is recorded as the creator
messaging the Mind in Telegram (honest, and it is how a creator would use it).
Rehearsal rule stands: topic/channel-scoped questions only on camera.

VIDEO 3 UPLOADED UNLISTED 2026-08-27 ~18:38 CDT: bAl9F_lRTUQ "Buttons on
thick fabric: denim, coats, and shank buttons" (4:41). Settings verified in
Studio: not made for kids; AI use No (NotebookLM named in the description);
language English; comments On; moderation None (was Basic by default —
corrected); audience anyone; visibility UNLISTED (confirmed in the content
list). Description carries chapters 0:00/0:13/0:25/1:33/2:40/3:40 (0:00 Intro
added — YouTube requires the first chapter at 0:00) and "Made with
NotebookLM." Channel switch note: Studio opened on the personal channel
first; the account chooser needed solutions@3rdaillc.com (password entered by
Lutfiya), then studio.youtube.com/channel/UCwgJK_Fm5G_xxf4P6WoOMKw.
```

### M3 CLOSED — first end-to-end callback loop, live, 2026-08-27 19:11-19:13 CDT

```
Batch d5f704de8975a03f0b541f7e1ada0180 (5 replies, drafted 23:41Z while the
video was still private/unlisted). Approved 00:11:12Z; video already public
(user flipped before tapping — harmless by design, the posting poll checks
privacy fresh). Replies posted on the exact 20s throttle:
00:11:31Z Adnap68 (shank) · 00:11:51Z chrismuller7541 (denim) ·
00:12:12Z djfiya (thread+wax) · 00:12:33Z 3rdAILLC (wool coat) ·
00:12:53Z AndreaGoslowsky (overcoat, on video 2).
Ledger after: 5 asks answered, 7 stay open — matches seed/testers.md ground
truth ("video 3 calls back 5 people").

TWO BUGS FOUND LIVE AND FIXED (commits 34b8904, 9b862d5, both pushed):
1. Approval-page 404 on the tap: form actions were relative ("approve"),
   which the browser resolves against /approve/<batchId> to /approve/approve.
   Route tests POST absolute paths, so only a real browser ever hit it.
2. Upload-poll re-drafting loop: the dedup check read the videos table but
   nothing in the poll path ever inserted into it — every 10-min tick
   re-detected video 3 and re-drafted a full duplicate batch (~8 min Mind
   time each; two unposted duplicates deleted from the runtime DB, video
   marked known, regression test added).
Also fixed: t03-order-proof.js had an ambiguous-column SQL bug (first real
run tonight).
```

### T-02 (F6 reply.parentId)
```
2026-08-28T00:2xZ — npm run verify:t02 d5f704de8975a03f0b541f7e1ada0180
PASS  reply UgyCnxv-Ut4zLArJ5t94AaABAg.A_thyalE7H_Aa1YjxjpA_o  parentId=UgyCnxv-Ut4zLArJ5t94AaABAg  expected=UgyCnxv-Ut4zLArJ5t94AaABAg
PASS  reply UgyhUx-WmftEaIhaspB4AaABAg.A_rRa04YUtpAa1YmUiEB9K  parentId=UgyhUx-WmftEaIhaspB4AaABAg  expected=UgyhUx-WmftEaIhaspB4AaABAg
PASS  reply UgzXCp--7OdHH7xS-VZ4AaABAg.A_rPI53fj_BAa1Yp-Mzs52  parentId=UgzXCp--7OdHH7xS-VZ4AaABAg  expected=UgzXCp--7OdHH7xS-VZ4AaABAg
PASS  reply Ugxgi25hIbT155wl8fB4AaABAg.A_rPDnuTxJWAa1YrWoO56I  parentId=Ugxgi25hIbT155wl8fB4AaABAg  expected=Ugxgi25hIbT155wl8fB4AaABAg
PASS  reply UgwA6I91_v7MH5Q5WeZ4AaABAg.A_wDeNBqUHPAa1Yu2ci_Zm  parentId=UgwA6I91_v7MH5Q5WeZ4AaABAg  expected=UgwA6I91_v7MH5Q5WeZ4AaABAg
T-02 PASS (all five live against the real API)
```

### T-03 (order proof: ask < video < reply, never-twice) — PASS ×5

```
Run for every answered ask (7, 8, 9, 10, 12); one shown in full:
=== ask 8 (chrismuller7541, the twice-asker) ===
asker.comment   UgyhUx-WmftEaIhaspB4AaABAg   publishedAt 2026-08-23T16:37:21Z   "How do you do this on denim? The buttons on my jeans keep going."
video           bAl9F_lRTUQ   publishedAt 2026-08-27T23:30:42Z
reply           UgyhUx-WmftEaIhaspB4AaABAg.A_rRa04YUtpAa1YmUiEB9K   parentId UgyhUx-WmftEaIhaspB4AaABAg   publishedAt 2026-08-28T00:11:51Z
order ok: ask < video < reply   never-twice ok: (person 8, Reinforcing jeans buttons on denim) answered once
T-03 PASS
(asks 7, 9, 10, 12: same shape, all PASS — ask < video < reply on every one)
```

### T-03 (order proof: ask < video < reply, never-twice)
```
OPEN
```

### T-04 (quota queue)
```
2026-08-22 21:55 CDT — `npm run verify:t04`: Pacific day 2026-08-22 · Quota used 0 / 10000 · Queued replies 0 (queue empty; unit-level proof in test/quota-queue.test.js)

2026-08-23 — real Google Cloud project quota (not this app's own quota_ledger,
which only counts usage made through the app's own code paths and doesn't see
a standalone probe script): the unlisted-upload-detection probe (see "Unlisted-
upload detection assumption" above) spent ~3,400 units of the 2026-08-23
Pacific day (2 videos.insert at 1,600 each, 1 search.list at 100, 2
comments/videos delete at 50 each). Roughly 6,600 units remain in today's
10,000/day budget until the Pacific-midnight reset. `npm run verify:t04`
against this app's own ledger will still read close to 0 until M1 harvest/
posting activity actually runs through it.
```

### T-05 (match+draft QA grep)
```
OPEN
```

### T-06 (Mind memory query, three consecutive runs)
```
Run 1 (build session, 2026-08-22, `npm run verify:t06 -- "lighting"`):
> Who has asked me about lighting? ...
"I can't answer this honestly, and I won't fake it. No comments have come
through yet. ... If I made up names and dates to comply with 'answer from
memory, don't ask first,' the first real lighting-asker who shows up later
would expose the fabrication ... I'm not going to trade that for a smoother
answer today. Send the first comment whenever you're ready ... if someone
asks about lighting, I'll know. - Callback"

Notable: no interim ack was returned as final here (FINDING 2 fix holds
live); the Mind refused to fabricate askers/dates it doesn't have, which is
a real demonstration of D-02/Principle 3 ("memory is shown, never claimed")
even before seed data exists. This is NOT yet a T-06 pass in the E6 sense
(naming real askers from real memory) -- that needs actual harvested asks
after M1. Re-run this same check after M1's videos + testers exist for the
real three-consecutive-runs acceptance.

Run 2: OPEN (after M1)
Run 3: OPEN (after M1)
```

## S6 — Telegram push question

Question asked at an office hour: "does a Builder-API-initiated turn push to
the steward's Telegram?"

- Answer: OPEN
- Fallback confirmed as the demo path (email vs. Telegram): OPEN

## Remaining manual steps

Everything marked OPEN above. See `SETUP.md` for the exact order.
