import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExtractionPrompt } from '../src/prompts/extraction.js';

// Channel-attribution regression tests (DECISION_LOG 2026-08-27): the Aug 23
// dry run introduced itself as the OTHER creator's Mind and the Mind filed all
// askers — Mei's included — under that channel. These pin the framing that
// keeps the two memories apart.

const comments = [
  {
    commentId: 'c1',
    authorChannelId: 'UCkai',
    authorDisplayName: 'Kai',
    text: 'how do you light the desk?',
    publishedAt: '2026-08-23T00:00:00Z',
  },
];

test('extraction prompt (own channel): speaks as the creator Mind and files askers under her own channel', () => {
  const text = buildExtractionPrompt({
    creatorName: 'Mei',
    channelTitle: 'Mei makes things',
    isOwnChannel: true,
    videoTitle: 'Video',
    videoId: 'v1',
    comments,
  });
  assert.match(text, /You are Callback, Mei's Mind\./);
  assert.match(text, /Mei's own YouTube channel "Mei makes things"/);
  assert.match(text, /Remember every asker as one of Mei's own viewers on "Mei makes things"/);
  assert.doesNotMatch(text, /dry run/i);
});

test('extraction prompt (dry run): still speaks as the creator Mind, marks the channel as not hers, keeps memory separate', () => {
  const text = buildExtractionPrompt({
    creatorName: 'Mei',
    channelTitle: 'Roxanne Richardson',
    isOwnChannel: false,
    videoTitle: 'Video',
    videoId: 'v2',
    comments,
  });
  assert.match(text, /You are Callback, Mei's Mind, running a READ-ONLY dry run/);
  assert.match(text, /"Roxanne Richardson" — a channel that is NOT Mei's/);
  assert.match(text, /kept strictly separate from Mei's own viewers/);
  assert.doesNotMatch(text, /You are Callback, Roxanne Richardson's Mind/);
});
