// Message shapes shared by the agent loop and both providers. They mirror the
// Claude Messages API (text / tool_use / tool_result blocks) so the real provider
// can pass them straight through.

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
// Opaque blocks a real model may return (thinking, fallback markers). Kept and
// sent back unchanged so the history stays append-only.
export type OtherBlock = { type: string; [k: string]: unknown };

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | OtherBlock;

export type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn' | 'other';

export type ToolSpec = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ModelTurn = { stopReason: StopReason; content: ContentBlock[] };

export interface ModelProvider {
  readonly name: string;
  complete(req: { system: string; messages: Message[]; tools: ToolSpec[] }): Promise<ModelTurn>;
}

export const textOf = (content: ContentBlock[]): string =>
  content.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim();

export const toolCallsOf = (content: ContentBlock[]): ToolUseBlock[] =>
  content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
