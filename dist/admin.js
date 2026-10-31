(() => {
  const cfg = window.BLACKWOOD_SUPABASE_CONFIG || {};
  const loginBox = document.querySelector('#admin-login');
  const panel = document.querySelector('#admin-panel');
  const loginMessage = document.querySelector('#admin-login-message');
  const message = document.querySelector('#admin-message');
  const authForm = document.querySelector('#admin-login-form');
  const ready = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.url || '') && (cfg.publishableKey || '').length > 20 && window.supabase?.createClient;
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  let client = null;
  let barbers = [];
  let services = [];
  const weekdayNames = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  function notify(target, text) { target.textContent = text; }
  function authError(error) {
    const text = error?.message || '';
    return /permission|row level|policy/i.test(text) ? 'Доступ запрещён. Назначьте пользователю роль booking_admin в app_metadata.' : 'Не удалось выполнить действие. Проверьте права администратора и соединение.';
  }
  function updateBarberSelects() {
    const options = barbers.map(b => `<option value="${escapeHTML(b.id)}">${escapeHTML(b.display_name)}${b.active ? '' : ' · неактивен'}</option>`).join('');
    document.querySelectorAll('select[name="barber_id"]').forEach(select => { select.innerHTML = options; });
  }
  async function loadAdminData() {
    notify(message, 'Загружаем данные…');
    const [barberResult, serviceResult, appointmentResult] = await Promise.all([
      client.from('barbers').select('*').order('created_at'),
      client.from('services').select('*').order('sort_order'),
      client.from('appointments').select('*').order('starts_at', { ascending: true })
    ]);
    const error = barberResult.error || serviceResult.error || appointmentResult.error;
    if (error) { notify(message, authError(error)); return; }
    barbers = barberResult.data || []; services = serviceResult.data || [];
    updateBarberSelects(); renderBarbers(); renderAppointments(appointmentResult.data || []);
    notify(message, 'Данные загружены. Клиентские контакты видны только этой защищённой панели.');
  }
  function renderBarbers() {
    const root = document.querySelector('#barbers-list');
    if (!barbers.length) { root.innerHTML = '<p class="empty-admin">Пока нет специалистов.</p>'; return; }
    root.innerHTML = barbers.map(b => `<div class="barber-admin-row ${b.active ? '' : 'inactive'}"><div>${escapeHTML(b.display_name)}<small>${b.demo_profile ? 'Демо-профиль · замените реальным специалистом' : escapeHTML(b.bio || 'Специалист')}</small></div><div class="admin-action-row"><button class="admin-small-button" data-edit-barber="${escapeHTML(b.id)}">Изменить имя</button><button class="admin-small-button" data-toggle-barber="${escapeHTML(b.id)}" data-active="${b.active}">${b.active ? 'Приостановить' : 'Активировать'}</button></div></div>`).join('');
  }
  function formatVisit(value) {
    const date = new Date(value);
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }
  function renderAppointments(rows) {
    const root = document.querySelector('#appointments-body');
    if (!rows.length) { root.innerHTML = '<tr><td class="empty-admin" colspan="5">Бронирований пока нет.</td></tr>'; return; }
    const barberById = Object.fromEntries(barbers.map(b => [b.id, b.display_name]));
    const serviceById = Object.fromEntries(services.map(s => [s.id, s.name]));
    root.innerHTML = rows.map(a => `<tr><td>${escapeHTML(formatVisit(a.starts_at))}<span class="client-meta">${escapeHTML(a.booking_code)}</span></td><td>${escapeHTML(a.customer_first_name)} ${escapeHTML(a.customer_last_name)}<span class="client-meta">${escapeHTML(a.customer_phone)}<br/>${escapeHTML(a.customer_email)}</span></td><td>${escapeHTML(serviceById[a.service_id] || 'Услуга')}<span class="client-meta">${escapeHTML(barberById[a.barber_id] || 'Специалист')}</span></td><td><span class="admin-status ${a.status === 'cancelled' ? 'cancelled' : ''}">${a.status === 'cancelled' ? 'ОТМЕНЕНА' : 'ПОДТВЕРЖДЕНА'}</span></td><td>${a.status === 'confirmed' ? `<button class="admin-small-button" data-cancel-appointment="${escapeHTML(a.id)}">Отменить</button>` : ''}</td></tr>`).join('');
  }
  if (!ready) {
    loginMessage.textContent = 'Сначала укажите URL и публичный ключ проекта Supabase в dist/booking-config.js.';
    authForm.querySelectorAll('input,button').forEach(element => { element.disabled = true; });
    return;
  }
  client = window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
  authForm.addEventListener('submit', async event => {
    event.preventDefault(); notify(loginMessage, 'Выполняется вход…');
    const data = new FormData(authForm);
    const { error } = await client.auth.signInWithPassword({ email: data.get('email'), password: data.get('password') });
    if (error) notify(loginMessage, 'Не удалось войти. Проверьте доступ администратора.');
  });
  client.auth.onAuthStateChange(async (_event, session) => {
    loginBox.hidden = Boolean(session); panel.hidden = !session;
    if (session) await loadAdminData();
  });
  document.querySelector('#admin-signout').addEventListener('click', async () => { await client.auth.signOut(); });
  document.querySelector('#refresh-bookings').addEventListener('click', loadAdminData);
  document.querySelector('#appointments-body').addEventListener('click', async event => {
    const button = event.target.closest('[data-cancel-appointment]'); if (!button) return;
    if (!window.confirm('Отменить выбранную запись? Это освободит интервал для клиентов.')) return;
    const { error } = await client.from('appointments').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', button.dataset.cancelAppointment);
    if (error) notify(message, authError(error)); else await loadAdminData();
  });
  document.querySelector('#barbers-list').addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit-barber]');
    if (editButton) {
      const barber = barbers.find(item => item.id === editButton.dataset.editBarber);
      const name = window.prompt('Имя специалиста', barber?.display_name || '');
      if (name === null || !name.trim()) return;
      const { error } = await client.from('barbers').update({ display_name: name.trim(), bio: barber.demo_profile ? '' : barber.bio, demo_profile: false }).eq('id', editButton.dataset.editBarber);
      if (error) notify(message, authError(error)); else await loadAdminData();
      return;
    }
    const button = event.target.closest('[data-toggle-barber]'); if (!button) return;
    const { error } = await client.from('barbers').update({ active: button.dataset.active !== 'true' }).eq('id', button.dataset.toggleBarber);
    if (error) notify(message, authError(error)); else await loadAdminData();
  });
  document.querySelector('#new-barber-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const { error } = await client.from('barbers').insert({ slug: `barber-${crypto.randomUUID().slice(0, 8)}`, display_name: String(data.get('display_name')).trim(), bio: String(data.get('bio') || '').trim(), active: true, demo_profile: false });
    if (error) notify(message, authError(error)); else { form.reset(); await loadAdminData(); }
  });
  document.querySelector('#weekly-form').addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const open = data.get('is_open') === 'on';
    if (open && String(data.get('opens_at')) >= String(data.get('closes_at'))) { notify(message, 'Время закрытия должно быть позже времени открытия.'); return; }
    const { error } = await client.from('weekly_schedule').upsert({ barber_id: data.get('barber_id'), weekday: Number(data.get('weekday')), is_open: open, opens_at: data.get('opens_at') || '10:00', closes_at: data.get('closes_at') || '22:00', updated_at: new Date().toISOString() }, { onConflict: 'barber_id,weekday' });
    if (error) notify(message, authError(error)); else notify(message, `График на «${weekdayNames[Number(data.get('weekday'))]}» сохранён.`);
  });
  document.querySelector('#delete-override').addEventListener('click', async () => {
    const form = document.querySelector('#override-form');
    const barberId = new FormData(form).get('barber_id');
    const date = new FormData(form).get('service_date');
    if (!barberId || !date) { notify(message, 'Выберите специалиста и дату для удаления исключения.'); return; }
    const { error } = await client.from('schedule_overrides').delete().eq('barber_id', barberId).eq('service_date', date);
    if (error) notify(message, authError(error)); else notify(message, 'Исключение удалено. Для этой даты снова действует недельный график.');
  });
  document.querySelector('#override-form').addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const closed = data.get('is_closed') === 'on';
    if (!closed && String(data.get('opens_at')) >= String(data.get('closes_at'))) { notify(message, 'Время закрытия должно быть позже времени открытия.'); return; }
    const { error } = await client.from('schedule_overrides').upsert({ barber_id: data.get('barber_id'), service_date: data.get('service_date'), is_closed: closed, opens_at: closed ? null : data.get('opens_at'), closes_at: closed ? null : data.get('closes_at'), note: String(data.get('note') || '').trim(), updated_at: new Date().toISOString() }, { onConflict: 'barber_id,service_date' });
    if (error) notify(message, authError(error)); else notify(message, 'Исключение для даты сохранено.');
  });
})();
