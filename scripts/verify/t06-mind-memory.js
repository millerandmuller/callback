#!/usr/bin/env node
/**
 * T-06 / E6 (rehearsal item for Beat 4): from a fresh session (run this after
 * restarting the service, so nothing in our own process is priming the
 * answer), asks the Mind "who asked me about <topic>?" and prints the reply.
 * The acceptance bar (E6) is three consecutive successful runs — run this
 * script three times and paste all three transcripts into deployments.md.
 * Usage: node scripts/verify/t06-mind-memory.js "<topic>"
 */
import { createMindClient } from '../../src/mind/client.js';

async function main() {
  const topic = process.argv[2];
  if (!topic) {
    console.error('Usage: node scripts/verify/t06-mind-memory.js "<topic>"');
    process.exitCode = 1;
    return;
  }

  const mind = createMindClient();
  await mind.ready();

  const question = `Who has asked me about ${topic}? Answer with names and the date each of them asked, from what you remember — do not ask me for more information first.`;
  console.log(`> ${question}\n`);

  const result = await mind.ask(question, { timeoutMs: 180_000 });
  if (result.timedOut) {
    console.error('T-06 FAIL: the Mind did not reply within 180s.');
    process.exitCode = 1;
    return;
  }

  console.log(result.text);
  console.log('\nManually confirm the names/dates above match the ledger, then log this transcript into deployments.md. Repeat two more times (three consecutive successful runs required for E6).');
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
