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
6. Link Telegram to the Mind from the console (steward chat).
7. Buy US$25 of cognition credits.
8. Apply for the cognition boost (S6) if the option is offered.
9. Run:
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
   `waitForReply` round trip.

## 2. YouTube API key (reads)

1. Go to https://console.cloud.google.com/, create or pick a project.
2. Enable the **YouTube Data API v3**.
3. Create credentials -> API key. Copy into `.env` as `YOUTUBE_API_KEY`.
   (No OAuth needed for this one — it's read-only: `commentThreads.list`,
   `playlistItems.list`, `channels.list`, `videos.list`.)

## 3. Persona test channel + YouTube OAuth (writes)

1. Create (or pick) the YouTube channel Callback will post replies on —
   this is the "persona test channel" (e.g. "Mei makes things"). Note its
   channel id (Settings -> Advanced settings, or via `resolveChannel()`).
   Copy into `.env` as `YOUTUBE_TEST_CHANNEL_ID`.
2. In the same Google Cloud project, go to APIs & Services -> OAuth consent
   screen. Set **Publishing status: Testing** (do not submit for
   verification — D-14/D-15, not needed while the app stays in Testing
   mode with under 100 test users).
3. Add the test channel's Google account under "Test users".
4. Create OAuth 2.0 credentials (Desktop app type is simplest for a one-time
   token grab). Copy client id / secret into `.env` as
   `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET`.
5. Run an OAuth consent flow once, signed in as the test channel's account,
   requesting the `https://www.googleapis.com/auth/youtube.force-ssl` scope
   (D-08), to obtain a refresh token. The `googleapis` package's
   `google.auth.OAuth2` + `generateAuthUrl` / `getToken` pair does this; the
   simplest path is a short one-off script run locally (a browser window
   opens, you approve as the test channel, the token comes back in the
   redirect). Copy the resulting refresh token into `.env` as
   `YOUTUBE_OAUTH_REFRESH_TOKEN`.
6. Fill in `deployments.md` under "YouTube" with the channel name/id and the
   date the OAuth client was created.

## 4. Repo

1. This app lives in `callback/` inside the private Academy workspace so the
   Academy's own strategy documents (jury profiles, hour budgets, the bet)
   never end up in the public submission repo. Before pushing anywhere
   public, this directory needs its own git history — do NOT push the
   parent `hackathon-creative-minds` directory.
2. Create a new **public** GitHub repo (MIT license) for just this
   `callback/` directory's contents, and push there. See the parent
   directory's own rules: the private Academy repo must never be made
   public — this is a separate, new, public repo.

## 5. Testers

Invite 8-12 real people (S1) to leave genuine questions on videos 1 and 2 as
they go up (Aug 23-25). Track them in `seed/testers.md`.

## 6. Dry-run channel

Pick a real public channel (mid-size how-to creator, 20k-200k subscribers,
long-form, captions, active comments) for E5. Record it in
`seed/dryrun-channel.md`. Try it via `POST /dryrun` once the API key is set
— no OAuth needed for this, since dry-run never posts.

## After this file

Run `npm run check-env`. Once every line is checked, `npm start` will start
the harvest (30 min) and upload-poll (10 min) cron jobs automatically, and
`npm run verify:t01` through `verify:t06` become runnable — see README.md's
"Verify walkthrough".
