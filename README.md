# BLACKWOOD booking system

This repository remains a buildless static site. The booking interface is under `dist/`; Supabase database and Edge Function source lives under `supabase/`. It contains a browser-safe Supabase publishable key, but no secret/service-role key or real staff record.

## Connected Supabase project

The existing project `oewuzjvygupjdsyxsfio` is connected. The database has three active services, three demonstration barber profiles, 21 demo weekly schedule rows, and one cancelled QA booking from an end-to-end integration check. Demonstration staff/schedules are not confirmed real availability.

The browser URL and publishable key are configured in `dist/booking-config.js`. Secret keys are never placed in browser code.

## Operational setup

1. Revoke/rotate the Supabase secret key that was pasted into chat. Use Supabase Dashboard → **Project Settings → API Keys**. The key must never be saved in this repository or sent in chat. Supabase injects its server-only secret-key map into Edge Functions; the functions use that runtime value, with the legacy service-role variable as a fallback.
2. Cloudflare Turnstile uses the public site key in `dist/booking-config.js` and the server-only `TURNSTILE_SECRET_KEY` in Supabase Edge Function secrets. The deployed function allowlists `blackwood-barbershop.rustycurl.chatgpt.site` by default; set `TURNSTILE_ALLOWED_HOSTNAMES` only when changing or adding the production hostname. `RATE_LIMIT_PEPPER` may be set to an independently generated secret; otherwise the function derives a namespaced rate-limit key from Supabase's server-only project secret.
3. In Supabase Auth, create an administrator user. Assign `app_metadata.role = "booking_admin"` through the Dashboard or a trusted admin-only server tool. Do not use editable `user_metadata` for this role. Open `/admin.html` and sign in. There is no customer sign-up flow.
4. Replace or edit the demonstration barber profiles and verify their weekly schedules and date overrides in the admin panel before accepting real bookings.
5. Apply the new SQL migration before deploying its corresponding admin UI files. Static changes under `dist/` require a separate website deployment.

## Admin panel

Open `/admin.html` to sign in with a Supabase Auth user whose server-managed `app_metadata.role` is `booking_admin`. The panel provides today's confirmed booking count, upcoming visits, a monthly calendar filtered by barber, appointment contact details and cancellation, weekly schedules, date-range leave/holiday overrides, service price/duration editing, and manual appointment creation. Manual bookings use the existing `appointments` table and public availability function; each is tagged as administrator-created and becomes unavailable to public booking. Every data request still passes through PostgreSQL RLS; checking the role in the browser is only an additional UI gate. Do not assign the role through `user_metadata` or expose any service-role key in the browser.

## Security and booking behavior

- Public visitors can request the service/barber catalog and available time slots, but cannot query appointment rows.
- Manual admin appointments are created with the authenticated `admin_create_booking` RPC. It validates `booking_admin` app metadata, service, active barber, date, local schedule and free slot; the existing exclusion constraint remains the final defense against concurrent conflicts.
- `source` defaults to `website` for public appointments and is `admin` for manual bookings. Manual bookings may omit customer email and may include an internal admin note.
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

The database tests can be run locally with the Supabase CLI after migrations are applied:

```sh
supabase start
supabase db reset
supabase test db
```
