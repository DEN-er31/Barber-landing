import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, booking, adminHtml, admin, sql, manualMigration, emailValidationMigration, manualTest, availability, createBooking, config, bookingCss, adminCss, styles, sharedHttp] = await Promise.all([
  readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../dist/booking.js', import.meta.url), 'utf8'),
  readFile(new URL('../dist/admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../dist/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/202610310001_booking_system.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20261101103240_admin_manual_bookings.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20261101103329_admin_manual_booking_email_validation.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/tests/manual_booking.test.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/availability/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/create-booking/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../dist/booking-config.js', import.meta.url), 'utf8'),
  readFile(new URL('../dist/booking.css', import.meta.url), 'utf8'),
  readFile(new URL('../dist/admin.css', import.meta.url), 'utf8'),
  readFile(new URL('../dist/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/_shared/http.ts', import.meta.url), 'utf8')
]);

test('all booking CTAs open the same accessible six-step dialog', () => {
  assert.ok((html.match(/js-booking-trigger/g) || []).length >= 4);
  assert.match(html, /booking\.js\?v=7/);
  assert.match(html, /<dialog class="booking-dialog"/);
  for (let i = 1; i <= 6; i++) assert.match(html, new RegExp(`data-step="${i}"`));
  for (const field of ['firstName', 'lastName', 'phone', 'email']) assert.match(html, new RegExp(`name="${field}"`));
  assert.match(booking, /customerInputs\.forEach\(input => input\.addEventListener\('input', updateCustomerNextButton\)\)/);
  assert.match(booking, /customerNext\.disabled = customerInputs\.some\(input => !input\.checkValidity\(\)\)/);
});

test('booking page contains only demonstration staff and expected service prices', () => {
  for (const name of ['Тимур Исмаилов', 'Арсен Муратов', 'Бек Садыков']) assert.ok(booking.includes(name));
  for (const price of ['1200', '700', '1700']) assert.ok(booking.includes(price));
  assert.match(booking, /ДЕМО-ПРОФИЛЬ/);
  assert.match(sql, /Демонстрационный профиль мастера/);
  assert.doesNotMatch(sql, /insert into public\.appointments/i);
});

test('customer data is protected and conflicting appointments are rejected in Postgres', () => {
  assert.match(sql, /alter table public\.appointments enable row level security/i);
  assert.match(sql, /revoke all on public\.services[\s\S]*from anon, authenticated/i);
  assert.match(sql, /appointments_no_overlapping_active_bookings[\s\S]*exclude using gist/i);
  assert.match(sql, /public\.is_booking_admin\(\)/i);
  assert.match(sql, /public\.create_booking\(/i);
  assert.match(createBooking, /verifyTurnstile/);
  assert.match(createBooking, /allowRate/);
  assert.match(availability, /get_available_slots/);
});

test('public API rate limits are isolated by Edge Function endpoint', () => {
  assert.match(sharedHttp, /const endpoint = new URL\(request\.url\)\.pathname/);
  assert.match(sharedHttp, /blackwood-rate-limit-v2:\$\{endpoint\}:\$\{pepper\}:\$\{forwarded\}/);
});

test('Turnstile verifies only the configured or canonical production hostname', () => {
  assert.match(sharedHttp, /TURNSTILE_ALLOWED_HOSTNAMES/);
  assert.match(sharedHttp, /blackwood-barbershop\.rustycurl\.chatgpt\.site/);
  assert.match(sharedHttp, /expected\.includes\(String\(result\.hostname \|\| ''\)\.toLowerCase\(\)\)/);
});

test('administrator UI has no sign-up and handles booking and schedule management', () => {
  assert.match(adminHtml, /admin-login-form/);
  assert.match(adminHtml, /metric-today/);
  assert.match(adminHtml, /calendar-grid/);
  assert.match(adminHtml, /calendar-barber-filter/);
  assert.match(adminHtml, /start_date/);
  assert.match(adminHtml, /service-form/);
  assert.match(admin, /signInWithPassword/);
  assert.match(admin, /auth\.getUser\(\)/);
  assert.match(admin, /app_metadata\?\.role === 'booking_admin'/);
  assert.doesNotMatch(admin, /signUp\(/);
  assert.match(admin, /appointments/);
  assert.match(admin, /weekly_schedule/);
  assert.match(admin, /schedule_overrides/);
  assert.match(admin, /barbers/);
  assert.match(admin, /services/);
  assert.match(admin, /data-cancel-appointment/);
  assert.match(admin, /customer_phone/);
  assert.match(admin, /IntersectionObserver/);
  assert.match(admin, /booking-search/);
  assert.match(admin, /booking-status-filter/);
  assert.doesNotMatch(admin, /window\.prompt/);
  assert.match(adminHtml, /data-admin-section="settings"/);
  assert.match(adminHtml, /id="admin-mobile-nav-toggle"/);
  assert.match(adminCss, /@media\s*\(max-width:820px\)/);
  assert.match(adminCss, /prefers-reduced-motion/);
  assert.match(sql, /auth\.jwt\(\) -> 'app_metadata' ->> 'role'/);
  assert.match(sql, /create policy "booking admins manage appointments"[\s\S]*using \(public\.is_booking_admin\(\)\) with check \(public\.is_booking_admin\(\)\)/i);
  assert.match(sql, /create policy "booking admins manage services"[\s\S]*using \(public\.is_booking_admin\(\)\) with check \(public\.is_booking_admin\(\)\)/i);
  assert.doesNotMatch(sql, /raw_user_meta_data|user_metadata/i);
});

test('admin manual bookings use shared availability, protected RPC and the existing appointment table', () => {
  assert.match(adminHtml, /id="new-appointment"[^>]*>\+ Новая запись/);
  for (const field of ['first_name', 'last_name', 'phone', 'email', 'service_id', 'barber_id', 'service_date', 'starts_at', 'admin_note']) {
    assert.match(adminHtml, new RegExp(`name="${field}"`));
  }
  assert.match(admin, /functions\/v1\/availability/);
  assert.match(admin, /rpc\('admin_create_booking'/);
  assert.match(admin, /Время уже занято и исключено из публичных слотов/);
  assert.match(admin, /Добавлена администратором/);
  assert.match(admin, /Через сайт/);
  assert.match(manualMigration, /alter table public\.appointments/i);
  assert.match(manualMigration, /security invoker/i);
  assert.match(manualMigration, /public\.is_booking_admin\(\)/i);
  assert.match(sql, /appointments_no_overlapping_active_bookings[\s\S]*exclude using gist/i);
  assert.match(manualMigration, /source, admin_note/i);
  assert.match(manualMigration, /revoke all on function public\.admin_create_booking[\s\S]*from public, anon/i);
  assert.match(emailValidationMigration, /\[\.\]\[A-Z\]\{2,\}/);
  assert.match(manualTest, /same public availability RPC hides the interval/i);
  assert.match(adminCss, /manual-booking-dialog/);
  assert.match(adminCss, /@media\s*\(max-width:600px\)[\s\S]*manual-booking-fields/);
});

test('public config has no secret key and the design adapts to phones', () => {
  assert.match(config, /url: "https:\/\/oewuzjvygupjdsyxsfio\.supabase\.co"/);
  assert.match(config, /publishableKey: "sb_publishable_[A-Za-z0-9_-]+"/);
  assert.doesNotMatch(config, /service_role|secretKey|sb_secret_/i);
  assert.match(bookingCss, /@media\(max-width:550px\)/);
  assert.match(styles, /@media\(max-width:700px\)/);
});
