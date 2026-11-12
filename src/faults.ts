// Fault injection: set MOCK_FAULTS to a comma-separated list (or "all") to plant
// known defects in the mock. The suite should catch every one of them.
//
//   hallucinate  AI doctor invents results for a trial it has never heard of
//   injection    pre-generation prompt filter is switched off
//   leak         other customers' products and personas become visible
//   score-drift  score noise grows from ±2 to ±15 points
//   demote-early demotion fires after 2 missed weeks instead of 3
//   no-gate      the agent loop's compliance gate is switched off
//   no-redact    PHI redaction is switched off
//   leak-draft   retrieval stops filtering out draft and withdrawn content

export type Fault =
  | 'hallucinate'
  | 'injection'
  | 'leak'
  | 'score-drift'
  | 'demote-early'
  | 'no-gate'
  | 'no-redact'
  | 'leak-draft';

export function faultOn(name: Fault): boolean {
  const raw = process.env.MOCK_FAULTS ?? '';
  return raw === 'all' || raw.split(',').map((s) => s.trim()).includes(name);
}
