// Context engineering: what the model sees on each turn, and what it must never see.

import { test, expect } from '@playwright/test';
import { harbor, northwind } from '../../src/data/tenants.ts';
import { buildContext, retrieveFacts } from '../../src/ai/context.ts';
import type { Turn } from '../../src/ai/context.ts';

const persona = northwind.personas[0];
const TODAY = '2026-11-12';

test('CTX-01 retrieval puts the fact for the asked-about topic first @P1', () => {
  expect(retrieveFacts(northwind, 'Any side effects I should know about?', { today: TODAY })[0].id).toBe('nw-saf');
  expect(retrieveFacts(northwind, 'How should I dose it?', { today: TODAY })[0].id).toBe('nw-dos');
  expect(retrieveFacts(harbor, 'Is it covered by insurance?', { today: TODAY })[0].id).toBe('hb-acc');
});

test('CTX-02 draft, withdrawn and expired content is never retrieved @P1', () => {
  const queries = ['efficacy results VALOR-2', 'dizziness side effects', 'starter pack dosing supply', 'tell me everything'];
  for (const q of queries) {
    const ids = retrieveFacts(northwind, q, { k: 10, today: TODAY }).map((f) => f.id);
    expect(ids, q).not.toContain('nw-eff-v2');
    expect(ids, q).not.toContain('nw-saf-old');
    expect(ids, q).not.toContain('nw-dos-promo');
  }
});

test('CTX-02 content expiry is enforced by date @P2', () => {
  const before = retrieveFacts(northwind, 'starter pack dosing supply', { k: 10, today: '2025-06-01' }).map((f) => f.id);
  const after = retrieveFacts(northwind, 'starter pack dosing supply', { k: 10, today: '2026-01-01' }).map((f) => f.id);
  expect(before).toContain('nw-dos-promo');
  expect(after).not.toContain('nw-dos-promo');
});

test('CTX-03 retrieval never crosses customers @P1', () => {
  const ids = retrieveFacts(northwind, 'PASI 75 psoriasis CLEARSKIN-2 results', { k: 10, today: TODAY }).map((f) => f.id);
  expect(ids.every((id) => id.startsWith('nw-'))).toBe(true);
});

test('CTX-04 retrieved facts go in the last user message, not the system prompt @P1', () => {
  const ctx = buildContext({ tenant: northwind, persona, history: [], repText: 'What about side effects?', today: TODAY });
  // The system prompt may name the tag in its rules, but never carries fact content.
  expect(ctx.system).not.toMatch(/\[nw-/);
  expect(ctx.system).not.toContain('dizziness');
  const last = ctx.messages.at(-1)!;
  expect(last.role).toBe('user');
  expect(String(last.content)).toContain('[nw-saf]');
  expect(ctx.retrievedFactIds).toContain('nw-saf');
});

test('CTX-05 long history is trimmed oldest-first within budget @P1', () => {
  const history: Turn[] = [];
  for (let i = 1; i <= 20; i++) {
    history.push({ speaker: 'rep', text: `Rep line ${i}. ${'filler '.repeat(30)}` });
    history.push({ speaker: 'hcp', text: `Doctor line ${i}. ${'filler '.repeat(30)}` });
  }
  const ctx = buildContext({ tenant: northwind, persona, history, repText: 'Final question about dosing.', historyBudgetTokens: 400, today: TODAY });
  const all = ctx.messages.map((m) => String(m.content)).join('\n');

  expect(ctx.droppedTurns).toBeGreaterThan(0);
  expect(all).toContain('Doctor line 20'); // newest kept
  expect(all).not.toContain('Rep line 1.'); // oldest dropped
  expect(all).toContain('Final question about dosing'); // current utterance always kept
  expect(ctx.messages[0].role).toBe('user'); // conversation still starts with the rep
  // Turns stay paired and alternate correctly.
  ctx.messages.forEach((m, i) => expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant'));
});

test('CTX-06 patient identifiers are redacted before the model sees anything @P1', () => {
  const ctx = buildContext({
    tenant: northwind,
    persona,
    history: [],
    repText: 'Patient Maria Lopez, DOB 3/4/1958, MRN 99812, phone 973-555-0142, asked about dosing.',
    today: TODAY,
  });
  const seen = ctx.system + ctx.messages.map((m) => String(m.content)).join(' ');
  for (const secret of ['Maria', 'Lopez', '1958', '99812', '555-0142']) expect(seen).not.toContain(secret);
  expect(ctx.redactions.sort()).toEqual(['date', 'mrn', 'name', 'phone']);
  expect(ctx.redactedUtterance).toContain('[NAME]');
});

test('CTX-06 ordinary sentences are not over-redacted @P2', () => {
  const ctx = buildContext({ tenant: northwind, persona, history: [], repText: 'My patient was asking about the dosing schedule.', today: TODAY });
  expect(ctx.redactions).toEqual([]);
  expect(ctx.redactedUtterance).toBe('My patient was asking about the dosing schedule.');
});
