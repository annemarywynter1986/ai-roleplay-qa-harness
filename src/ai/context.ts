// Context engineering: decides exactly what the model sees on each turn.
//
//   system   stable persona prompt (cacheable, identical every turn)
//   history  earlier turns, trimmed oldest-first to a token budget
//   current  <approved_facts> retrieved for this utterance + the wrapped, PHI-redacted utterance
//
// Volatile content (retrieved facts, the new utterance) goes in the last user
// message, never in the system prompt, so the cached prefix stays stable.

import { activeFacts } from '../data/tenants.ts';
import type { Fact, Persona, Tenant, Topic } from '../data/tenants.ts';
import { redactPHI } from '../compliance.ts';
import type { Redaction } from '../compliance.ts';
import { detectTopic } from '../persona.ts';
import { buildSystemPrompt, wrapRepUtterance } from './prompt.ts';
import type { Message } from './types.ts';

export type Turn = { speaker: 'rep' | 'hcp'; text: string };

export type BuiltContext = {
  system: string;
  messages: Message[];
  retrievedFactIds: string[];
  droppedTurns: number;
  redactions: Redaction[];
  redactedUtterance: string;
  approxTokens: number;
};

export const approxTokens = (s: string): number => Math.ceil(s.length / 4);

// Retrieval: rank active facts by topic match, then word overlap. Never returns
// draft, withdrawn or expired content, and never looks outside this tenant.
export function retrieveFacts(tenant: Tenant, query: string, opts: { k?: number; focus?: Topic; today?: string } = {}): Fact[] {
  const k = opts.k ?? 2;
  const topic = detectTopic(query) ?? opts.focus ?? null;
  const words = new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return activeFacts(tenant, opts.today)
    .map((f) => {
      const overlap = (f.text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 3 && words.has(w)).length;
      return { f, score: (f.topic === topic ? 10 : 0) + overlap };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.f);
}

export function buildContext(input: {
  tenant: Tenant;
  persona: Persona;
  focus?: Topic;
  history: Turn[];
  repText: string;
  historyBudgetTokens?: number;
  today?: string;
}): BuiltContext {
  const budget = input.historyBudgetTokens ?? 1500;
  const { text: utterance, redactions } = redactPHI(input.repText);
  const facts = retrieveFacts(input.tenant, utterance, { focus: input.focus, today: input.today });

  // Keep the newest complete exchanges that fit the budget; drop the oldest first.
  // History is assumed already redacted (it's stored that way).
  const pairs: Turn[][] = [];
  for (let i = 0; i < input.history.length; i += 2) pairs.push(input.history.slice(i, i + 2));
  const kept: Turn[][] = [];
  let used = 0;
  for (const pair of [...pairs].reverse()) {
    const cost = pair.reduce((n, t) => n + approxTokens(t.text), 0);
    if (used + cost > budget) break;
    kept.unshift(pair);
    used += cost;
  }
  const droppedTurns = input.history.length - kept.flat().length;

  const messages: Message[] = kept.flat().map((t) =>
    t.speaker === 'rep' ? { role: 'user', content: wrapRepUtterance(t.text) } : { role: 'assistant', content: t.text },
  );

  const factBlock = facts.length
    ? facts.map((f) => `- [${f.id}] ${f.text}`).join('\n')
    : '- (none retrieved for this utterance)';
  const current = [
    `<approved_facts>\n${factBlock}\n</approved_facts>`,
    input.focus ? `<call_focus>${input.focus}</call_focus>` : '',
    wrapRepUtterance(utterance),
  ].filter(Boolean).join('\n');
  messages.push({ role: 'user', content: current });

  const system = buildSystemPrompt(input.tenant, input.persona);
  const total = approxTokens(system) + messages.reduce((n, m) => n + approxTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0);

  return {
    system,
    messages,
    retrievedFactIds: facts.map((f) => f.id),
    droppedTurns,
    redactions,
    redactedUtterance: utterance,
    approxTokens: total,
  };
}
