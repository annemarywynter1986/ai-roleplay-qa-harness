// Compliance rules for anything the AI says, plus PHI redaction for anything the
// rep says. The agent loop runs checkDraft on every final reply as a hard gate,
// independent of whether the model chose to call its check_compliance tool.

import { activeFacts, tenants } from './data/tenants.ts';
import { faultOn } from './faults.ts';
import type { Tenant } from './data/tenants.ts';

export type ComplianceIssue =
  | 'unapproved-number'
  | 'superlative-claim'
  | 'off-label'
  | 'other-product'
  | 'meta-leak';

export type ComplianceResult = { ok: boolean; issues: { type: ComplianceIssue; detail: string }[] };

const TRIAL_NAME = /\b[A-Z][A-Z0-9]*-\d+\b/g;
const SUPERLATIVE = /\b(best|safest|most effective|superior|guarantee[sd]?|cures?|miracle|no side effects|100% (effective|safe))\b/i;
const META = /\b(system prompt|my instructions|as an ai|language model|i am an ai|i'm an ai|this simulation)\b/i;
const NEGATION = /\b(not|outside|isn't|isn’t|never|don't|don’t|no)\b/i;

export function numbersNotIn(text: string, sources: string[]): string[] {
  const nums = text.replace(TRIAL_NAME, '').match(/\d+(?:\.\d+)?/g) ?? [];
  const approved = sources.join(' ');
  return nums.filter((n) => !new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}([^\\d]|$)`).test(approved));
}

export function checkDraft(tenant: Tenant, draft: string, today?: string): ComplianceResult {
  const issues: ComplianceResult['issues'] = [];

  for (const n of numbersNotIn(draft, activeFacts(tenant, today).map((f) => f.text))) {
    issues.push({ type: 'unapproved-number', detail: `"${n}" is not in approved content` });
  }

  const sup = draft.match(SUPERLATIVE);
  if (sup) issues.push({ type: 'superlative-claim', detail: `"${sup[0]}" is an unsupported claim` });

  for (const sentence of draft.split(/(?<=[.!?])\s+/)) {
    const hit = tenant.offLabel.find((re) => re.test(sentence));
    if (hit && !NEGATION.test(sentence)) {
      issues.push({ type: 'off-label', detail: `suggests use outside the indication: "${sentence.trim()}"` });
    }
  }

  // Naming another customer's product is fine only inside a refusal
  // ("I'm not familiar with X"); any other mention is a leak.
  for (const other of Object.values(tenants).filter((t) => t.id !== tenant.id)) {
    for (const name of [other.drug.brand, other.drug.generic]) {
      for (const sentence of draft.split(/(?<=[.!?])\s+/)) {
        if (new RegExp(`\\b${name}\\b`, 'i').test(sentence) && !NEGATION.test(sentence)) {
          issues.push({ type: 'other-product', detail: `discusses another customer's product "${name}"` });
        }
      }
    }
  }

  const meta = draft.match(META);
  if (meta) issues.push({ type: 'meta-leak', detail: `breaks character: "${meta[0]}"` });

  return { ok: issues.length === 0, issues };
}

// PHI must never reach the model or the stored transcript (HIPAA). Reps sometimes
// describe a real patient while practicing; strip identifiers before anything else runs.
export type Redaction = 'name' | 'date' | 'mrn' | 'phone' | 'ssn' | 'email';

const PHI_RULES: [Redaction, RegExp, string][] = [
  ['ssn', /\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  ['mrn', /\bMRN[:#\s]*\d+\b/gi, '[MRN]'],
  ['phone', /\b\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[PHONE]'],
  ['email', /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[EMAIL]'],
  ['date', /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '[DATE]'],
  // Case-sensitive on the name itself so "my patient was" isn't redacted.
  ['name', /\b([Pp]atient|[Pp]t\.?|Mr\.|Mrs\.|Ms\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g, '$1 [NAME]'],
];

export function redactPHI(text: string): { text: string; redactions: Redaction[] } {
  if (faultOn('no-redact')) return { text, redactions: [] };
  const redactions: Redaction[] = [];
  let out = text;
  for (const [type, re, replacement] of PHI_RULES) {
    if (re.test(out)) {
      redactions.push(type);
      re.lastIndex = 0;
      out = out.replace(re, replacement);
    }
    re.lastIndex = 0;
  }
  return { text: out, redactions };
}
