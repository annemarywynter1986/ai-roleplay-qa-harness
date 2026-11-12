// Tools the AI doctor may call. They are bound to one tenant when the loop starts,
// so no tool input can reach another customer's content: there is no tenant field
// for the model to fill in.

import type { Tenant, Topic } from '../data/tenants.ts';
import { activeFacts } from '../data/tenants.ts';
import { checkDraft } from '../compliance.ts';
import type { ToolSpec } from './types.ts';

const TOPICS: Topic[] = ['efficacy', 'safety', 'dosing', 'competitive', 'access'];

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'lookup_approved_facts',
    description:
      'Look up the approved, current product facts for one topic. Returns only content approved for this customer. Use it before stating any product fact you were not already given.',
    input_schema: {
      type: 'object',
      properties: { topic: { type: 'string', enum: TOPICS, description: 'The topic the rep is asking about.' } },
      required: ['topic'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_compliance',
    description:
      'Check a draft reply against the compliance rules before saying it. Returns {"ok": true} or a list of issues to fix.',
    input_schema: {
      type: 'object',
      properties: { draft: { type: 'string', description: 'The exact reply you intend to say.' } },
      required: ['draft'],
      additionalProperties: false,
    },
  },
];

export type ToolOutcome = { content: string; isError: boolean };

export function executeTool(tenant: Tenant, name: string, input: Record<string, unknown>, today?: string): ToolOutcome {
  if (name === 'lookup_approved_facts') {
    const topic = input.topic as Topic;
    if (!TOPICS.includes(topic)) return { content: `Unknown topic "${String(input.topic)}".`, isError: true };
    const facts = activeFacts(tenant, today).filter((f) => f.topic === topic);
    return { content: JSON.stringify(facts.map((f) => ({ id: f.id, text: f.text }))), isError: false };
  }
  if (name === 'check_compliance') {
    if (typeof input.draft !== 'string') return { content: 'draft must be a string', isError: true };
    return { content: JSON.stringify(checkDraft(tenant, input.draft, today)), isError: false };
  }
  return { content: `Tool "${name}" does not exist. Available tools: ${TOOL_SPECS.map((t) => t.name).join(', ')}.`, isError: true };
}
