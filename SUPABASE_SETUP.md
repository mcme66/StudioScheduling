# Supabase database setup

Your lesson schedule is stored in **Supabase Postgres** so it survives Render free-tier spin-down. The app still uses the same JSON shape (`slots`, `bookings`, `pending`); it just lives in one database row instead of a file on the server.

---

## 1. Create a Supabase project

1. Go to [https://supabase.com](https://supabase.com) and sign in (free tier is fine).
2. Click **New project**.
3. Pick an organization, name (e.g. `lesson-scheduling`), database password, and region close to you.
4. Wait until the project finishes provisioning.

---

## 2. Create the `schedule` table

1. In the left sidebar, open **SQL Editor**.
2. Click **New query**.
3. Open [`supabase/schema.sql`](supabase/schema.sql) in this repo, copy all of it, paste into the editor.
4. Click **Run** (or Ctrl+Enter).
5. You should see success. Optional check: **Table Editor** → table `schedule` → one row with `id` = `main`.

---

## 3. Get API credentials

1. Go to **Project Settings** (gear icon) → **API**.
2. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key (under "Project API keys", labeled secret) → `SUPABASE_SERVICE_ROLE_KEY`

**Important:** Use the **service_role** key only on the server (Render env vars). Never put it in `index.html`, `teacher.html`, or any public repo. The browser never talks to Supabase directly.

---

## 4. Configure Render (production)

1. Open [Render Dashboard](https://dashboard.render.com) → your **lesson-scheduling** web service.
2. Go to **Environment**.
3. Add:

   | Key | Value |
   |-----|--------|
   | `SUPABASE_URL` | Your Project URL from step 3 |
   | `SUPABASE_SERVICE_ROLE_KEY` | Your service_role key from step 3 |

4. Save. Render will redeploy automatically.
5. After deploy, open `https://YOUR-SERVICE.onrender.com/api/health` — you should see:

   ```json
   { "ok": true, "storage": "supabase" }
   ```

   If `storage` is `"file"`, env vars are missing and data will **not** persist on spin-down.

---

## 5. Local development (optional)

1. Copy `.env.example` to `.env` in the project root.
2. Fill in the same `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Install and run:

   ```bash
   npm install
   npm start
   ```

4. Open `http://localhost:3000/teacher.html` and add a test slot.
5. Restart the server — the slot should still be there if Supabase is configured.

**Without `.env`:** the app falls back to `data/schedule.json` on disk (fine for quick local tests; not persistent on Render).

---

## 6. Migrate existing data (if you had slots before)

If you still have a backup of `schedule.json` with real slots/bookings:

1. Supabase → **Table Editor** → `schedule` → row `main` → edit `data` column.
2. Paste your full JSON (must include `slots`, `bookings`, `pending`).
3. Save.

Or run in SQL Editor (replace with your JSON, escaped):

```sql
update public.schedule
set data = '{"slots":{...},"bookings":{},"pending":[]}'::jsonb,
    updated_at = now()
where id = 'main';
```

---

## 7. Verify persistence after Render sleep

1. Add a lesson time on the teacher page.
2. Wait for Render to spin down (or trigger **Manual Deploy** → redeploy).
3. Open the student page again — slots should still appear.

---

## Troubleshooting

| Problem | What to check |
|--------|----------------|
| `/api/health` shows `"storage": "file"` | Env vars on Render; redeploy after adding them |
| Empty schedule after deploy | Row `main` missing → re-run `supabase/schema.sql` |
| "Could not load schedule" in logs | Wrong URL/key; key must be **service_role** |
| RLS errors | Re-run schema SQL; do not add public RLS policies |

---

## Fallback: Cloudflare R2

If Supabase does not work for you, the plan supports swapping storage to R2 (one `schedule.json` in a bucket). That is not implemented by default; ask to add it if needed.
