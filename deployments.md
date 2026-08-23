# Deployments

Running log of every account, credential, and verify-script output collected
during the build. Everything below is **OPEN** until the corresponding M0/M1
step is done by hand (see `SETUP.md`) — this file is also the source for the
DoraHacks submission form fields and the S4 writeup.

## Minds

- Mind name: Callback
- Mind ID: OPEN
- Mind email: OPEN
- Mind wallet address: OPEN
- `MINDS_BUILDER_API_KEY` set in `.env`: OPEN
- Telegram linked: OPEN
- Cognition credits purchased (US$25): OPEN
- Cognition boost applied for: OPEN
- `minds doctor` / `MindClient.doctor()` output: OPEN — paste here once run

```
(paste doctor() output here)
```

## YouTube

- `YOUTUBE_API_KEY` set: OPEN
- OAuth client (Testing mode) created, test channel added as test user: OPEN
- `YOUTUBE_OAUTH_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` set: OPEN
- Persona test channel name: OPEN
- Persona test channel id (`YOUTUBE_TEST_CHANNEL_ID`): OPEN
- Dry-run channel (see `seed/dryrun-channel.md`): OPEN

## Submission form fields (DoraHacks)

- Mind ID: OPEN
- Mind email: OPEN
- Mind wallet address: OPEN
- X handle: OPEN
- WhatsApp number: OPEN
- School: N/A
- Track: Audience growth & community engagement
- Other AI tech: Claude, Other: YouTube Data API

## Verify script outputs

Paste each script's console output here as it passes. See `README.md` "Verify
walkthrough" for how to run each one.

### T-01 (F1 harvest idempotent)
```
OPEN
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
OPEN
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
