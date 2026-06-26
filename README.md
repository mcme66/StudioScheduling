# Lesson Scheduling

A self-hosted lesson booking app built on the PERN stack (PostgreSQL, Express, React, Node). Anyone can browse studios and instructor schedules; students sign up to book lessons (including optional recurring weekly spots). Instructors sign up to manage their availability, bookings, and weekly-spot requests. Everything runs on your own server via Docker Compose.

## Features

- **Studios** — the public homepage lists studios; each studio has its own instructors.
- Separate **teacher** and **student** login and registration flows.
- Email/password accounts with self-registration for both roles.
- Students browse a studio's instructors, view open times, and book a slot for a specific week (up to 2 weeks ahead).
- Recurring "weekly spot" requests that instructors approve or decline.
- Students can cancel their own bookings and view upcoming lessons + history.
- Booking confirmation and approval emails, plus automatic reminder emails before each lesson.
- Per-instructor share panel with a QR code and a copyable announcement of open times.

## Tech stack

- **Backend** (`/server`): Node 20, Express, `pg`, `bcryptjs`, `jsonwebtoken` (httpOnly cookie sessions), `zod` validation, `nodemailer`, `node-cron`, `node-pg-migrate`.
- **Frontend** (`/client`): React 18 + Vite, React Router, TanStack Query.
- **Database**: PostgreSQL 16.
- **Deploy**: Docker Compose (`db`, `api`, `web`).

## Project structure

```
server/        Express API + DB migrations + email/reminder services
client/        React (Vite) single-page app, served by nginx in production
docker-compose.yml
.env.example   Copy to .env and fill in
```

## App routes (frontend)

| Path | Access | Purpose |
|------|--------|---------|
| `/` | Public | Browse studios |
| `/studios/:slug` | Public | Instructors at a studio |
| `/studios/:slug/book/:teacherId` | Public to view; login to book | Instructor schedule |
| `/student/login`, `/student/register` | Public | Student account |
| `/teacher/login`, `/teacher/register` | Public | Teacher account |
| `/my-lessons` | Student | Upcoming and past bookings |
| `/teacher` | Teacher | Dashboard, slots, bookings |

## Quick start (Docker Compose)

Requires Docker and Docker Compose on the server.

```bash
git clone <your-repo-url>
cd "Lesson Scheduling"
cp .env.example .env
# Edit .env: set strong POSTGRES_PASSWORD, a long JWT_SECRET, your CLIENT_URL, and SMTP (optional).
nano .env

docker compose up -d --build
```

The site is served by the `web` container on `WEB_PORT` (default `8080`): open `http://YOUR_SERVER_IP:8080`.

On startup the `api` container runs database migrations automatically. Check health:

```bash
curl http://localhost:8080/api/health     # {"ok":true,"db":"up"}
```

### Seed demo data (optional)

```bash
docker compose exec api npm run seed
```

Demo logins after seeding:
- **Studio:** Island Style Dance Studio
- **Teacher:** `allen@example.com` / `password123`
- **Student:** `student@example.com` / `password123`

## Environment variables

See [`.env.example`](.env.example) for the full list. Key ones:

- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` and the matching `DATABASE_URL`.
- `JWT_SECRET` — long random string. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `COOKIE_SECURE=true` once you serve over HTTPS.
- `CLIENT_URL` — public URL of the site (used in emails / CORS).
- `WEB_PORT` — host port for the web container.
- `SMTP_*` — outgoing mail. If unset, emails are printed to the API logs (`docker compose logs api`) instead of being sent.

## Putting it behind a domain + HTTPS

The `web` container speaks plain HTTP on `WEB_PORT`. For a public domain with TLS, run a reverse proxy in front of it. Example with Caddy (automatic HTTPS):

```
lessons.example.com {
    reverse_proxy localhost:8080
}
```

Then set `CLIENT_URL=https://lessons.example.com` and `COOKIE_SECURE=true` in `.env` and `docker compose up -d`. (nginx + certbot works equally well if you prefer.)

## Run locally without Docker (Windows / macOS / Linux)

For quick local testing you can run the API and frontend directly with Node, using a locally-installed PostgreSQL. Convenience scripts live in the root [`package.json`](package.json) and work in PowerShell, Command Prompt, or a Unix shell.

### 1. Install prerequisites

- **Node.js 20+** (you have it if `node --version` works).
- **PostgreSQL** running locally. On Windows, the easiest is the [EDB installer](https://www.postgresql.org/download/windows/); during setup note the password you give the `postgres` user. Make sure the PostgreSQL service is running afterward (check "Services" in Windows).

### 2. Create the database

Create an empty database named `lessons` (the tables are created automatically by the migration step). Using the bundled `psql` shell:

```bash
psql -U postgres -c "CREATE DATABASE lessons;"
```

(Or use pgAdmin: right-click Databases -> Create -> Database -> name it `lessons`.)

### 3. Configure the API environment

Copy the local example env file and edit the connection string to match your PostgreSQL user/password:

```bash
copy server\.env.example server\.env      # PowerShell / cmd
# (on macOS/Linux: cp server/.env.example server/.env)
```

Open [`server/.env`](server/.env.example) and set `DATABASE_URL`, e.g. if your `postgres` password is `secret`:

```
DATABASE_URL=postgres://postgres:secret@localhost:5432/lessons
```

This file is git-ignored and is separate from the root `.env` (which is only for Docker).

### 4. Install dependencies, migrate, and seed

Run these from the project root:

```bash
npm install        # installs the root tooling (concurrently)
npm run setup      # installs server + client dependencies
npm run migrate    # creates all tables in the lessons database
npm run seed       # optional: demo studio, teacher, student, and slots
```

Demo logins after seeding:
- **Studio:** Island Style Dance Studio (`/studios/island-style-dance-studio`)
- **Teacher:** `allen@example.com` / `password123`
- **Student:** `student@example.com` / `password123`

### 5. Start the app

```bash
npm run dev
```

This launches both servers together:
- **API** on http://localhost:4000
- **Web app** on **http://localhost:5173** <- open this in your browser

The Vite dev server proxies `/api` to the API, so logins/cookies work on a single origin. Press `Ctrl+C` once to stop both.

### Available root scripts

- `npm run dev` - run API + frontend together (Vite at :5173, API at :4000).
- `npm run dev:server` / `npm run dev:client` - run just one side.
- `npm run setup` - install dependencies for both `server` and `client`.
- `npm run migrate` - apply database migrations.
- `npm run seed` - insert demo data (studio, teacher, student, slots).
- `npm run build` - production build of the frontend.

### Troubleshooting

- **`The $DATABASE_URL environment variable is not set` / connection errors** - check `server/.env` exists and `DATABASE_URL` is correct, and that the PostgreSQL service is running.
- **`database "lessons" does not exist`** - run step 2 to create it.
- **Port 5432 already in use / blocked** - another PostgreSQL (or a reserved Windows port range) is using it. Point `DATABASE_URL` at the correct port or free it up.
- **Emails** - with `SMTP_*` left blank, confirmation/reminder emails are printed to the API console instead of being sent.

## Database schema

- `studios` — dance studios / locations (`name`, `slug`, `description`).
- `teacher_studios` — links each teacher to one studio at a time.
- `teachers` / `students` — accounts (email + bcrypt hash + profile).
- `slots` — a teacher's weekly availability template (weekday, start time, duration, price).
- `recurring_assignments` — weekly-spot requests/holders (`pending` / `approved` / `declined`).
- `bookings` — one-off lessons for a specific date (`booked` / `cancelled`), with `reminder_sent_at`.

A slot is "taken" for a given week if it has an approved recurring assignment or a `booked` booking whose date falls in that week. Unique constraints prevent double-booking and more than one approved weekly student per slot.

## Common operations

```bash
docker compose logs -f api          # tail API logs (and console emails)
docker compose exec db psql -U lessons -d lessons   # open a SQL shell
docker compose down                 # stop (keeps the pgdata volume)
docker compose down -v              # stop and delete the database volume
```
