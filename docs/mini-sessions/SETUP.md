# Setup & launch checklist

Everything below needs *your* accounts. Never paste secrets into chat; put them in your host's environment settings.

## 1. Hosting: it lives inside xanseye.com (Vercel)
The booking pages are part of this same website project, so they appear at **https://xanseye.com/mini-sessions** with no extra hosting. Your existing pages are untouched.
1. **Database (required):** Vercel dashboard → your project → Storage → add **Neon Postgres** (free tier is fine). It sets `DATABASE_URL` for you. Tables are created automatically.
2. **Environment variables** (Vercel → Settings → Environment Variables; see `.env.mini-sessions.example`): `APP_URL=https://xanseye.com`, `TOKEN_ENC_KEY` (`openssl rand -base64 32`), `CRON_SECRET` (any long random string), `OWNER_EMAILS=xanflorafauna@gmail.com`. For the first deploy also `DEMO_SEED=1` (remove after the first visit). **Never** set `ALLOW_DEV_LOGIN` in Vercel.
3. **Background worker:** Vercel has no always-on server, and its free plan only allows daily cron jobs. Reminders and expired-hold cleanup need to run about every minute, so use a free pinger (cron-job.org): `POST https://xanseye.com/api/jobs/run` with header `Authorization: Bearer <CRON_SECRET>`, every 1 minute. (Vercel Pro can do this with `vercel.json` crons instead.) Emails after a booking or a form save go out immediately without it; the pinger is the safety net and does reminders.
4. Deploy by merging the `add-mini-sessions` branch into `main` (Vercel deploys automatically). Share `https://xanseye.com/mini-sessions` (always the newest published season); `/s/<season-slug>` links to a specific one.
If `DATABASE_URL` is missing, only the booking pages show an error; the rest of the site is unaffected.

## 2. Google (calendar, Docs, sign-in)
1. console.cloud.google.com → new project → enable **Google Calendar API**, **Google Drive API**, **Google Docs API**.
2. OAuth consent screen: External, add yourself as a test user. **While "Testing", Google expires refresh tokens after 7 days**, so click **Publish app** (to "In production") before launch. The sensitive scopes may need Google's verification for public use, but a single-owner app can run unverified with a one-time warning screen.
3. Credentials → OAuth client ID → Web application. Redirect URI: `https://xanseye.com/api/auth/google/callback`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Sign in at `/admin`, then Settings → **Connect Google**. The dashboard warns you if access is ever revoked.
Scopes requested: app-created calendar only, calendar list + free/busy (read), `drive.file` (only files this app creates). The app cannot read your other Drive files.
Docs land in: `Mini Photo Sessions / YYYY / YYYY-MM-DD - Season / Name - XE-REF / Session Brief`.

## 3. Stripe
Create account → test mode keys → set `STRIPE_SECRET_KEY`. Add webhook endpoint `https://xanseye.com/api/stripe/webhook` for events `checkout.session.completed`, `checkout.session.expired`; copy signing secret to `STRIPE_WEBHOOK_SECRET`. Run a test booking with card 4242 4242 4242 4242, then switch to live keys. Refunds are done in the Stripe dashboard (the app flags them for you).

## 4. Email (easiest: send from your own Gmail)
In Google Cloud, enable the **Gmail API** for the same project, then in the dashboard go to Settings → Google → **Reconnect Google** and allow "send email on your behalf". Booking emails then go out from xanflorafauna@gmail.com (send-only permission; the app cannot read your mail). While the site is in demo mode, only YOU are emailed; clients are never contacted.

### Alternative: Resend
Resend (or similar): verify your sending domain, set `RESEND_API_KEY` and `EMAIL_FROM` (an address on that domain). Notifications go to `xanflorafauna@gmail.com`; replies go to `EMAIL_REPLY_TO`.

## 5. Apple Calendar
Add the Google account to iPhone/Mac Calendar (Settings → Calendar → Accounts → Google). Bookings appear in "Xan's Eye — Mini Sessions". This is Google's calendar shown in Apple Calendar, not an iCloud calendar, and can lag a few minutes. iCloud-only events can't block times automatically.

## 6. Launch checklist
- [ ] Page editor: real price, length, location, deliverables, turnaround, deposit policy, cancel/refund terms, reschedule cutoff, booking terms; tick "real values"
- [ ] Stripe test booking end to end, then live keys
- [ ] Google connected; test booking appears on calendar + Doc in right folder
- [ ] Email sent to you and to a test client
- [ ] Reschedule and cancel a test booking; change a form and confirm the email
- [ ] Settings → **Go live**
- [ ] Backups: your database host's automatic backups + Settings → Download a backup monthly

## Costs (approximate, check current pricing)
Hosting: already included in your Vercel plan · Postgres (Neon) free–$20/mo · optional pinger free · Email free tier (≈3,000/mo) · Domain ≈$12/yr · Stripe ≈2.9% + 30¢ per payment (**≈ 45¢ on a $5 deposit**, so you keep ≈ $4.55) · Google free · SMS not included.

## Privacy & retention
Abandoned unpaid holds expire automatically. Delete a client's personal data from their session page ("Erase personal data"); money records are kept for bookkeeping. Export everything from Settings.
