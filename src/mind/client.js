import { createMindsClient } from '@animocabrands/minds-client-lib';
import { config, requireEnv } from '../config.js';
import { stripHtml, isInterimAck } from './parse.js';

/**
 * Thin wrapper around @animocabrands/minds-client-lib scoped to the one
 * conversation alias ('callback-main', Section 13) so the Mind's context
 * about people and asks stays coherent across every call site.
 */
export class MindClient {
  /** @param {import('@animocabrands/minds-client-lib').MindsClient} raw */
  constructor(raw) {
    this.raw = raw;
    this.alias = config.minds.conversationAlias;
    // Serializes every ask() call against this conversation. Found live
    // (Round 2 review): two concurrent ask() calls on the same alias can
    // cross-talk -- waitForReply's reply-matching isn't scoped strictly
    // enough to guarantee it returns THIS call's reply rather than a
    // different concurrent caller's, when both are mid-flight on
    // callback-main at once. In production this is reachable whenever the
    // harvest cron (F1) and the upload-poll cron (F4) fire close enough
    // together that their Mind calls overlap -- exactly Beat 3/4 territory.
    // Chaining every call onto this queue guarantees no two
    // sendMessage+waitForReply cycles ever run concurrently, so there is
    // never more than one unanswered question in flight to cross-talk with.
    this._queue = Promise.resolve();
  }

  /**
   * Ensures the callback-main conversation exists for the configured Mind.
   * Call once at service start.
   */
  async ready() {
    requireEnv('minds');
    await this.raw.ensureConversation(this.alias, config.minds.mindId);
  }

  /**
   * Sends a prompt and waits for the Mind's reply on callback-main. The Mind
   * sometimes sends an interim acknowledgment ("I'll notify you here when
   * I've finished.") before the real answer, up to a couple of minutes
   * later (confirmed live during M0) -- this keeps waiting past any such
   * ack, within the same overall timeout, rather than returning it as the
   * final reply. Reply text is always HTML-stripped first (the Builder API
   * wraps messageText in simple HTML, e.g. "<p>ok</p>", confirmed live).
   * Callers can safely call this concurrently -- each call queues behind
   * whatever is already in flight on this conversation (see the constructor
   * note) and gets its own full timeout budget starting from when it
   * actually begins, not from when it was enqueued.
   * @param {string} messageText
   * @param {{timeoutMs?: number}} [opts]
   * @returns {Promise<{timedOut: true} | {timedOut: false, text: string, raw: import('@animocabrands/minds-client-lib').MessageRecord}>}
   */
  ask(messageText, opts = {}) {
    requireEnv('minds');
    const task = this._queue.then(
      () => this._askOnce(messageText, opts),
      () => this._askOnce(messageText, opts)
    );
    // Never let one call's rejection break the queue for calls after it.
    this._queue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }

  /** @private */
  async _askOnce(messageText, opts) {
    // Anchor the reply search to the newest message that exists BEFORE this
    // send. Without this cursor, the lib's isReplyEvent accepts ANY Mind
    // message ever sent on the alias, so a back-to-back sequential ask can
    // "receive" the previous question's answer (or a days-old message) as
    // its reply — observed live 2026-08-25: video 1's extraction got video
    // 2's answer from 2 seconds before its own send. The Round 2 lock only
    // prevents concurrent asks; this closes the sequential variant.
    let afterFingerprint = await this.raw.getLatestHistoryFingerprint(this.alias);

    await this.raw.sendMessage({ alias: this.alias, messageText });

    const deadline = Date.now() + (opts.timeoutMs ?? 180_000);

    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { timedOut: true };

      const outcome = await this.raw.waitForReply({
        alias: this.alias,
        timeoutMs: remaining,
        sentMessageText: messageText,
        afterFingerprint,
      });
      if (outcome.timedOut) return { timedOut: true };

      const text = stripHtml(outcome.reply.messageText ?? '');
      // A message that's an interim ack, OR empty/whitespace-only once
      // stripped (e.g. "<p></p>", "<br>"), is never a real final answer for
      // anything this app asks the Mind -- keep waiting past it too
      // (adversarial find: isInterimAck('') is deliberately false since an
      // empty string isn't ack-phrase-shaped, but returning it as "final"
      // would abandon whatever real reply follows).
      if (isInterimAck(text) || text.length === 0) {
        afterFingerprint = outcome.reply.fingerprint;
        continue;
      }
      return { timedOut: false, text, raw: outcome.reply };
    }
  }

  /**
   * Full transcript for callback-main, for E6 (ask-the-Mind-live rehearsal, T-06)
   * and for showing the Proof beat transcript in the README.
   * @param {{limit?: number}} [opts]
   */
  async getHistory(opts = {}) {
    requireEnv('minds');
    return this.raw.getHistory(this.alias, opts);
  }

  /**
   * Equivalent of `minds doctor --pretty` for F0's acceptance check: confirms
   * the API key resolves, the configured Mind exists, and callback-main can
   * round-trip a message. Intended to be run once by hand during M0, output
   * pasted into deployments.md.
   */
  async doctor() {
    requireEnv('minds');
    const minds = await this.raw.listMinds();
    const mind = minds.find((m) => m.mindId === config.minds.mindId);
    if (!mind) {
      throw new Error(
        `MINDS_MIND_ID=${config.minds.mindId} not found among this account's Minds (${minds.map((m) => m.mindId).join(', ') || 'none'}).`
      );
    }
    await this.ready();
    const roundTrip = await this.ask('Reply with the single word: ok');
    return { mind, roundTrip };
  }
}

/**
 * Builds a MindClient from env config. Throws immediately if MINDS_BUILDER_API_KEY
 * or MINDS_MIND_ID are unset (see config.requireEnv) rather than failing deep
 * inside a network call.
 * @returns {MindClient}
 */
export function createMindClient() {
  requireEnv('minds');
  const raw = createMindsClient({ builderApiKey: config.minds.apiKey });
  return new MindClient(raw);
}
