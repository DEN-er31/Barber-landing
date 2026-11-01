import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, booking, adminHtml, admin, sql, availability, createBooking, config, bookingCss, styles] = await Promise.all([
  readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../dist/booking.js', import.meta.url), 'utf8'),
  readFile(new URL('../dist/admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../dist/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/202610310001_booking_system.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/availability/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/create-booking/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../dist/booking-config.js', import.meta.url), 'utf8'),
  readFile(new URL('../dist/booking.css', import.meta.url), 'utf8'),
  readFile(new URL('../dist/styles.css', import.meta.url), 'utf8')
]);

test('all booking CTAs open the same accessible six-step dialog', () => {
  assert.ok((html.match(/js-booking-trigger/g) || []).length >= 4);
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

test('administrator UI has no sign-up and handles booking and schedule management', () => {
  assert.match(adminHtml, /admin-login-form/);
  assert.match(admin, /signInWithPassword/);
  assert.doesNotMatch(admin, /signUp\(/);
  assert.match(admin, /appointments/);
  assert.match(admin, /weekly_schedule/);
  assert.match(admin, /schedule_overrides/);
  assert.match(admin, /barbers/);
});

test('public config has no secret key and the design adapts to phones', () => {
  assert.match(config, /url: "https:\/\/oewuzjvygupjdsyxsfio\.supabase\.co"/);
  assert.match(config, /publishableKey: "sb_publishable_[A-Za-z0-9_-]+"/);
  assert.doesNotMatch(config, /service_role|secretKey|sb_secret_/i);
  assert.match(bookingCss, /@media\(max-width:550px\)/);
  assert.match(styles, /@media\(max-width:700px\)/);
});
