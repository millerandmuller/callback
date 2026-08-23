import test from 'node:test';
import assert from 'node:assert/strict';

// MindClient.ask() reads MINDS_BUILDER_API_KEY / MINDS_MIND_ID via config.js's
// requireEnv('minds') on every call. Set them before the dynamic import below
// so config.js's module-level env read sees them (this file's own top-level
// imports run before any of its own statements, so a static `import` here
// would be too late).
process.env.MINDS_BUILDER_API_KEY = 'test-key';
process.env.MINDS_MIND_ID = 'test-mind-id';

const { MindClient } = await import('../src/mind/client.js');
const { stripHtml, isInterimAck } = await import('../src/mind/parse.js');

test('stripHtml unwraps the Builder API\'s simple HTML wrapping (confirmed live: "ok" -> "<p>ok</p>")', () => {
  assert.equal(stripHtml('<p>ok</p>'), 'ok');
  assert.equal(stripHtml('<p>Line one.</p><p>Line two.</p>'), 'Line one.\n\nLine two.');
  assert.equal(stripHtml('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;'), 'a & b <c> "d" \'e\'');
  assert.equal(stripHtml(''), '');
});

test('stripHtml never mistakes literal angle-bracket content for a tag (round 2 adversarial find)', () => {
  // A naive `<[^>]+>` regex treats any "<...text...>" span as a tag and
  // deletes it -- including the content on the far side, while the result
  // stays syntactically valid JSON, so nothing downstream ever notices.
  assert.equal(stripHtml('a < b and c > d'), 'a < b and c > d');
  assert.equal(
    stripHtml('I shoot at ISO < 800 and f-stop > 2.8 for that look.'),
    'I shoot at ISO < 800 and f-stop > 2.8 for that look.'
  );
  assert.equal(stripHtml('u <3 this'), 'u <3 this');
  // Genuine tags (letter or / right after <) must still be stripped.
  assert.equal(stripHtml('<p>ok</p>'), 'ok');
  assert.equal(stripHtml('<a href="x">link</a>'), 'link');
  assert.equal(stripHtml('before <!-- a comment --> after'), 'before  after');
});

test('stripHtml leaves a fenced-JSON reply draft containing numeric comparisons intact end to end', () => {
  const raw =
    '<p>```json\n[{"askId":3,"replyText":"I shoot at ISO < 800 and f-stop > 2.8 for that look, thanks for asking!"}]\n```</p>';
  const stripped = stripHtml(raw);
  const parsed = JSON.parse(stripped.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/)[1]);
  assert.equal(parsed[0].replyText, 'I shoot at ISO < 800 and f-stop > 2.8 for that look, thanks for asking!');
});

test('isInterimAck recognizes the observed ack phrasing and rejects real answers', () => {
  assert.equal(isInterimAck("I'll notify you here when I've finished."), true);
  assert.equal(isInterimAck("I'll let you know shortly."), true);
  assert.equal(isInterimAck('Kai, you asked how I light the desk without the glare. This one\'s for you.'), false);
  assert.equal(isInterimAck('```json\n[{"askId":1}]\n```'), false);
  // A long message that happens to contain "I'll get back to" mid-sentence as
  // real content, not as the whole message, should not be misclassified.
  const longReal = 'Called back 7 people. 2 asks stay open. '.repeat(6);
  assert.equal(isInterimAck(longReal), false);
});

test('ask() keeps waiting past an interim ack and returns the later, real reply with HTML stripped (M0 platform finding)', async () => {
  const events = [
    { messageText: "<p>I'll notify you here when I've finished.</p>", fingerprint: 'ack-1' },
    { messageText: '<p>```json\n[{"askId":1,"replyText":"done"}]\n```</p>', fingerprint: 'final-1' },
  ];
  let call = 0;
  const fakeRaw = {
    async sendMessage() { return {}; },
    async ensureConversation() {},
    async waitForReply({ afterFingerprint }) {
      // First call has no afterFingerprint (fresh ask); after skipping the
      // ack, the second call must be scoped past the ack's own fingerprint.
      if (call === 0) assert.equal(afterFingerprint, undefined);
      if (call === 1) assert.equal(afterFingerprint, 'ack-1');
      const reply = events[call];
      call += 1;
      return { timedOut: false, reply };
    },
  };

  const mind = new MindClient(fakeRaw);
  const result = await mind.ask('extract these comments');

  assert.equal(call, 2, 'must have called waitForReply twice: once for the ack, once for the real reply');
  assert.equal(result.timedOut, false);
  assert.equal(result.text, '```json\n[{"askId":1,"replyText":"done"}]\n```');
});

test('ask() returns timedOut if only interim acks arrive before the deadline', async () => {
  const fakeRaw = {
    async sendMessage() { return {}; },
    async waitForReply() {
      return { timedOut: false, reply: { messageText: "<p>Still thinking.</p>", fingerprint: `ack-${Math.random()}` } };
    },
  };
  const mind = new MindClient(fakeRaw);
  const result = await mind.ask('question', { timeoutMs: 5 });
  assert.equal(result.timedOut, true);
});

test('ask() keeps waiting past an empty/whitespace-only reply too, not just phrase-matched acks (round 2 adversarial find)', async () => {
  const events = [
    { messageText: '<p></p>', fingerprint: 'blank-1' },
    { messageText: '<p>```json\n[{"askId":1}]\n```</p>', fingerprint: 'final-1' },
  ];
  let call = 0;
  const fakeRaw = {
    async sendMessage() { return {}; },
    async waitForReply({ afterFingerprint }) {
      if (call === 1) assert.equal(afterFingerprint, 'blank-1');
      const reply = events[call];
      call += 1;
      return { timedOut: false, reply };
    },
  };
  const mind = new MindClient(fakeRaw);
  const result = await mind.ask('extract these comments');
  assert.equal(call, 2, 'an empty-after-strip reply must not be returned as final');
  assert.equal(result.text, '```json\n[{"askId":1}]\n```');
});

test('ask() serializes concurrent calls so they never cross-talk on the same conversation (round 2 live finding: two overlapping Mind calls on callback-main returned the wrong reply to each other)', async () => {
  let inFlight = false;
  let crossTalkDetected = false;
  const sendLog = [];
  const fakeRaw = {
    async sendMessage({ messageText }) {
      if (inFlight) crossTalkDetected = true; // a second question was sent while the first was still unanswered
      inFlight = true;
      sendLog.push(messageText);
      return {};
    },
    async waitForReply() {
      await new Promise((resolve) => setTimeout(resolve, 10)); // simulate real network latency
      const answer = sendLog.at(-1) === 'question A' ? 'answer to A' : 'answer to B';
      inFlight = false;
      return { timedOut: false, reply: { messageText: answer, fingerprint: `f-${sendLog.length}` } };
    },
  };

  const mind = new MindClient(fakeRaw);
  const [resultA, resultB] = await Promise.all([mind.ask('question A'), mind.ask('question B')]);

  assert.equal(crossTalkDetected, false, 'a second sendMessage must never happen while the first cycle is still awaiting its reply');
  assert.deepEqual(sendLog, ['question A', 'question B'], 'calls must be fully serialized, in call order');
  assert.equal(resultA.text, 'answer to A');
  assert.equal(resultB.text, 'answer to B');
});

test('ask() keeps serving later calls even if an earlier queued call times out', async () => {
  let call = 0;
  const fakeRaw = {
    async sendMessage() { call += 1; return {}; },
    async waitForReply() {
      if (call === 1) return { timedOut: true };
      return { timedOut: false, reply: { messageText: 'second answer', fingerprint: 'f2' } };
    },
  };
  const mind = new MindClient(fakeRaw);
  const [first, second] = await Promise.all([mind.ask('a'), mind.ask('b')]);
  assert.equal(first.timedOut, true);
  assert.equal(second.timedOut, false);
  assert.equal(second.text, 'second answer');
});

test('ask() returns a genuinely final short reply immediately, without waiting for a second message', async () => {
  let calls = 0;
  const fakeRaw = {
    async sendMessage() { return {}; },
    async waitForReply() {
      calls += 1;
      return { timedOut: false, reply: { messageText: '<p>ok</p>', fingerprint: 'f1' } };
    },
  };
  const mind = new MindClient(fakeRaw);
  const result = await mind.ask('Reply with the single word: ok');
  assert.equal(calls, 1);
  assert.equal(result.text, 'ok');
});
