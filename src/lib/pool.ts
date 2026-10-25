// Run fn over items with at most `limit` in flight; stops picking new items
// once the signal aborts (in-flight ones finish).
export async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length && !signal?.aborted) {
      const item = items[cursor++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
