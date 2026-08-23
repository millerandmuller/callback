#!/usr/bin/env node
/**
 * T-05 (F4 acceptance, and part of the S5 QA pass): checks every drafted
 * reply in a batch for the register rules (Section 5 / Principle 5) — no
 * CTA/thanks-for-watching, no links, no hashtags, no default emoji unless
 * the creator's own replies use them — and that every reply in the batch is
 * textually distinct (D-18).
 * Usage: node scripts/verify/t05-match-drafts.js <batchId>
 */
import { openDb } from '../../src/db/index.js';

const FORBIDDEN_PATTERNS = [
  { name: 'CTA phrase', re: /\b(subscribe|thanks for watching|don't forget to|hit the bell)\b/i },
  { name: 'link', re: /https?:\/\/|www\./i },
  { name: 'hashtag', re: /#\w+/ },
  { name: 'default emoji', re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u },
];

function main() {
  const batchId = process.argv[2];
  if (!batchId) {
    console.error('Usage: node scripts/verify/t05-match-drafts.js <batchId>');
    process.exitCode = 1;
    return;
  }

  const db = openDb();
  const replies = db
    .prepare(`SELECT id, reply_text as replyText FROM batch_replies WHERE batch_id = ? AND status != 'struck'`)
    .all(batchId);

  if (replies.length === 0) {
    console.error(`No replies found for batch ${batchId}.`);
    process.exitCode = 1;
    return;
  }

  let violations = 0;
  for (const r of replies) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.re.test(r.replyText)) {
        console.log(`FAIL reply #${r.id}: contains ${pattern.name} — "${r.replyText}"`);
        violations += 1;
      }
    }
  }

  const texts = replies.map((r) => r.replyText);
  const uniqueTexts = new Set(texts);
  const duplicates = texts.length - uniqueTexts.size;
  if (duplicates > 0) {
    console.log(`FAIL: ${duplicates} duplicate reply text(s) in this batch (every reply must differ, D-18).`);
    violations += duplicates;
  }

  console.log(`\nChecked ${replies.length} replies.`);
  console.log(violations === 0 ? 'T-05 PASS' : `T-05 FAIL (${violations} violation(s))`);
  if (violations > 0) process.exitCode = 1;
}

main();
