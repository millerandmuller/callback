# Setup (M0)

Everything in this file requires a human with a browser, a Google account,
and a credit card — none of it can be scripted by an AI agent sitting in
this repo. Do these in order; each step tells you what to paste into `.env`
or `deployments.md`.

Budget: ~4 hours (F0). Run `npm run check-env` at any point to see what's
still missing.

## 1. Minds account and the Mind "Callback"

1. Go to https://build.hellominds.ai/console and sign in / create an account.
2. Create a new Mind named **Callback**.
3. Unlock Builder access for the account (follow the console's prompt).
4. Create a Builder API key. Copy it into `.env` as `MINDS_BUILDER_API_KEY`.
5. Copy the Mind's id (shown in the console, or via `client.listMinds()`
   once the key works) into `.env` as `MINDS_MIND_ID`.
6. Link Telegram to the Mind from the console (steward chat). On a machine
   with no Telegram desktop app, use the console's `tg://newbot?...` link
   from a phone instead of the desktop button.
7. Buy US$25 of cognition credits.
8. Run:
   ```bash
   node -e "
   import('./src/mind/client.js').then(async ({ createMindClient }) => {
     const mind = createMindClient();
     console.log(JSON.stringify(await mind.doctor(), null, 2));
   });
   "
   ```
   Paste the output into `deployments.md` under "Minds > doctor() output".
   This is the F0 acceptance check: it lists the Mind, ensures the
   `callback-main` conversation, and logs one `sendMessage` +
   `waitForReply` round trip. Note: `messageText` in the response comes back
   HTML-wrapped (e.g. `<p>ok</p>`) — expected, the client strips it.

## 2. DoraHacks registration (cognition boost)

1. Submit the Creative Minds Jam #1 registration/submission form (see the
   event link in `project_brief.md` Section H) using the Mind ID, Mind
   email, and Mind wallet address from step 1, track "Audience growth &
   community engagement". Do this early — confirmed live: this submission
   *is* the cognition-boost request; there is no separate button or flow in
   the Minds console for it.
2. Record the submission date in `deployments.md` under "Minds > Cognition
   boost applied for".

## 3. YouTube API key (reads)

1. Go to https://console.cloud.google.com/, create or pick a project.
2. Enable the **YouTube Data API v3**.
3. Create credentials -> API key. Copy into `.env` as `YOUTUBE_API_KEY`.
   (No OAuth needed for this one — it's read-only: `commentThreads.list`,
   `playlistItems.list`, `channels.list`, `videos.list`.)

## 4. Persona test channel + YouTube OAuth (writes)

1. Create (or pick) the YouTube channel Callback will post replies on —
   this is the "persona test channel" (e.g. "Mei makes things"). Note its
   channel id (Settings -> Advanced settings, or via `resolveChannel()`).
   Copy into `.env` as `YOUTUBE_TEST_CHANNEL_ID`.
2. In the same Google Cloud project, go to APIs & Services -> OAuth consent
   screen. Set **Publishing status: Testing** (do not submit for
   verification — D-14/D-15, not needed while the app stays in Testing
   mode with under 100 test users).
3. Add the test channel's Google account under "Test users". If the channel
   is a brand account managed by a different Google account than the one
   that owns the Cloud project, add that account too.
4. Create OAuth 2.0 credentials (Desktop app type). Copy client id / secret
   into `.env` as `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET`.
5. Run `npm run setup:oauth` (`scripts/setup/oauth-token.js`). It opens the
   Google consent screen in your browser (scope `youtube.force-ssl`,
   `access_type=offline`, `prompt=consent` so a refresh token is always
   returned), exchanges the code locally, and prints the refresh token and
   the authorized channel id — it never writes `.env` itself. Sign in as the
   account that owns the persona channel; if Google's chooser defaults to
   the wrong account, re-run and pick the right one on the "Choose your
   account or a brand account" screen. Paste the printed
   `YOUTUBE_OAUTH_REFRESH_TOKEN` and `YOUTUBE_TEST_CHANNEL_ID` into `.env`.
6. Fill in `deployments.md` under "YouTube" with the channel name/id and the
   date the OAuth client was created.

## 5. Repo

1. This app lives in `callback/` inside the private Academy workspace so the
   Academy's own strategy documents (jury profiles, hour budgets, the bet)
   never end up in the submission repo. This directory has its own git
   history — do NOT push the parent `hackathon-creative-minds` directory.
2. The GitHub repo for `callback/` (`fiya-chris-and-AI/callback`, MIT
   license) is currently **private** by team decision, to keep the
   build-in-progress out of public view while it's unfinished. **DoraHacks
   requires a public code repository at submission time** — switch this
   repo to public (or mirror it to a new public one) before the Thursday
   22:00 CDT submission deadline; track this in `deployments.md`.

## 6. Testers

Invite 8-12 real people (S1) to leave genuine questions on videos 1 and 2 as
they go up (Aug 23-25). Track them in `seed/testers.md` (gitignored — copy
the template from `seed/testers.example.md` first; real names/handles are
personal data and never go in the repo).

## 7. Dry-run channel

Pick a real public channel (mid-size how-to creator, 20k-200k subscribers,
long-form, captions, active comments) for E5. Record it in
`seed/dryrun-channel.md`. Try it via `POST /dryrun` once the API key is set
— no OAuth needed for this, since dry-run never posts.

## After this file

Run `npm run check-env`. Once every line is checked, `npm start` will start
the harvest (30 min) and upload-poll (10 min) cron jobs automatically, and
`npm run verify:t01` through `verify:t06` become runnable — see README.md's
"Verify walkthrough". Note: `verify:t01` (and the harvest/upload-poll cron
jobs) correctly treat a channel with zero uploads as "0 videos" rather than
erroring — YouTube 404s `playlistNotFound` for a channel's uploads playlist
until its first video exists, which is expected before M1.
