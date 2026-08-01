# Lesson Scheduling

A self-hosted lesson booking app on the PERN stack (PostgreSQL, Express, React, Node). Anyone can browse studios and instructor schedules. Students book one-off lessons or request weekly spots; teachers manage availability, bookings, and requests. Deploy with Docker Compose, or run locally with Node + PostgreSQL.

## Features

- **Studios** — public homepage lists studios; each studio shows its instructors.
- Separate **teacher** and **student** accounts (login / register / forgot password).
- Students book a slot for a specific week (up to 2 weeks ahead), cancel their own lessons, and manage upcoming + past bookings.
- **Weekly spots** — students request a recurring time; teachers approve or decline.
- **Parent accounts** — a student can mark themselves as a parent, list children, and book under a child’s name (contact stays on the parent account).
- **Teachers as students** — teachers can enable “Student as well?” on their profile to book on *other* instructors’ schedules (not their own).
- **Slot series** — teachers create one-time slots or weekly series (count, until a date, or forever), and can end a series from a given week forward.
- **Payments** — optional per-teacher payment tracking on bookings.
- **Inactive listing** — new teachers start inactive; the Active toggle controls whether they appear on the studio page.
- **Calendar** — add lessons to Google Calendar / download `.ics` from My Lessons and confirmation emails.
- Confirmation, approval, and reminder emails (or console-logged when SMTP is unset).
- Per-instructor share panel with QR code and copyable open-times announcement.

## Tech stack

- **Backend** (`server/`): Node 20, Express, `pg`, `bcryptjs`, JWT httpOnly cookies, `zod`, `nodemailer`, `node-cron`, `node-pg-migrate`
- **Frontend** (`client/`): React 18 + Vite, React Router, TanStack Query
- **Database**: PostgreSQL 16
- **Deploy**: Docker Compose (`db`, `api`, `web`)

## Project structure

```
server/              Express API, migrations, email/reminders, seed script
client/              React (Vite) SPA (nginx in production)
docker-compose.yml
.env.example         Root env for Docker — copy to .env
server/.env.example  Local API env — copy to server/.env
```

## App routes

| Path | Access | Purpose |
|------|--------|---------|
| `/` | Public | Browse studios |
| `/studios/:slug` | Public | Instructors at a studio |
| `/studios/:slug/book/:teacherId` | Public to view; login to book | Instructor schedule |
| `/student/login`, `/student/register` | Public | Student auth |
| `/teacher/login`, `/teacher/register` | Public | Teacher auth |
| `/my-lessons` | Student (or teacher with “Student as well?”) | Bookings & weekly spots |
| `/teacher` | Teacher | Dashboard: slots, bookings, weekly requests |
| `/profile` | Signed-in user | Profile, parent toggle, teacher settings |

## Quick start (Docker Compose)

Requires Docker and Docker Compose.

```bash
git clone <your-repo-url>
cd StudioScheduling
cp .env.example .env
# Set strong POSTGRES_PASSWORD, JWT_SECRET, CLIENT_URL, and optional SMTP_*
docker compose up -d --build
```

Open `http://YOUR_SERVER_IP:8080` (or whatever you set for `WEB_PORT`). Migrations run on API startup.

```bash
curl http://localhost:8080/api/health   # {"ok":true,"db":"up"}
docker compose exec api npm run seed    # optional demo data
```

## Demo accounts (after seed)

All demo passwords are **`password123`**. Re-running `npm run seed` is safe (upserts).

### Studios

| Studio | URL path |
|--------|----------|
| Island Style Dance Studio | `/studios/island-style-dance-studio` |
| Rhythm Room | `/studios/rhythm-room` |

### Teachers

| Email | Name | Studio | Notes |
|-------|------|--------|--------|
| `allen@example.com` | Allen | Island Style | Payment tracking on; forever weekly slots, a 6-week Wed 6pm series, and a one-time Thu slot |
| `maria@example.com` | Maria Chen | Rhythm Room | Ballet/contemporary; no payment tracking |
| `hidden@example.com` | Hidden Instructor | Island Style | **Inactive** — not listed on the studio page (tests the Active toggle) |

### Students

| Email | Name | Notes |
|-------|------|--------|
| `student@example.com` | Jane Student | Approved weekly Fri 3pm with Allen; also booked on the one-time Thu slot |
| `parent@example.com` | Sam Metler | Parent account — children **Alina** and **Ian**; sample child bookings on Allen’s schedule |
| `alex@example.com` | Alex Rivera | Pending weekly request Wed 4pm + a one-off on that slot (good for the teacher dashboard) |

### What else the seed loads

- Forever weekly template slots for Allen (Mon–Fri afternoon times) and Maria
- A finite **6-week Wednesday 6pm** series for Allen
- A **one-time Thursday** afternoon slot for Allen
- Parent child bookings, an approved weekly holder, and a pending weekly request so dashboards aren’t empty

## Environment variables

See [`.env.example`](.env.example) (Docker) and [`server/.env.example`](server/.env.example) (local). Important ones:

| Variable | Purpose |
|----------|---------|
| `POSTGRES_*` / `DATABASE_URL` | Database connection |
| `JWT_SECRET` | Long random secret — e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `COOKIE_SECURE` | Set `true` when serving over HTTPS |
| `CLIENT_URL` | Public site URL (emails / CORS) |
| `WEB_PORT` | Host port for the web container (default `8080`) |
| `SMTP_*` | Outgoing mail; if unset, emails print to the API logs |

## HTTPS / domain

The `web` container serves plain HTTP. Put a reverse proxy in front for TLS. Example with Caddy:

```
lessons.example.com {
    reverse_proxy localhost:8080
}
```

Then set `CLIENT_URL=https://lessons.example.com` and `COOKIE_SECURE=true`, and recreate: `docker compose up -d`.

## Run locally without Docker

### 1. Prerequisites

- **Node.js 20+**
- **PostgreSQL** running locally ([Windows installer](https://www.postgresql.org/download/windows/) works well)

### 2. Create the database

```bash
psql -U postgres -c "CREATE DATABASE lessons;"
```

(Or create a database named `lessons` in pgAdmin.)

### 3. Configure the API

```bash
# Windows
copy server\.env.example server\.env

# macOS / Linux
cp server/.env.example server/.env
```

Set `DATABASE_URL` in `server/.env`, for example:

```
DATABASE_URL=postgres://postgres:secret@localhost:5432/lessons
```

This file is git-ignored and separate from the root `.env` used by Docker.

### 4. Install, migrate, seed

From the project root:

```bash
npm install
npm run setup
npm run migrate
npm run seed      # optional — see Demo accounts above
```

### 5. Start

```bash
npm run dev
```

- **Web:** http://localhost:5173
- **API:** http://localhost:4000

Vite proxies `/api` to the API so auth cookies work on one origin. `Ctrl+C` stops both.

### Root scripts

| Script | What it does |
|--------|----------------|
| `npm run dev` | API + frontend together |
| `npm run dev:server` / `dev:client` | One side only |
| `npm run setup` | Install `server` + `client` deps |
| `npm run migrate` | Apply DB migrations |
| `npm run seed` | Upsert demo studios, users, slots, bookings |
| `npm run reset` | Drop/recreate schema tables via migrate reset + up *(local)* |
| `npm run build` | Production frontend build |

### Troubleshooting

- **`DATABASE_URL` / connection errors** — confirm `server/.env` exists, the URL is right, and PostgreSQL is running.
- **`database "lessons" does not exist`** — create it (step 2).
- **Port 5432 busy** — point `DATABASE_URL` at the correct port or stop the other Postgres instance.
- **Emails** — with SMTP blank, messages appear in the API console (`docker compose logs api` or the `dev:server` terminal).

## Database overview

- `studios` — locations (`name`, `slug`, `description`)
- `teacher_studios` — teacher ↔ studio (one studio at a time in the UI)
- `teachers` / `students` — accounts; teachers may set `can_book_as_student` and link to a student row by email for booking FKs
- `students.is_parent` / `children_names` — parent booking
- `slots` — availability (weekday/time, optional one-off date, series start/end)
- `recurring_assignments` — weekly-spot requests (`pending` / `approved` / `declined` / …)
- `bookings` — dated lessons (`booked` / `cancelled`), optional `child_name`, reminders

A slot is taken for a week if it has an approved weekly holder (unless that week is skipped) or a booked lesson on that date. Overlap rules for weekly series are enforced in the API.

## Common Docker ops

```bash
docker compose logs -f api
docker compose exec db psql -U lessons -d lessons
docker compose down          # keep database volume
docker compose down -v       # wipe database volume
```
