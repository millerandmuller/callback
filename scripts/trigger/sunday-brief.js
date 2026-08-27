#!/usr/bin/env node
/**
 * F3 wiring: trigger the Sunday brief on demand, or install the Mind's own
 * weekly schedule (one-time). Until this script existed, both prompt builders
 * in src/prompts/sundayBrief.js had no caller — F3 only ever ran hand-typed.
 *
 * Usage:
 *   npm run brief             # trigger the three-line brief now, print it
 *   npm run brief:install     # one-time: install the standing Sunday-18:00
 *                             # instruction (do NOT run twice — the Mind would
 *                             # hold two overlapping standing instructions)
 */
import { config } from '../../src/config.js';
import { createMindClient } from '../../src/mind/client.js';
import {
  buildSundayBriefSetupInstruction,
  buildSundayBriefTriggerMessage,
} from '../../src/prompts/sundayBrief.js';

async function main() {
  const install = process.argv.includes('--install');
  const { displayName: creatorName, channelTitle, timezone } = config.creator;

  const message = install
    ? buildSundayBriefSetupInstruction({ creatorName, channelTitle, timezone })
    : buildSundayBriefTriggerMessage({ creatorName, channelTitle });

  const mind = createMindClient();
  await mind.ready();

  console.log(`> ${message}\n`);
  const result = await mind.ask(message, { timeoutMs: 240_000 });
  if (result.timedOut) {
    console.error('FAIL: the Mind did not reply within 240s.');
    process.exitCode = 1;
    return;
  }

  console.log(result.text);
  console.log(
    install
      ? '\nStanding instruction installed. The Mind now sends the brief every Sunday on its own.'
      : `\nCheck: three lines, and every asker/number belongs to "${channelTitle}" only (F3 acceptance: matches the ledger).`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
