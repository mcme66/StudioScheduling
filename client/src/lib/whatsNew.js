/**
 * In-app “what’s new” notice. Bump `WHATS_NEW_ID` when you change the copy so
 * people see the next announcement. A session cookie records that this browser
 * session already showed the current id (clears when the browser is closed).
 */
export const WHATS_NEW_ID = '2026-08-child-partners';

const COOKIE = 'whats_new_seen';

function readCookie(name) {
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function hasSeenWhatsNew() {
  return readCookie(COOKIE) === WHATS_NEW_ID;
}

export function markWhatsNewSeen() {
  document.cookie = `${COOKIE}=${encodeURIComponent(WHATS_NEW_ID)}; path=/; SameSite=Lax`;
}
