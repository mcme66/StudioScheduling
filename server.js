const express = require('express');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'schedule.json');
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
  const slots = { ...DEFAULT.slots, ...(data.slots || {}) };
  return {
    slots,
    bookings: data.bookings && typeof data.bookings === 'object' ? data.bookings : {},
    pending: Array.isArray(data.pending) ? data.pending : []
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

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return normalize(JSON.parse(raw));
  } catch {
    return normalize(DEFAULT);
  }
}

function writeData(data) {
  const normalized = normalize(data);
  const pruned = prune(normalized);
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(pruned, null, 2) + '\n', 'utf8');
  return pruned;
}

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/schedule', (_req, res) => {
  const current = readData();
  const pruned = prune(current);
  const changed =
    JSON.stringify(pruned.bookings) !== JSON.stringify(current.bookings) ||
    JSON.stringify(pruned.pending) !== JSON.stringify(current.pending);
  res.json(changed ? writeData(pruned) : pruned);
});

app.put('/api/schedule', (req, res) => {
  const current = readData();
  const body = req.body || {};
  const merged = normalize({
    slots: body.slots !== undefined ? body.slots : current.slots,
    bookings: body.bookings !== undefined ? body.bookings : current.bookings,
    pending: body.pending !== undefined ? body.pending : current.pending
  });
  res.json(writeData(merged));
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
  console.log(`Lesson scheduler running at http://localhost:${PORT}`);
  console.log(`  Student page:  http://localhost:${PORT}/index.html`);
  console.log(`  Teacher page:  http://localhost:${PORT}/teacher.html`);
  console.log(`  Database file: data/schedule.json`);
});
