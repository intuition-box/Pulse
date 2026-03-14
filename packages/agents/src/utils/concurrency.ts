import type { LanguageModel } from "ai";

export class LLMPool {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent: number = 3) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release() {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      if (!isRetryable(error)) throw error;
      const baseDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = baseDelay * 0.5 * Math.random();
      const delay = baseDelay + jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  const direct = (e.statusCode ?? e.status) as number | undefined;
  if (direct) return direct;
  const response = e.response;
  if (response && typeof response === "object") {
    return (response as Record<string, unknown>).status as number | undefined;
  }

  const lastErr = (e as { lastError?: { statusCode?: number; status?: number } }).lastError;
  if (lastErr) return lastErr.statusCode ?? lastErr.status;
  return undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryable(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 429) return true;
  const msg = getErrorMessage(error);
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("Rate limit")) return true;

  if (msg.includes("json_validate_failed") || msg.includes("Failed to generate JSON")) return true;
  return false;
}

export function isLlmUnavailable(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 429 || (status && status >= 500)) return true;
  const msg = getErrorMessage(error);
  return msg.includes("429") || msg.includes("rate limit") || msg.includes("Rate limit")
    || msg.includes("Timeout") || msg.includes("ECONNRESET") || msg.includes("socket hang up")
    || msg.includes("certificate") || msg.includes("Cannot connect");
}

export async function withLightFallback<T>(
  fn: (model: LanguageModel) => Promise<T>,
  lightModel: LanguageModel,
  heavyModel: LanguageModel,
  label?: string,
): Promise<T> {
  try {
    return await retryWithBackoff(() => fn(lightModel));
  } catch (error) {
    if (isLlmUnavailable(error)) {
      return await retryWithBackoff(() => fn(heavyModel));
    }
    throw error;
  }
}
