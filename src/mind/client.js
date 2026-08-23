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
   * @param {string} messageText
   * @param {{timeoutMs?: number}} [opts]
   * @returns {Promise<{timedOut: true} | {timedOut: false, text: string, raw: import('@animocabrands/minds-client-lib').MessageRecord}>}
   */
  async ask(messageText, opts = {}) {
    requireEnv('minds');
    await this.raw.sendMessage({ alias: this.alias, messageText });

    const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
    let afterFingerprint;

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
      if (isInterimAck(text)) {
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
