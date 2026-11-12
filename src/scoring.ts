// Mock rubric scoring. Scores what the rep said against the customer's key
// messages, flags off-label claims, and catches keyword stuffing. Every feedback
// item that cites the rep must quote text that actually appears in the transcript.

import type { Tenant, Topic } from './data/tenants.ts';
import { faultOn } from './faults.ts';
import type { Rng } from './rng.ts';

export type Feedback = {
  kind: 'covered' | 'missed' | 'focus' | 'compliance' | 'stuffing';
  message: string;
  evidence: string | null;
};

export type ScoreResult = {
  score: number;
  covered: string[];
  missed: string[];
  complianceFlags: string[];
  feedback: Feedback[];
};

function sentences(turns: string[]): string[] {
  return turns.flatMap((t) => t.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);
}

function findSentence(all: string[], needle: string | RegExp): string | null {
  return (
    all.find((s) => (typeof needle === 'string' ? s.toLowerCase().includes(needle.toLowerCase()) : needle.test(s))) ??
    null
  );
}

export function scoreSession(tenant: Tenant, focus: Topic, repTurns: string[], rng: Rng): ScoreResult {
  const all = sentences(repTurns);
  const feedback: Feedback[] = [];
  const covered: string[] = [];
  const missed: string[] = [];
  let keywordHits = 0;

  for (const km of tenant.keyMessages) {
    const hit = km.keywords.find((k) => findSentence(all, k));
    keywordHits += km.keywords.filter((k) => findSentence(all, k)).length;
    if (hit) {
      covered.push(km.id);
      feedback.push({ kind: 'covered', message: `You covered ${km.label.toLowerCase()}.`, evidence: findSentence(all, hit) });
    } else {
      missed.push(km.id);
      feedback.push({ kind: 'missed', message: `You didn't cover ${km.label.toLowerCase()}.`, evidence: null });
    }
  }

  let score = Math.round((covered.length / tenant.keyMessages.length) * 85);
  const focusMsg = tenant.keyMessages.find((k) => k.topic === focus);
  if (focusMsg && covered.includes(focusMsg.id)) score += 15;
  else feedback.push({ kind: 'focus', message: `Your chosen focus was ${focus}, but you didn't address it.`, evidence: null });

  // Keyword stuffing: lots of rubric terms with almost no conversation around them.
  const words = repTurns.join(' ').split(/\s+/).filter(Boolean).length;
  if (keywordHits >= 3 && words / Math.max(keywordHits, 1) < 4) {
    score = Math.min(score, 35);
    feedback.push({
      kind: 'stuffing',
      message: 'You listed key terms without explaining them to the doctor.',
      evidence: repTurns.join(' ').trim(),
    });
  }

  const complianceFlags: string[] = [];
  for (const re of tenant.offLabel) {
    const s = findSentence(all, re);
    if (s) {
      complianceFlags.push('off-label');
      score -= 40;
      feedback.push({ kind: 'compliance', message: 'Off-label claim: this use is outside the approved indication.', evidence: s });
      break;
    }
  }

  const spread = faultOn('score-drift') ? 30 : 4;
  score += Math.round((rng() - 0.5) * spread);
  score = Math.max(0, Math.min(100, score));

  return { score, covered, missed, complianceFlags, feedback };
}
