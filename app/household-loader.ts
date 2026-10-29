const DEFAULT_TIMEOUT_MS = 15_000;

export interface HouseholdSnapshot { records: unknown[]; }
export interface HouseholdLoader<T extends HouseholdSnapshot> {
  load: () => Promise<T>;
  cancel: () => void;
}

function cancelled(): Error {
  const error = new Error("The household request was cancelled.");
  error.name = "AbortError";
  return error;
}

/** One bounded, shared read at a time. No household data is cached in browser storage. */
export function createHouseholdLoader<T extends HouseholdSnapshot>(
  fetcher: typeof fetch = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): HouseholdLoader<T> {
  let active: { controller: AbortController; promise: Promise<T>; reject: (error: Error) => void } | undefined;

  return {
    load() {
      if (active) return active.promise;
      const controller = new AbortController();
      let reject!: (error: Error) => void;
      const interrupted = new Promise<never>((_resolve, fail) => { reject = fail; });
      const timeout = setTimeout(() => {
        reject(new Error("The household took too long to respond. Check your connection and tap Retry."));
        controller.abort();
      }, timeoutMs);
      const transport = (async () => {
        const response = await fetcher("/api/state", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (response.status === 401 || response.redirected) throw new Error("Your sign-in may have expired. Reopen the private hub and sign in with ChatGPT, then retry.");
        let data: unknown;
        try { data = await response.json(); }
        catch { throw new Error("The household response could not be read. Reopen the private hub and retry."); }
        const value = data as { records?: unknown; error?: { message?: unknown } | string } | null;
        if (!response.ok) {
          const detail = typeof value?.error === "string" ? value.error : value?.error?.message;
          throw new Error(typeof detail === "string" ? detail : "The household could not be loaded. Tap Retry.");
        }
        if (!value || !Array.isArray(value.records)) throw new Error("The household response was incomplete. Your last loaded data has been kept; tap Retry.");
        return data as T;
      })();
      const operation = { controller, reject, promise: undefined as unknown as Promise<T> };
      operation.promise = Promise.race([transport, interrupted]).finally(() => {
        clearTimeout(timeout);
        if (active === operation) active = undefined;
      });
      active = operation;
      return operation.promise;
    },
    cancel() {
      const operation = active;
      active = undefined;
      if (operation) {
        operation.reject(cancelled());
        operation.controller.abort();
      }
    },
  };
}
