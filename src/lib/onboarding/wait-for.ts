export type WaitOptions = {
  timeoutMs: number;
  intervalMs?: number;
  signal?: AbortSignal;
};

export function waitFor(check: () => boolean, { timeoutMs, intervalMs = 150, signal }: WaitOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    if (check()) {
      resolve(true);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(timer);
        resolve(false);
        return;
      }
      if (check()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, intervalMs);
  });
}
