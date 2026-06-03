const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'schedule.json');
const SCHEDULE_ROW_ID = 'main';

let supabase = null;

function useSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && key);
}

function getSupabase() {
  if (!supabase && useSupabase()) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return supabase;
}

function storageMode() {
  return useSupabase() ? 'supabase' : 'file';
}

function readFileRaw() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeFileRaw(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function readRaw() {
  if (useSupabase()) {
    const client = getSupabase();
    const { data, error } = await client
      .from('schedule')
      .select('data')
      .eq('id', SCHEDULE_ROW_ID)
      .maybeSingle();

    if (error) {
      console.error('Supabase read error:', error.message);
      throw new Error('Could not load schedule from database');
    }
    if (data?.data) return data.data;
    return null;
  }
  return readFileRaw();
}

async function writeRaw(data) {
  if (useSupabase()) {
    const client = getSupabase();
    const { error } = await client.from('schedule').upsert(
      {
        id: SCHEDULE_ROW_ID,
        data,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'id' }
    );
    if (error) {
      console.error('Supabase write error:', error.message);
      throw new Error('Could not save schedule to database');
    }
    return;
  }
  writeFileRaw(data);
}

module.exports = { storageMode, readRaw, writeRaw, useSupabase };
