import 'dotenv/config';

/**
 * Central config. Reading a config value never throws — only calling a
 * feature that needs a missing credential does (via requireEnv below), so
 * the web server and offline snapshot rendering (F7) work with zero
 * external accounts set up.
 */
export const config = {
  minds: {
    apiKey: process.env.MINDS_BUILDER_API_KEY || '',
    mindId: process.env.MINDS_MIND_ID || '',
    conversationAlias: process.env.MINDS_CONVERSATION_ALIAS || 'callback-main',
  },
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || '',
    oauthClientId: process.env.YOUTUBE_OAUTH_CLIENT_ID || '',
    oauthClientSecret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET || '',
    oauthRefreshToken: process.env.YOUTUBE_OAUTH_REFRESH_TOKEN || '',
    testChannelId: process.env.YOUTUBE_TEST_CHANNEL_ID || '',
    quotaDailyUnits: Number(process.env.YOUTUBE_QUOTA_DAILY_UNITS || 10000),
  },
  creator: {
    displayName: process.env.CREATOR_DISPLAY_NAME || 'Mei',
    timezone: process.env.CREATOR_TIMEZONE || 'America/Chicago',
  },
  server: {
    port: Number(process.env.PORT || 3000),
  },
  db: {
    path: process.env.DB_PATH || './data/callback.sqlite',
  },
  schedule: {
    harvestIntervalMin: Number(process.env.HARVEST_INTERVAL_MIN || 30),
    uploadPollIntervalMin: Number(process.env.UPLOAD_POLL_INTERVAL_MIN || 10),
    postingPollIntervalSec: Number(process.env.POSTING_POLL_INTERVAL_SEC || 30),
  },
};

/**
 * Named env-var groups a feature needs, so a missing-credential error names
 * exactly what to set instead of failing deep inside a client library.
 */
const REQUIREMENT_GROUPS = {
  minds: [['MINDS_BUILDER_API_KEY', config.minds.apiKey], ['MINDS_MIND_ID', config.minds.mindId]],
  youtubeRead: [['YOUTUBE_API_KEY', config.youtube.apiKey]],
  youtubeWrite: [
    ['YOUTUBE_OAUTH_CLIENT_ID', config.youtube.oauthClientId],
    ['YOUTUBE_OAUTH_CLIENT_SECRET', config.youtube.oauthClientSecret],
    ['YOUTUBE_OAUTH_REFRESH_TOKEN', config.youtube.oauthRefreshToken],
    ['YOUTUBE_TEST_CHANNEL_ID', config.youtube.testChannelId],
  ],
};

/**
 * Throws a clear, actionable error naming the missing env var(s) when a
 * feature that needs live credentials is invoked before M0 is complete.
 * @param {keyof typeof REQUIREMENT_GROUPS} group
 */
export function requireEnv(group) {
  const missing = REQUIREMENT_GROUPS[group].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `OPEN (M0 not complete): missing ${missing.join(', ')}. See SETUP.md, then fill .env.`
    );
  }
}
