const DEFAULT_TIMEOUT = 10_000;

export class FetchError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "FetchError";
    this.code = code;
  }
}

export async function fetchJsonWithTimeout<T>(
  input: RequestInfo,
  init?: RequestInit,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new FetchError(
        body?.error ?? `HTTP ${res.status}`,
        body?.code ?? "UNKNOWN",
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      const url = typeof input === "string" ? input : (input as Request).url;
      throw new FetchError(`Resolution timed out (${url})`, "TIMEOUT");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
