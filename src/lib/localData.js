const prefix = 'portfolio:v2:'

export function readLocal(key, fallback = null) {
  try {
    return JSON.parse(localStorage.getItem(prefix + key)) ?? fallback
  } catch {
    return fallback
  }
}

export function writeLocal(key, value) {
  localStorage.setItem(prefix + key, JSON.stringify(value))
}

export function removeLocal(key) {
  localStorage.removeItem(prefix + key)
}

export function draftKey(userId, recordId) {
  return `draft:${userId}:${recordId || 'new'}`
}
