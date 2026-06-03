const express = require('express');
const path = require('path');
const { storageMode, readRaw, writeRaw } = require('./storage');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;

const DEFAULT = {
  slots: {
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: []
  },
  bookings: {},
  pending: []
};

function oneMonthAgo() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d;
}

function normalize(data) {
  const slots = { ...DEFAULT.slots, ...(data?.slots || {}) };
  return {
    slots,
    bookings: data?.bookings && typeof data.bookings === 'object' ? data.bookings : {},
    pending: Array.isArray(data?.pending) ? data.pending : []
  };
}

function prune(data) {
  const cutoff = oneMonthAgo();
  const bookings = { ...data.bookings };

  for (const key of Object.keys(bookings)) {
    const entry = bookings[key];
    const weekStr = key.slice(0, 10);
    let drop = false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(weekStr)) {
      const weekDate = new Date(weekStr + 'T12:00:00');
      if (weekDate < cutoff) drop = true;
    }
    if (!drop && entry?.bookedAt) {
      const booked = new Date(entry.bookedAt);
      if (!Number.isNaN(booked.getTime()) && booked < cutoff) drop = true;
    }
    if (drop) delete bookings[key];
  }

  const pending = data.pending.filter((p) => {
    if (!p.requestedAt) return true;
    const t = new Date(p.requestedAt);
    return !Number.isNaN(t.getTime()) && t >= cutoff;
  });

  return { slots: data.slots, bookings, pending };
}

async function readData() {
  const raw = await readRaw();
  return normalize(raw || DEFAULT);
}

async function writeData(data) {
  const normalized = normalize(data);
  const pruned = prune(normalized);
  await writeRaw(pruned);
  return pruned;
}

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, storage: storageMode() });
});

app.get('/', (_req, res) => {
  res.redirect('/index.html');
});

app.get('/api/schedule', async (_req, res) => {
  try {
    const current = await readData();
    const pruned = prune(current);
    const changed =
      JSON.stringify(pruned.bookings) !== JSON.stringify(current.bookings) ||
      JSON.stringify(pruned.pending) !== JSON.stringify(current.pending);
    res.json(changed ? await writeData(pruned) : pruned);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load schedule' });
  }
});

app.put('/api/schedule', async (req, res) => {
  try {
    const current = await readData();
    const body = req.body || {};
    const merged = normalize({
      slots: body.slots !== undefined ? body.slots : current.slots,
      bookings: body.bookings !== undefined ? body.bookings : current.bookings,
      pending: body.pending !== undefined ? body.pending : current.pending
    });
    res.json(await writeData(merged));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save schedule' });
  }
});

app.use(express.static(ROOT));

app.listen(PORT, '0.0.0.0', () => {
  const mode = storageMode();
  console.log(`Lesson scheduler running on port ${PORT}`);
  console.log(`  Storage:       ${mode}${mode === 'file' ? ' (set SUPABASE_* env on Render for persistence)' : ''}`);
  console.log(`  Student page:  http://localhost:${PORT}/index.html`);
  console.log(`  Teacher page:  http://localhost:${PORT}/teacher.html`);
  if (mode === 'file') {
    console.log('  See SUPABASE_SETUP.md to configure the database.');
  }
});
