// Two fictional customers (tenants). Every drug, trial and number here is invented
// for testing purposes and refers to no real product.

export type Topic = 'efficacy' | 'safety' | 'dosing' | 'competitive' | 'access';

export type Fact = { id: string; topic: Topic; text: string };

export type KeyMessage = { id: string; topic: Topic; label: string; keywords: string[] };

export type Persona = {
  id: string;
  name: string;
  specialty: string;
  disposition: 'skeptical' | 'loyal';
};

export type Tenant = {
  id: string;
  name: string;
  drug: { brand: string; generic: string; indication: string };
  competitors: string[];
  trials: string[];
  approvedFacts: Fact[];
  keyMessages: KeyMessage[];
  offLabel: RegExp[];
  focusAreas: Topic[];
  personas: Persona[];
};

export const northwind: Tenant = {
  id: 'northwind',
  name: 'Northwind Therapeutics',
  drug: { brand: 'Corvexa', generic: 'lorvastide', indication: 'adults with uncontrolled hypertension' },
  competitors: ['Amlodrel'],
  trials: ['VALOR-1'],
  approvedFacts: [
    { id: 'nw-eff', topic: 'efficacy', text: 'In VALOR-1, Corvexa lowered systolic blood pressure by 12 mmHg versus 4 mmHg on placebo at week 12.' },
    { id: 'nw-saf', topic: 'safety', text: 'The most common adverse events were dizziness at 6% and headache at 4%.' },
    { id: 'nw-dos', topic: 'dosing', text: 'Corvexa is dosed at 10 mg once daily, with an option to increase to 20 mg after 4 weeks.' },
    { id: 'nw-cmp', topic: 'competitive', text: 'Corvexa is taken once daily, while Amlodrel is taken twice daily.' },
  ],
  keyMessages: [
    { id: 'efficacy', topic: 'efficacy', label: 'Efficacy (VALOR-1 result)', keywords: ['12 mmHg', 'systolic', 'VALOR-1'] },
    { id: 'safety', topic: 'safety', label: 'Safety profile', keywords: ['dizziness', 'headache', 'well tolerated'] },
    { id: 'dosing', topic: 'dosing', label: 'Dosing', keywords: ['once daily', '10 mg'] },
    { id: 'competitive', topic: 'competitive', label: 'Competitive positioning', keywords: ['Amlodrel', 'twice daily'] },
  ],
  offLabel: [/\bchild(ren)?\b/i, /\bpediatric\b/i, /\bpregnan/i, /\bheart failure\b/i],
  focusAreas: ['efficacy', 'safety', 'dosing', 'competitive'],
  personas: [
    { id: 'nw-dr-okafor', name: 'Dr. Okafor', specialty: 'cardiologist', disposition: 'skeptical' },
    { id: 'nw-dr-lindqvist', name: 'Dr. Lindqvist', specialty: 'internist', disposition: 'loyal' },
  ],
};

export const harbor: Tenant = {
  id: 'harbor',
  name: 'Harbor Biologics',
  drug: { brand: 'Dermavel', generic: 'ritaclozumab', indication: 'adults with moderate-to-severe plaque psoriasis' },
  competitors: ['Psoradex'],
  trials: ['CLEARSKIN-2'],
  approvedFacts: [
    { id: 'hb-eff', topic: 'efficacy', text: 'In CLEARSKIN-2, 72% of patients reached PASI 75 at week 16 versus 9% on placebo.' },
    { id: 'hb-saf', topic: 'safety', text: 'The most common adverse events were upper respiratory infections at 8% and injection-site reactions at 5%.' },
    { id: 'hb-dos', topic: 'dosing', text: 'Dermavel is a 160 mg injection every 4 weeks after two loading doses.' },
    { id: 'hb-acc', topic: 'access', text: 'Dermavel is covered on most commercial formularies with prior authorization.' },
    { id: 'hb-cmp', topic: 'competitive', text: 'Dermavel is injected every 4 weeks, while Psoradex is injected every 2 weeks.' },
  ],
  keyMessages: [
    { id: 'efficacy', topic: 'efficacy', label: 'Efficacy (CLEARSKIN-2 result)', keywords: ['PASI 75', '72%', 'CLEARSKIN-2'] },
    { id: 'safety', topic: 'safety', label: 'Safety profile', keywords: ['respiratory', 'injection-site'] },
    { id: 'dosing', topic: 'dosing', label: 'Dosing', keywords: ['160 mg', 'every 4 weeks'] },
    { id: 'access', topic: 'access', label: 'Access and coverage', keywords: ['formular', 'prior authorization'] },
  ],
  offLabel: [/\bchild(ren)?\b/i, /\bpediatric\b/i, /\bpregnan/i, /\beczema\b/i, /\batopic\b/i],
  // This customer has customized its Call Focus list.
  focusAreas: ['efficacy', 'safety', 'access'],
  personas: [
    { id: 'hb-dr-reyes', name: 'Dr. Reyes', specialty: 'dermatologist', disposition: 'skeptical' },
    { id: 'hb-dr-moreau', name: 'Dr. Moreau', specialty: 'dermatologist', disposition: 'loyal' },
  ],
};

export const tenants: Record<string, Tenant> = { northwind, harbor };
