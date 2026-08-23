#!/usr/bin/env node
// One-off: obtain a YouTube OAuth refresh token for the persona test channel.
//
// Reads YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET from .env,
// starts a loopback listener, opens the Google consent URL (scope
// youtube.force-ssl, access_type=offline, prompt=consent so a refresh token
// is always returned), exchanges the code, and PRINTS the refresh token.
// It never writes the token anywhere; paste it into .env yourself.
//
// Usage:  node scripts/setup/oauth-token.js
// Sign in as the Google account that owns the persona channel, and if the
// account has several channels, pick the persona channel on the chooser.

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { google } from 'googleapis';

function loadDotEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadDotEnv();

const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET in .env first (SETUP.md section 3).');
  process.exit(2);
}

const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

const server = http.createServer();
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [SCOPE],
  });

  server.on('request', async (req, res) => {
    const u = new URL(req.url, redirectUri);
    if (u.pathname !== '/callback') { res.statusCode = 404; res.end('not found'); return; }
    const code = u.searchParams.get('code');
    const err = u.searchParams.get('error');
    if (err || !code) {
      res.end(`OAuth error: ${err || 'no code'}. You can close this tab.`);
      console.error('OAuth error:', err || 'no code');
      server.close(); process.exit(1);
    }
    try {
      const { tokens } = await oauth2.getToken(code);
      res.end('Callback: token received. You can close this tab and return to the terminal.');
      if (!tokens.refresh_token) {
        console.error('No refresh_token in the response. Revoke the app at https://myaccount.google.com/permissions and run again.');
        server.close(); process.exit(1);
      }
      oauth2.setCredentials(tokens);
      const yt = google.youtube({ version: 'v3', auth: oauth2 });
      const me = await yt.channels.list({ part: ['snippet'], mine: true });
      const ch = me.data.items?.[0];
      console.log('\nAuthorized channel:', ch ? `${ch.snippet.title} (${ch.id})` : '(none found)');
      console.log('Put these in .env:');
      console.log(`YOUTUBE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
      if (ch) console.log(`YOUTUBE_TEST_CHANNEL_ID=${ch.id}`);
      console.log('\nThe refresh token was printed only; nothing was written.');
    } catch (e) {
      res.end('Token exchange failed; see terminal.');
      console.error('Token exchange failed:', e.message);
      server.close(); process.exit(1);
    }
    server.close(); process.exit(0);
  });

  console.log('Open this URL (a browser window should open automatically):\n');
  console.log(url + '\n');
  console.log('Sign in as the persona channel account and approve. Waiting on', redirectUri, '...');
  exec(`open "${url}"`, () => {});
});
