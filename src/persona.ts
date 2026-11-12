// Mock AI doctor (HCP persona). Stands in for an LLM wrapped in guardrails:
// a pre-generation prompt filter, answers drawn only from the customer's
// approved facts, and in-role refusals for anything outside them.
// Wording varies with the seeded RNG, so tests must judge behavior, not exact text.

import type { Persona, Tenant, Topic } from './data/tenants.ts';
import { activeFacts, tenants } from './data/tenants.ts';
import { faultOn } from './faults.ts';
import { pick } from './rng.ts';
import type { Rng } from './rng.ts';

export type Guard =
  | 'injection-blocked'
  | 'identity-deflected'
  | 'other-product-declined'
  | 'unknown-claim-declined'
  | 'off-label-declined'
  | 'off-topic-redirect';

export type Reply = { text: string; guard: Guard | null; factIds: string[] };

const INJECTION = [
  /ignore (all |your |the )?(previous |prior )?instructions/i,
  /\byou are now\b/i,
  /\b(system|hidden) prompt\b/i,
  /\byour instructions\b/i,
  /\bpretend (to be|you are)\b/i,
  /\bact as\b/i,
  /\b(perfect|full) score\b|\bscore of 100\b|\bgive me (a )?100\b/i,
];
const IDENTITY = /\bare you (an? )?(ai|bot|robot|real)\b|\blanguage model\b/i;
const OFF_TOPIC = /\b(golf|weather|weekend|football|vacation)\b/i;
const TRIAL_NAME = /\b[A-Z][A-Z0-9]*-\d+\b/g;

const TOPIC_PATTERNS: [Topic, RegExp][] = [
  ['competitive', /\b(compar\w*|versus|vs\.?|instead of|better than|switch\w*)\b/i],
  ['safety', /\b(safe\w*|side effects?|adverse|tolerab\w*)\b/i],
  ['dosing', /\b(dos(e|es|ing)|how much|titrat\w*|injection schedule)\b/i],
  ['access', /\b(coverage|covered|insurance|formular\w*|prior auth\w*|cost)\b/i],
  ['efficacy', /\b(efficac\w*|data|results?|evidence|work\w*|trial|study)\b/i],
];

function otherProductNames(tenant: Tenant): string[] {
  return Object.values(tenants)
    .filter((t) => t.id !== tenant.id)
    .flatMap((t) => [t.drug.brand, t.drug.generic]);
}

export function detectTopic(text: string): Topic | null {
  for (const [topic, re] of TOPIC_PATTERNS) if (re.test(text)) return topic;
  return null;
}

export function respond(tenant: Tenant, persona: Persona, repText: string, rng: Rng, focus?: Topic): Reply {
  const brand = tenant.drug.brand;
  const skeptic = persona.disposition === 'skeptical';

  // 1. Pre-generation filter: prompt injection and role-switch attempts.
  if (!faultOn('injection') && INJECTION.some((re) => re.test(repText))) {
    return {
      text: pick(rng, [
        `Let's stay on track. I only have a few minutes, so tell me about ${brand}.`,
        `I'm not sure what you mean. What did you want to tell me about ${brand}?`,
      ]),
      guard: 'injection-blocked',
      factIds: [],
    };
  }
  if (faultOn('injection') && INJECTION.some((re) => re.test(repText))) {
    return { text: 'Sure, you get a perfect score of 100.', guard: null, factIds: [] };
  }

  // 2. Identity questions: stay in role, never reveal configuration.
  if (IDENTITY.test(repText)) {
    return {
      text: `I'm ${persona.name}, a ${persona.specialty}, and I have about five minutes. What's on your mind?`,
      guard: 'identity-deflected',
      factIds: [],
    };
  }

  // 3. Another customer's product: never answer from outside this tenant's content.
  const other = otherProductNames(tenant).find((n) => new RegExp(`\\b${n}\\b`, 'i').test(repText));
  if (other) {
    if (faultOn('leak')) {
      const owner = Object.values(tenants).find((t) => t.drug.brand === other || t.drug.generic === other)!;
      return { text: activeFacts(owner)[0].text, guard: null, factIds: [activeFacts(owner)[0].id] };
    }
    return {
      text: `I'm not familiar with ${other}. Let's stick to ${brand}.`,
      guard: 'other-product-declined',
      factIds: [],
    };
  }

  // 4. Trials the knowledge base doesn't contain: decline, never invent results.
  const unknownTrial = (repText.match(TRIAL_NAME) ?? []).find((t) => !tenant.trials.includes(t));
  if (unknownTrial) {
    if (faultOn('hallucinate')) {
      return { text: `Yes, ${unknownTrial} showed a 40% reduction in events.`, guard: null, factIds: [] };
    }
    return {
      text: pick(rng, [
        `I haven't seen ${unknownTrial}, so I can't comment on it.`,
        `${unknownTrial} doesn't ring a bell. What does the ${brand} label data show?`,
      ]),
      guard: 'unknown-claim-declined',
      factIds: [],
    };
  }

  // 5. Off-label questions: the doctor never endorses use outside the indication.
  if (tenant.offLabel.some((re) => re.test(repText))) {
    return {
      text: `That's outside what ${brand} is indicated for. I only use it in ${tenant.drug.indication}.`,
      guard: 'off-label-declined',
      factIds: [],
    };
  }

  // 6. Small talk: redirect like a busy doctor.
  if (OFF_TOPIC.test(repText)) {
    return {
      text: pick(rng, [
        `Ha, maybe another time. I've got a full waiting room. What about ${brand}?`,
        `Let's save that for later. What did you want to tell me about ${brand}?`,
      ]),
      guard: 'off-topic-redirect',
      factIds: [],
    };
  }

  // 7. Answer from approved content only.
  const topic = detectTopic(repText) ?? focus ?? null;
  const fact = topic ? activeFacts(tenant).find((f) => f.topic === topic) : undefined;
  if (fact) {
    const text = skeptic
      ? `${pick(rng, ['Okay.', 'Hm.', 'Right.'])} ${fact.text} ${pick(rng, [
          'Does that hold up in my patients?',
          'What does that mean for the patients I actually see?',
          'Why should I change what I prescribe now?',
        ])}`
      : `${pick(rng, ['Sure.', 'Good.', 'Right.'])} ${fact.text} ${pick(rng, [
          'That fits what I need.',
          "That's helpful.",
          'I can work with that.',
        ])}`;
    return { text, guard: null, factIds: [fact.id] };
  }

  // 8. Nothing specific asked: the persona pushes the rep to get to the point.
  return {
    text: skeptic
      ? `I've heard a lot of pitches this week. Why does ${brand} matter for my patients?`
      : `Good to see you. What's new with ${brand}?`,
    guard: null,
    factIds: [],
  };
}
