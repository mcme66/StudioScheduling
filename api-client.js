export async function loadSchedule() {
  const res = await fetch('/api/schedule');
  if (!res.ok) throw new Error(`Could not load schedule (${res.status})`);
  return res.json();
}

export async function saveSchedule(update) {
  const res = await fetch('/api/schedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update)
  });
  if (!res.ok) throw new Error(`Could not save schedule (${res.status})`);
  return res.json();
}

/** Poll the server every few seconds so teacher and students stay in sync. */
export function subscribeSchedule(callback, intervalMs = 8000) {
  let cancelled = false;

  async function poll() {
    if (cancelled) return;
    try {
      callback(await loadSchedule());
    } catch (e) {
      console.error('Schedule sync error:', e);
    }
  }

  poll();
  const id = setInterval(poll, intervalMs);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
}
