import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSundayBriefSetupInstruction,
  buildSundayBriefTriggerMessage,
} from '../src/prompts/sundayBrief.js';

// F3 regression tests for the memory-contamination fix (DECISION_LOG
// 2026-08-25): the shared callback-main conversation remembers other channels'
// askers, and only channel/topic-scoped prompts come back clean. These tests
// pin the scope sentence into both prompts so a rewrite can't silently drop it.

const args = { creatorName: 'Mei', channelTitle: 'Mei makes things', timezone: 'America/Chicago' };

test('F3: the setup instruction scopes memory to the creator channel and keeps the three-line shape', () => {
  const text = buildSundayBriefSetupInstruction(args);
  assert.match(text, /Count only people who commented on Mei's own YouTube channel "Mei makes things"/);
  assert.match(text, /ignore every asker you remember from any other channel or creator/);
  assert.match(text, /Line 1: the top topic this week/);
  assert.match(text, /Line 2: of those, how many had asked before/);
  assert.match(text, /Line 3: how many open asks are older than two weeks/);
  assert.match(text, /every Sunday at 18:00 America\/Chicago time/);
});

test('F3: the trigger message carries the identical scope sentence', () => {
  const trigger = buildSundayBriefTriggerMessage(args);
  const setup = buildSundayBriefSetupInstruction(args);
  const scopeSentence = /Count only people who commented on [^.]+; ignore every asker you remember from any other channel or creator\./;
  const fromTrigger = trigger.match(scopeSentence);
  const fromSetup = setup.match(scopeSentence);
  assert.ok(fromTrigger, 'trigger message must contain the scope sentence');
  assert.ok(fromSetup, 'setup instruction must contain the scope sentence');
  assert.equal(fromTrigger[0], fromSetup[0], 'scope wording must stay identical in both prompts');
  assert.match(trigger, /Run the Sunday brief now/);
});
