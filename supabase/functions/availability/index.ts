import { allowRate, errorResponse, getAdminClient, json, parseBody, preflight } from '../_shared/http.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET' && request.method !== 'POST') return errorResponse('Метод не поддерживается.', 405, 'method_not_allowed');
  const client = getAdminClient();
  if (!client) return errorResponse('Сервис записи ещё не настроен.', 503, 'booking_unavailable');
  if (!await allowRate(client, request, 90, 600)) return errorResponse('Слишком много запросов. Попробуйте позже.', 429, 'rate_limited');

  if (request.method === 'GET') {
    const [servicesResult, barbersResult] = await Promise.all([
      client.from('services').select('id,slug,name,description,duration_minutes,price_kgs').eq('active', true).order('sort_order'),
      client.from('barbers').select('id,slug,display_name,bio,demo_profile').eq('active', true).order('created_at')
    ]);
    if (servicesResult.error || barbersResult.error) return errorResponse('Не удалось загрузить каталог.', 503, 'catalog_unavailable');
    return json({ services: servicesResult.data, barbers: barbersResult.data });
  }

  const body = await parseBody(request);
  if (!body || !UUID_RE.test(String(body.serviceId)) || !UUID_RE.test(String(body.barberId)) || !DATE_RE.test(String(body.date))) {
    return errorResponse('Проверьте выбранную услугу, мастера и дату.', 400, 'invalid_request');
  }
  const date = String(body.date);
  const parsedDate = new Date(`${date}T12:00:00+06:00`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return errorResponse('Некорректная дата.', 400, 'invalid_date');
  }
  const { data, error } = await client.rpc('get_available_slots', {
    p_barber_id: body.barberId, p_service_id: body.serviceId, p_service_date: date
  });
  if (error) return errorResponse('Не удалось загрузить свободное время.', 503, 'availability_unavailable');
  return json({ slots: data || [] });
});
