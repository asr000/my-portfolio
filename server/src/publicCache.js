// This cache only holds anonymous public list data in this API process.
const ttlMs = 5000
const maxEntries = 100
const entries = new Map()
let generation = 0

export function invalidatePublicLists() {
  generation += 1
  entries.clear()
}

export async function cachedPublicList(key, load) {
  const previous = entries.get(key)
  if (previous && (previous.pending || previous.expiresAt > Date.now())) return previous.promise

  const version = generation
  const entry = { pending: true, expiresAt: 0, promise: null }
  entry.promise = Promise.resolve().then(load).then((value) => {
    // A write committed during the query; fetch again instead of serving old data.
    if (version !== generation) return cachedPublicList(key, load)
    entry.pending = false
    entry.expiresAt = Date.now() + ttlMs
    return value
  }).catch((error) => {
    if (entries.get(key) === entry) entries.delete(key)
    throw error
  })
  if (entries.size >= maxEntries) entries.delete(entries.keys().next().value)
  entries.set(key, entry)
  return entry.promise
}
