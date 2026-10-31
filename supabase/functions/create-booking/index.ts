import { allowRate, errorResponse, getAdminClient, isUuid, json, parseBody, preflight, verifyTurnstile } from '../_shared/http.ts';

const clean = (value: unknown, max: number): string => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const phoneRe = /^\+?[0-9 ()-]{8,24}$/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const timeRe = /^([01]\d|2[0-3]):(00|30)$/;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return errorResponse('Метод не поддерживается.', 405, 'method_not_allowed');
  const client = getAdminClient();
  if (!client) return errorResponse('Сервис записи ещё не настроен.', 503, 'booking_unavailable');
  if (!await allowRate(client, request, 5, 900)) return errorResponse('Слишком много попыток. Попробуйте через 15 минут.', 429, 'rate_limited');

  const body = await parseBody(request);
  if (!body || typeof body.website === 'string' && body.website.trim()) return errorResponse('Не удалось обработать запись.', 400, 'invalid_request');
  const firstName = clean(body.firstName, 80);
  const lastName = clean(body.lastName, 100);
  const phone = clean(body.phone, 24);
  const email = clean(body.email, 254).toLowerCase();
  const date = String(body.date || '');
  const time = String(body.time || '');
  if (!isUuid(body.serviceId) || !isUuid(body.barberId) || !isUuid(body.submissionId)
      || !firstName || !lastName || !phoneRe.test(phone) || !emailRe.test(email)
      || !dateRe.test(date) || !timeRe.test(time)) {
    return errorResponse('Проверьте введённые данные.', 400, 'invalid_fields');
  }
  const parsed = new Date(`${date}T12:00:00+06:00`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return errorResponse('Некорректная дата.', 400, 'invalid_date');
  if (!await verifyTurnstile(body.turnstileToken, request)) return errorResponse('Проверка от спама не пройдена или ещё не настроена.', 400, 'captcha_failed');

  // Bishkek uses UTC+06:00. The database rechecks the local schedule and slot atomically.
  const startsAt = new Date(`${date}T${time}:00+06:00`).toISOString();
  const { data, error } = await client.rpc('create_booking', {
    p_submission_id: body.submissionId,
    p_service_id: body.serviceId,
    p_barber_id: body.barberId,
    p_starts_at: startsAt,
    p_first_name: firstName,
    p_last_name: lastName,
    p_phone: phone,
    p_email: email
  });
  if (error) {
    if (error.code === '23P01' || error.message?.includes('slot_unavailable')) {
      return errorResponse('Это время уже заняли. Выберите другой свободный слот.', 409, 'slot_taken');
    }
    if (error.code === '22023') return errorResponse('Выбранная услуга, мастер или время больше недоступны.', 409, 'selection_unavailable');
    // Log only the database error code; never log request bodies or customer PII.
    console.error('booking_insert_failed', error.code || 'unknown');
    return errorResponse('Не удалось сохранить запись. Попробуйте ещё раз.', 500, 'booking_failed');
  }
  return json({ booking: data }, 201);
});
