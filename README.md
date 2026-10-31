# BLACKWOOD booking system

This repository remains a buildless static site. The booking interface is under `dist/`; Supabase database and Edge Function source lives under `supabase/`. No service-role key, project URL, customer booking, or real staff record is included in this repository.

## Configure an existing Supabase project

1. In Supabase Dashboard, open **SQL Editor** and run `supabase/migrations/202610310001_booking_system.sql`. The migration seeds three explicitly marked demo barbers, their 10:00–22:00 Bishkek weekly schedules, and the three requested services. It creates no bookings.
2. Set these Edge Function secrets in **Project Settings → Edge Functions → Secrets** (or with `supabase secrets set`):
   - `RATE_LIMIT_PEPPER`: a newly generated random secret of at least 32 characters.
   - `TURNSTILE_SECRET_KEY`: the secret from your Cloudflare Turnstile widget.
   - `TURNSTILE_ALLOWED_HOSTNAMES`: comma-separated allowed production hostnames, without protocol, for example your actual Sites hostname and custom domain.
   Supabase injects `SUPABASE_URL` and its secret-key map into Edge Functions. The functions accept the legacy `SUPABASE_SERVICE_ROLE_KEY` environment variable as a fallback. Do not put a secret key in `dist/`.
3. From this project directory, use the Supabase CLI authenticated to the existing project, then deploy the two functions:

   ```sh
   supabase link --project-ref <your-existing-project-ref>
   supabase functions deploy availability
   supabase functions deploy create-booking
   ```

   `supabase/config.toml` disables gateway JWT verification only for these public endpoints. They still validate each request, use server-only database credentials, enforce rate limits, and require verified Turnstile before creating a booking.
4. In `dist/booking-config.js`, set the existing project's HTTPS URL, its browser-safe publishable key (or legacy anon key), and the Turnstile **site key**. A publishable/anon key is intended for browser use; never paste the secret/service-role key here.
5. In Supabase Auth, create an administrator user. Assign `app_metadata.role = "booking_admin"` through the Dashboard or a trusted admin-only server tool. Do not use editable `user_metadata` for this role. Open `/admin.html` and sign in. There is no customer sign-up flow.
6. Replace or edit the demonstration barber profiles and verify their weekly schedules and date overrides in the admin panel before accepting real bookings.
7. Deploy the updated `dist/` directory to the existing website host and set the existing Site audience to public. This turn does not push to GitHub or publish the website.

## Security and booking behavior

- Public visitors can request the service/barber catalog and available time slots, but cannot query appointment rows.
- Customer PII is protected by table grants plus RLS. Authenticated admins with the immutable `app_metadata` role can manage records. Public booking calls go through Edge Functions.
- The database recomputes service duration, validates the local schedule in `Asia/Bishkek`, checks date overrides, and rejects unavailable slots. A PostgreSQL exclusion constraint prevents overlapping active reservations per barber under concurrent requests. A submission UUID supports safe retries.
- Both public endpoints use IP-hash rate limiting. Booking creation also verifies a Turnstile token and uses a hidden honeypot field. The server logs only database error codes, not request bodies or customer details.
- The confirmation screen is shown only after the insert succeeds. Email is collected for the booking record but no email notification is sent.
- The three names and schedules in the migration are demonstrations, not real staff or availability claims. There are no seeded customer records.

## Local preview

Serve the `dist/` folder with any static HTTP server and open `/` or `/admin.html`. Without the real Supabase URL, publishable key, deployed Edge Functions, CAPTCHA keys, and admin role, the public flow deliberately stops before requesting slots or saving a booking.

## Checks

Run the static acceptance checks with:

```sh
node --test tests/booking-static.test.mjs
```

Database tests can be run after configuring a local Supabase stack with the Supabase CLI:

```sh
supabase start
supabase db reset
supabase test db
```
