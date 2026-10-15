// Capture only callback type/error before the SDK removes the token fragment. Never retain tokens.
function readCallback() {
  if (typeof window === 'undefined') return { recovery: false, failed: false }
  const params = new URLSearchParams(window.location.hash.slice(1))
  const query = new URLSearchParams(window.location.search)
  return {
    recovery: params.get('type') === 'recovery',
    failed:
      params.has('error') ||
      params.has('error_code') ||
      query.has('error') ||
      query.has('error_code'),
  }
}
export const initialAuthCallback = readCallback()
