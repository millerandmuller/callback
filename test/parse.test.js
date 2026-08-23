import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFencedJson, askMindForJson } from '../src/mind/parse.js';

test('parseFencedJson reads a ```json fenced block', () => {
  const text = 'Here you go:\n```json\n[{"a": 1}]\n```\nDone.';
  assert.deepEqual(parseFencedJson(text), [{ a: 1 }]);
});

test('parseFencedJson reads an unlabeled fenced block', () => {
  const text = '```\n{"ok": true}\n```';
  assert.deepEqual(parseFencedJson(text), { ok: true });
});

test('parseFencedJson returns null for prose with no valid JSON', () => {
  assert.equal(parseFencedJson('just some words'), null);
});

test('askMindForJson succeeds on the first reply when it parses', async () => {
  const fakeMind = {
    calls: 0,
    async ask() {
      this.calls += 1;
      return { timedOut: false, text: '```json\n[1,2,3]\n```' };
    },
  };
  const result = await askMindForJson(fakeMind, 'prompt');
  assert.deepEqual(result, { ok: true, data: [1, 2, 3], raw: '```json\n[1,2,3]\n```' });
  assert.equal(fakeMind.calls, 1);
});

test('askMindForJson re-asks once with a stricter instruction on parse failure, then succeeds', async () => {
  const fakeMind = {
    calls: 0,
    async ask(prompt) {
      this.calls += 1;
      if (this.calls === 1) return { timedOut: false, text: 'no json here' };
      assert.match(prompt, /did not contain a single valid fenced JSON block/);
      return { timedOut: false, text: '```json\n{"fixed": true}\n```' };
    },
  };
  const result = await askMindForJson(fakeMind, 'prompt');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { fixed: true });
  assert.equal(fakeMind.calls, 2);
});

test('askMindForJson surfaces a "could not parse" state after two failed attempts', async () => {
  const fakeMind = { async ask() { return { timedOut: false, text: 'still no json' }; } };
  const result = await askMindForJson(fakeMind, 'prompt');
  assert.equal(result.ok, false);
  assert.equal(result.raw, 'still no json');
});

test('askMindForJson surfaces timeout without a second attempt', async () => {
  const fakeMind = { calls: 0, async ask() { this.calls += 1; return { timedOut: true }; } };
  const result = await askMindForJson(fakeMind, 'prompt');
  assert.equal(result.ok, false);
  assert.equal(result.raw, null);
  assert.equal(fakeMind.calls, 1);
});
