/** Retry a read once within the dashboard timeout. Never retry database mutations. */
export function databaseTransport(writeTimeoutMs = 10000): typeof fetch { return async (input, options) => {
  const method = options?.method ?? (input instanceof Request ? input.method : "GET");
  const readOnly = ["GET", "HEAD"].includes(method.toUpperCase());
  for (let attempt = 0; attempt < (readOnly ? 2 : 1); attempt++) {
    const timeout = AbortSignal.timeout(readOnly ? 4500 : writeTimeoutMs);
    try {
      const response = await fetch(input, { ...options, signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
      if (readOnly && attempt === 0 && response.status >= 500) { await response.body?.cancel(); continue; }
      return response;
    } catch (error) {
      if (!readOnly || attempt > 0 || options?.signal?.aborted) {
        // No URLs, headers, credentials or raw provider error messages in logs.
        const failure = error as { name?: string; cause?: { code?: string } };
        console.error(JSON.stringify({ scope: "database_transport", method, attempt: attempt + 1, error: failure.name ?? "NetworkError", code: failure.cause?.code ?? null }));
        throw error;
      }
    }
  }
  throw new Error("Database read unavailable");
}; }
export const databaseFetch = databaseTransport();
