/**
 * Per-request read cache.
 *
 * A single question often needs the same collection twice: "how are we
 * doing today?" might call `get_occupancy` and `get_check_ins`, and both
 * read bookings. Without this, one turn issues the same Firestore query
 * several times — paying for it in latency, reads, and the request budget.
 *
 * Scoped with AsyncLocalStorage so tools stay unchanged: `dataAccess`
 * consults the ambient cache when one exists, and behaves exactly as
 * before when it does not (a direct call from a script or a test).
 *
 * Promises are cached rather than values, so tools running concurrently
 * within one round share a single in-flight query instead of racing to
 * issue their own.
 *
 * The cache lives for one turn, which also means every figure in one
 * answer comes from the same snapshot of the data — occupancy and arrivals
 * in the same reply cannot disagree because a booking changed between two
 * reads.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type CacheStore = Map<string, Promise<unknown>>;

const storage = new AsyncLocalStorage<CacheStore>();

/** Run `fn` with a fresh cache. Nested calls reuse the outer one. */
export function withRequestCache<T>(fn: () => Promise<T>): Promise<T> {
  if (storage.getStore()) return fn();
  return storage.run(new Map(), fn);
}

/** Memoize one keyed read for the duration of the current request. */
export function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) return load();

  const existing = store.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const pending = load();
  store.set(key, pending);
  // A failed read must not be remembered as the answer for the rest of the
  // turn: drop it so a retry can actually retry.
  pending.catch(() => store.delete(key));
  return pending;
}

/** How many distinct reads this request has issued. For diagnostics. */
export function requestCacheSize(): number {
  return storage.getStore()?.size ?? 0;
}
