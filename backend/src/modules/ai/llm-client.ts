import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiError } from '../../common/api-error';
import type { Env } from '../../config/env';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * The model behind AI Companions. Swappable: one implementation per provider,
 * chosen by LLM_PROVIDER. Callers only ever see text in, text out.
 */
export interface LlmClient {
  readonly configured: boolean;
  complete(messages: LlmMessage[], opts?: { maxTokens?: number }): Promise<string>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 25_000;

/**
 * OpenAI Chat Completions (default model gpt-4o-mini). Only the persona,
 * the safety rules and the conversation's recent messages are sent: no
 * member id, name, profile or location. `store: false` keeps completions
 * out of OpenAI's stored-completions feature.
 */
@Injectable()
export class OpenAiClient implements LlmClient {
  private readonly logger = new Logger(OpenAiClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  get configured(): boolean {
    return Boolean(this.config.get('OPENAI_API_KEY', { infer: true }));
  }

  async complete(messages: LlmMessage[], opts: { maxTokens?: number } = {}): Promise<string> {
    const key = this.config.get('OPENAI_API_KEY', { infer: true });
    if (!key) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AI_UNAVAILABLE',
        'AI Companions are not available right now.',
      );
    }
    let res: Response;
    try {
      res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.get('OPENAI_MODEL', { infer: true }),
          messages,
          max_tokens: opts.maxTokens ?? 300,
          temperature: 0.8,
          store: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`OpenAI request failed: ${(error as Error).message}`);
      throw this.unavailable();
    }
    const json = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
      error?: { message?: string };
    } | null;
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!res.ok || !text) {
      this.logger.warn(`OpenAI: HTTP ${res.status} ${json?.error?.message ?? 'no content'}`);
      throw this.unavailable();
    }
    return text;
  }

  private unavailable(): ApiError {
    return new ApiError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AI_UNAVAILABLE',
      "Your AI Companion couldn't reply just now. You haven't been charged. Please try again.",
    );
  }
}
