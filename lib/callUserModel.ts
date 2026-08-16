// BYOK model connect (2026-08-13 design doc): the one generic call path for
// a user's own OpenAI-compatible endpoint (OpenRouter, Vercel AI Gateway, or
// any custom baseUrl). Replaces app/api/chat/route.ts's old
// safeAICall/streamAICall Anthropic-then-OpenAI-fallback logic — there's
// exactly one configured endpoint per user now, so a failure surfaces
// directly instead of silently retrying a different provider.
//
// Callers keep parsing responses the same way they did against Anthropic's
// message shape (`response.content.find(block => block.type === 'text')` /
// `response.content[0].type === 'text'`), so the non-stream return value is
// wrapped into that same `{ content: [{ type: 'text', text }] }` shape.

import OpenAI from 'openai';

export type UserModelConfig = {
  baseUrl: string;
  model: string;
  /** Already-decrypted plaintext key — decryption happens in the caller (route), not here. */
  apiKey: string;
};

export type CallUserModelParams = {
  system?: string | Array<{ text?: string }>;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
};

export type CallUserModelResponse = {
  content: Array<{ type: 'text'; text: string }>;
};

function flattenSystem(system: CallUserModelParams['system']): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system.map((block) => block?.text || '').filter(Boolean).join('\n\n');
}

function buildMessages(params: CallUserModelParams): OpenAI.Chat.ChatCompletionMessageParam[] {
  const systemContent = flattenSystem(params.system);
  return [
    ...(systemContent ? [{ role: 'system' as const, content: systemContent }] : []),
    ...params.messages,
  ] as OpenAI.Chat.ChatCompletionMessageParam[];
}

export function callUserModel(
  modelConfig: UserModelConfig,
  params: CallUserModelParams
): Promise<CallUserModelResponse>;
export function callUserModel(
  modelConfig: UserModelConfig,
  params: CallUserModelParams,
  opts: { stream: true }
): Promise<AsyncIterable<string>>;
export async function callUserModel(
  modelConfig: UserModelConfig,
  params: CallUserModelParams,
  opts?: { stream?: boolean }
): Promise<CallUserModelResponse | AsyncIterable<string>> {
  const client = new OpenAI({ baseURL: modelConfig.baseUrl, apiKey: modelConfig.apiKey });
  const messages = buildMessages(params);

  if (opts?.stream) {
    const completion = await client.chat.completions.create({
      model: modelConfig.model,
      messages,
      max_tokens: params.max_tokens,
      temperature: params.temperature ?? 0.7,
      stream: true,
    });

    return (async function* () {
      for await (const chunk of completion) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) yield text;
      }
    })();
  }

  const completion = await client.chat.completions.create({
    model: modelConfig.model,
    messages,
    max_tokens: params.max_tokens,
    temperature: params.temperature ?? 0.7,
    stream: false,
  });

  return {
    content: [{ type: 'text', text: completion.choices[0].message.content || '' }],
  };
}
