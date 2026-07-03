# Xan's Eye Website

Rebuilt in Next.js with these routes:

- /
- /pricing
- /weddings
- /about-us
- /contact-me
- /restoring-project

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Contact Setup (No Form)

This site uses direct email contact (no web form) on /contact-me.

Spam-reduction approach:

- Display address in human-readable format: hello [at] xanseye [dot] com
- Provide a mailto button for convenience

If spam volume ever increases, add a form later with Cloudflare Turnstile.

## Recommended Hosting + Domain Setup

Recommended stack:

- Hosting: Vercel
- Domain registrar + DNS: Cloudflare Registrar + Cloudflare DNS

This gives fast deploys for Next.js and low-cost domain renewal.

## Step-by-Step Migration From GoDaddy

1. Keep GoDaddy hosting active during migration.
2. Push this repo to GitHub.
3. Import repo into Vercel and deploy.
4. In Vercel, add both domains: xanseye.com and www.xanseye.com.
5. Copy required DNS records shown by Vercel.
6. In GoDaddy DNS, update records to Vercel targets.
7. Wait for SSL to issue in Vercel, then verify both HTTPS URLs.
8. After stable traffic for 48-72 hours, cancel old GoDaddy hosting.

## Move Domain Registration From GoDaddy to Cloudflare

1. In GoDaddy, unlock xanseye.com.
2. Request EPP/Auth code from GoDaddy.
3. Ensure domain has been registered for at least 60 days.
4. In Cloudflare, start transfer and enter EPP code.
5. Approve transfer email.
6. Keep DNS records unchanged during transfer to avoid downtime.
7. After transfer completes, keep Cloudflare DNS pointing to Vercel.

## Production Checks

- Confirm all pages and navigation links work.
- Confirm the contact page shows the email address and opens an email draft correctly.
- Check mobile layout on iPhone + Android widths.
- Verify HTTPS on apex and www domains.
