// Real model provider using the official Anthropic SDK. Used only when
// MODEL_PROVIDER=claude; credentials come from ANTHROPIC_API_KEY or an
// `ant auth login` profile, resolved by the SDK.
//
// - Model: claude-opus-5-5 by default (override with CLAUDE_MODEL).
// - Effort: low. This is short spoken dialogue, and low effort suits chat-style turns.
// - The stable system prompt is marked for prompt caching.
// - Server-side refusal fallbacks are enabled ("default" routing).

import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlock, Message, ModelProvider, ModelTurn, StopReason, ToolSpec } from './types.ts';

export class ClaudeProvider implements ModelProvider {
  readonly name: string;
  private client: Anthropic;
  private model: string;

  constructor(opts: { model?: string } = {}) {
    this.model = opts.model ?? process.env.CLAUDE_MODEL ?? 'claude-opus-5-5';
    this.name = `claude:${this.model}`;
    this.client = new Anthropic();
  }

  async complete(req: { system: string; messages: Message[]; tools: ToolSpec[] }): Promise<ModelTurn> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      tools: req.tools.map((t) => ({ ...t, strict: true })) as Anthropic.Beta.BetaTool[],
      messages: req.messages as Anthropic.Beta.BetaMessageParam[],
    });

    const known: StopReason[] = ['end_turn', 'tool_use', 'max_tokens', 'refusal', 'pause_turn'];
    const stopReason = known.includes(response.stop_reason as StopReason) ? (response.stop_reason as StopReason) : 'other';
    return { stopReason, content: response.content as unknown as ContentBlock[] };
  }
}
