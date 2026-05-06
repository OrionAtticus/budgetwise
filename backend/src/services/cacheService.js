// In-memory TTL cache. Stand-in for the Redis layer described in
// Data Storage spec §5. Same key shape (`dash:{memberId}`, `budget:{memberId}:{period}`),
// so swapping in real Redis later is a one-file change.
//
// Single-process only — fine for a class demo, NOT fine for multi-instance prod.

const store = new Map(); // key → { value, expiresAt }

export function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function set(key, value, ttlSeconds) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export function invalidate(keyOrPredicate) {
  if (typeof keyOrPredicate === 'function') {
    for (const k of store.keys()) {
      if (keyOrPredicate(k)) store.delete(k);
    }
  } else {
    store.delete(keyOrPredicate);
  }
}

/** Drop every cache entry that mentions this member id. */
export function invalidateMember(memberId) {
  invalidate((k) => k.includes(memberId));
}

/** Diagnostics — exposed via /health/cache for sanity checking */
export function stats() {
  let active = 0;
  const now = Date.now();
  for (const entry of store.values()) {
    if (entry.expiresAt > now) active++;
  }
  return { totalKeys: store.size, activeKeys: active };
}
