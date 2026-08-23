#!/usr/bin/env node
/**
 * `npm run check-env` — reports exactly which M0 setup steps are still open,
 * instead of failing deep inside whichever module happens to need a
 * credential first. Exits 1 if anything required is missing.
 */
import { config } from '../../src/config.js';

const checks = [
  { label: 'Minds Builder API key (MINDS_BUILDER_API_KEY)', ok: Boolean(config.minds.apiKey) },
  { label: 'Mind id (MINDS_MIND_ID)', ok: Boolean(config.minds.mindId) },
  { label: 'YouTube API key (YOUTUBE_API_KEY)', ok: Boolean(config.youtube.apiKey) },
  { label: 'YouTube OAuth client id (YOUTUBE_OAUTH_CLIENT_ID)', ok: Boolean(config.youtube.oauthClientId) },
  { label: 'YouTube OAuth client secret (YOUTUBE_OAUTH_CLIENT_SECRET)', ok: Boolean(config.youtube.oauthClientSecret) },
  { label: 'YouTube OAuth refresh token (YOUTUBE_OAUTH_REFRESH_TOKEN)', ok: Boolean(config.youtube.oauthRefreshToken) },
  { label: 'Test channel id (YOUTUBE_TEST_CHANNEL_ID)', ok: Boolean(config.youtube.testChannelId) },
];

console.log('Callback — environment check\n');
for (const check of checks) {
  console.log(`${check.ok ? '✅' : '⬜'} ${check.label}`);
}

const missing = checks.filter((c) => !c.ok);
if (missing.length > 0) {
  console.log(`\n${missing.length} of ${checks.length} not set yet. See SETUP.md for M0 steps, then fill .env.`);
  process.exitCode = 1;
} else {
  console.log('\nAll credentials present. Run `npm run verify:t01` through `verify:t06` next.');
}
