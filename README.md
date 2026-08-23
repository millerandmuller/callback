# Callback

*Your comments section remembers. So does your Mind.*

Mei gets 300 comments a week. She answers 20. The other 280 are people who
wanted something. Callback is a Mind that remembers every one of them, tells
Mei what to make next, and when she makes it, goes back and tells each of
them: you asked for this, here it is.

Built for [Creative Minds Jam #1: Hong Kong](https://dorahacks.io/hackathon/creativeminds/detail).

## What it does

1. **Harvest** — every 30 minutes, pulls new comment threads from the
   creator's last N videos into SQLite.
2. **Ledger** — new comments go to the Mind in batches; it extracts asks and
   merges people into its own memory. The ledger page mirrors this so it
   never waits on agent latency.
3. **Demand** — the Mind sends a three-line demand brief every Sunday, on
   its own.
4. **Publish detection** — every 10 minutes, checks for a new video; sends
   its title/description/captions to the Mind, which matches open asks and
   drafts one reply per asker.
5. **Approval** — the Mind messages the creator with a link; the approval
   page shows every reply exactly as it will appear, beside the original
   comment. One tap approves the batch.
6. **Callback** — the service posts each approved reply under the asker's
   original comment, throttled, quota-ledgered.
7. **Close** — the ledger marks the ask answered; it is never called back
   twice for the same topic.

## Architecture

```
YouTube Data API  <--reads (API key)--   Callback service (Node)   --writes (OAuth, own channel)-->  YouTube comments
                                          |  node-cron: harvest 30m, uploads 10m
                                          |  SQLite: comments, people, asks, ask_events,
                                          |          batches, batch_replies, quota_ledger,
                                          |          post_queue, namespaces
                                          |  pages: /ledger  /approve/:batchId  /dryrun
                                          |
                                   Builder API (minds-client-lib, alias callback-main)
                                          |
                                     The Mind "Callback"  (memory: people + asks;
                                          |                judgment: extract, merge, rank, match, draft)
                                          |
                               Telegram / email to the creator (brief, approval notice, report)
```

Deliberately quick and dirty: prompts are plain template strings
(`src/prompts/`), HTML is template literals (`src/web/templates/`), a single
`.env`, no auth on the local pages (the approval page id is an unguessable
random token, not sequential).

Not quick and dirty: the posting path (idempotency on batch/reply status,
throttle, quota ledger), the never-twice constraint (`UNIQUE(person_id,
topic)` in the schema, enforced again at match time), and the Mind's
fenced-JSON reply parsing (defensive: re-asks once with a stricter
instruction, then surfaces a "could not parse" state instead of guessing).

## Setup

See [`SETUP.md`](./SETUP.md) for the M0 steps (Minds account, YouTube API
key, OAuth, persona test channel) — these require a human with a browser and
cannot be scripted. Once `.env` is filled in:

```bash
npm install
npm run check-env   # confirms every credential is present
npm start            # http://localhost:3000/ledger, /dryrun
```

`npm test` runs the unit and integration test suite (pure logic — ledger
merge, quota, JSON parsing, the full F4->F5->F6 pipeline against fakes — none
of it needs live credentials).

## Verify walkthrough

Each script is a real check against the live system, not a demo of fake
data. Run in this order once M0 is done and seed data exists (S1):

```bash
npm run verify:t01                    # F1: harvest is idempotent
# ... use the app to draft and approve a batch, then post it ...
npm run verify:t02 <batchId>          # F6: reply.parentId matches the asker's comment
npm run verify:t03 <askId>            # order proof: ask < video < reply, never-twice
npm run verify:t04                    # quota ledger + post_queue state
npm run verify:t05 <batchId>          # F4: drafts pass the CTA/link/hashtag/emoji grep
npm run verify:t06 "<topic>"          # E6: Mind answers "who asked about X" from memory
```

Paste every script's output into `deployments.md` — that file is also the
source for the DoraHacks submission form and the S4 writeup.

## Honesty

- Comment **reading** on the real public dry-run channel (`/dryrun`) is
  real and read-only.
- Callback **posting** happens only on our own persona test channel, whose
  comments were left by real testers during the build week — the video and
  writeup say this in one sentence.
- No date, name, or reply shown anywhere is fabricated. A seeded comment is
  never presented as organic.
- Posting is structurally impossible outside the 'own' namespace: every
  namespace has a `kind` ('own' | 'dryrun'), and `postApprovedBatch()`
  refuses to run against anything but 'own' — see
  `src/posting/posting.js` and `test/dryrun.test.js`.

## What's real vs. curated

- `[ECHT]` (real): harvest, ledger merge, Sunday brief, match+draft, approval,
  posting, quota ledger, dry run, the Mind's memory.
- `[GEMOCKT/KURATIERT]` (curated): the persona test channel's seed comments
  (S1) — real testers, real questions, deliberately gathered during the
  build week rather than organic.

## After the hackathon (not built)

- Handshake: creators who comment become collab seeds (Mind-to-Mind via
  Circles).
- Multi-creator, multi-channel accounts.
- TikTok comments (no comment endpoint in the public Display API today).
- Telegram "approve" by message as the *only* approval path (a Skill
  wrapping the approve endpoint is a stretch goal inside F5's hours, gated
  at day 3 — see `project_brief.md` F5).

## License

MIT.
