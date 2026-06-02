const API_URL = new URL('api/schedule', window.location.origin).href;
const STATIC_URL = new URL('data/schedule.json', window.location.origin).href;
const REQUEST_TIMEOUT_MS = 20000;

let readOnly = false;

export function isReadOnly() {
  return readOnly;
}

function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function normalize(data) {
  const pending = Array.isArray(data.pending)
    ? data.pending
    : Array.isArray(data.items)
      ? data.items
      : [];
  return {
    slots: data.slots || {},
    bookings: data.bookings || {},
    pending
  };
}

async function loadStaticSchedule() {
  const res = await fetchWithTimeout(STATIC_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Static schedule not found (${res.status})`);
  readOnly = true;
  return normalize(await res.json());
}

export async function loadSchedule() {
  try {
    const res = await fetchWithTimeout(API_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`API error (${res.status})`);
    readOnly = false;
    return normalize(await res.json());
  } catch (apiErr) {
    try {
      return await loadStaticSchedule();
    } catch {
      throw apiErr;
    }
  }
}

export async function saveSchedule(update) {
  if (readOnly) {
    throw new Error('Schedule is read-only. Deploy with the Node server (npm start) to save changes.');
  }
  const res = await fetchWithTimeout(API_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update)
  });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
  readOnly = false;
  return normalize(await res.json());
}

/** Load with retries (helps when a free host is waking from sleep). */
export async function loadScheduleWithRetry(maxAttempts = 8) {
  let lastError;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await loadSchedule();
    } catch (e) {
      lastError = e;
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, Math.min(1500 * (i + 1), 8000)));
      }
    }
  }
  throw lastError;
}

/**
 * Poll the server so teacher and students stay in sync.
 * onStatus(message | null) — null clears the status line
 */
export function subscribeSchedule(callback, { onStatus } = {}) {
  let cancelled = false;
  let attempt = 0;

  async function poll() {
    if (cancelled) return;
    attempt++;
    if (attempt === 1) onStatus?.('Connecting to schedule…');
    try {
      const data = await loadScheduleWithRetry(attempt === 1 ? 6 : 2);
      onStatus?.(
        readOnly
          ? 'Viewing schedule (read-only). Start the server with npm start to enable saving.'
          : null
      );
      callback(data);
    } catch (e) {
      console.error('Schedule sync error:', e);
      const msg =
        e.name === 'AbortError'
          ? 'Server is slow to respond (may be waking up). Retrying…'
          : 'Could not reach the schedule API. Retrying…';
      onStatus?.(msg);
      try {
        callback(await loadStaticSchedule());
        onStatus?.(
          'Showing schedule from data/schedule.json only. Edits require the Node server (npm start on Render).'
        );
      } catch {
        onStatus?.(
          'Cannot load schedule. This app must run as a Node site (Render: npm start), not static files only.'
        );
      }
    }
  }

  poll();
  const id = setInterval(poll, 8000);

  return () => {
    cancelled = true;
    clearInterval(id);
  };
}
