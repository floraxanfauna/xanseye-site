# Xan's Eye — Mini Session Booking

A small Next.js app: public booking page (`/mini-sessions`), private client edit page (`/manage`), and an owner dashboard (`/admin`).

## What's real vs. what's demo
| Piece | Built | Verified how |
|---|---|---|
| Booking engine (slots, holds, double-booking protection, N/A intake, saves, cancel/reschedule) | yes | 50 automated tests, real Postgres engine |
| Page editor / availability editor / dashboard | yes | clicked through locally |
| Stripe Checkout + webhook | yes, **test it with your Stripe test keys** | signature verification tested; live Stripe NOT exercised |
| Google Calendar / Drive / Docs | yes, **not yet connected** | tested against a fake Google; real Google NOT exercised |
| Email (Resend) | yes, **not yet connected** | tested with a fake sender; locally messages go to Messages log, not delivered |

Until you connect them, the dashboard says so; nothing pretends to be synced.

## Run locally
```bash
npm install
cp .env.example .env.local   # then edit; ALLOW_DEV_LOGIN=1 and DEMO_SEED=1 are handy locally
npm run dev                  # http://localhost:3000
npm test                     # automated tests
```
Local data lives in `.data/` (a built-in Postgres). Production **requires** `DATABASE_URL`.

## Layout
- `src/lib/booking.ts` reservations, payment confirmation, intake saves, cancel/reschedule
- `src/lib/outbox.ts` durable job queue (emails, calendar, docs) with retries
- `src/lib/google/` Calendar, Drive/Docs, free/busy
- `migrations/` database schema (applies automatically at start)
- `SETUP.md` accounts, hosting, launch checklist, costs · `OWNER-GUIDE.md` day-to-day use
