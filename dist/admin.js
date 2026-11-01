(() => {
  const cfg = window.BLACKWOOD_SUPABASE_CONFIG || {};
  const loginBox = document.querySelector('#admin-login');
  const panel = document.querySelector('#admin-panel');
  const loginMessage = document.querySelector('#admin-login-message');
  const message = document.querySelector('#admin-message');
  const authForm = document.querySelector('#admin-login-form');
  const ready = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.url || '')
    && /^sb_publishable_[A-Za-z0-9_-]+$/.test(cfg.publishableKey || '')
    && window.supabase?.createClient;
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const weekdayNames = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const monthFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  let client = null;
  let barbers = [];
  let services = [];
  let monthBookings = [];
  let upcomingBookings = [];
  let weeklyRows = [];
  let overrides = [];
  let viewYear;
  let viewMonth;
  let selectedDay = '';
  let authGeneration = 0;
  let manualSlotRequest = 0;

  function notify(target, text) { target.textContent = text; }
  function failMessage(error) {
    const text = error?.message || '';
    if (/permission|row level|policy|not allowed|JWT/i.test(text)) return 'Доступ запрещён. Проверьте роль booking_admin в app_metadata.';
    if (/network|fetch|timeout/i.test(text)) return 'Не удалось связаться с Supabase. Проверьте подключение и повторите попытку.';
    return 'Не удалось выполнить действие. Проверьте права администратора и попробуйте ещё раз.';
  }
  function localDateKey(value) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function todayKey() { return localDateKey(Date.now()); }
  function shiftDate(key, days) {
    const date = new Date(`${key}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  function dateStartUtc(key) { return new Date(`${key}T00:00:00+06:00`).toISOString(); }
  function monthFirst(year, month) { return `${year}-${String(month + 1).padStart(2, '0')}-01`; }
  function nextMonthFirst(year, month) {
    const date = new Date(Date.UTC(year, month + 1, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  function formatVisit(value, withYear = true) {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Asia/Bishkek', weekday: 'short', day: '2-digit', month: 'short',
      ...(withYear ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit'
    }).format(new Date(value));
  }
  function formatCalendarDate(key) {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(`${key}T12:00:00Z`));
  }
  function isAdmin(user) { return user?.app_metadata?.role === 'booking_admin'; }
  function serviceMap() { return Object.fromEntries(services.map(service => [service.id, service.name])); }
  function barberMap() { return Object.fromEntries(barbers.map(barber => [barber.id, barber.display_name])); }
  function appointmentBarberMatches(appointment, filterValue) { return filterValue === 'all' || appointment.barber_id === filterValue; }

  function updateBarberOptions() {
    const filter = document.querySelector('#calendar-barber-filter');
    const previousFilter = filter.value || 'all';
    filter.innerHTML = '<option value="all">Все специалисты</option>' + barbers.map(barber =>
      `<option value="${escapeHTML(barber.id)}">${escapeHTML(barber.display_name)}${barber.active ? '' : ' · пауза'}</option>`).join('');
    filter.value = barbers.some(barber => barber.id === previousFilter) ? previousFilter : 'all';

    for (const selector of [document.querySelector('#weekly-barber'), document.querySelector('#override-barber')]) {
      const previous = selector.value;
      selector.innerHTML = barbers.map(barber =>
        `<option value="${escapeHTML(barber.id)}">${escapeHTML(barber.display_name)}${barber.active ? '' : ' · пауза'}</option>`).join('');
      if (barbers.some(barber => barber.id === previous)) selector.value = previous;
    }
  }

  function renderBarbers() {
    const root = document.querySelector('#barbers-list');
    if (!barbers.length) { root.innerHTML = '<p class="empty-admin">Пока нет специалистов.</p>'; return; }
    root.innerHTML = barbers.map(barber => `<article class="barber-admin-row ${barber.active ? '' : 'inactive'}">
      <div class="barber-copy"><strong>${escapeHTML(barber.display_name)}</strong><small>${barber.demo_profile ? 'Демо-профиль · замените реальным специалистом' : escapeHTML(barber.bio || 'Специалист')}</small></div>
      <div class="admin-action-row"><button class="admin-small-button" data-edit-barber="${escapeHTML(barber.id)}" type="button">Изменить</button>
      <button class="admin-small-button" data-toggle-barber="${escapeHTML(barber.id)}" data-active="${Boolean(barber.active)}" type="button">${barber.active ? 'Пауза' : 'Активировать'}</button></div>
    </article>`).join('');
  }

  function renderServices() {
    const root = document.querySelector('#services-list');
    const activeCount = services.filter(service => service.active).length;
    document.querySelector('#metric-services').textContent = String(activeCount);
    if (!services.length) { root.innerHTML = '<p class="empty-admin">Пока нет услуг.</p>'; return; }
    root.innerHTML = services.map(service => `<article class="service-admin-row ${service.active ? '' : 'inactive'}">
      <div><strong>${escapeHTML(service.name)}</strong><small>${escapeHTML(service.description || 'Без описания')} · ${Number(service.duration_minutes)} мин · ${Number(service.price_kgs).toLocaleString('ru-RU')} сом</small></div>
      <div class="admin-action-row"><button class="admin-small-button" data-edit-service="${escapeHTML(service.id)}" type="button">Изменить</button>
      <button class="admin-small-button" data-toggle-service="${escapeHTML(service.id)}" data-active="${Boolean(service.active)}" type="button">${service.active ? 'Скрыть' : 'В меню'}</button></div>
    </article>`).join('');
  }

  function renderUpcoming() {
    const root = document.querySelector('#upcoming-list');
    const query = String(document.querySelector('#booking-search').value || '').trim().toLocaleLowerCase('ru-RU');
    const filtered = upcomingBookings.filter(row => !query ||
      `${row.customer_first_name} ${row.customer_last_name} ${row.customer_phone} ${row.customer_email || ''}`.toLocaleLowerCase('ru-RU').includes(query));
    root.innerHTML = filtered.length
      ? filtered.map(row => appointmentCard(row, true)).join('')
      : `<p class="empty-admin">${upcomingBookings.length ? 'По этому запросу записей не найдено.' : 'Ближайших бронирований пока нет.'}</p>`;
  }

  function appointmentCard(appointment, compact = false) {
    const servicesById = serviceMap();
    const barbersById = barberMap();
    const cancelled = appointment.status === 'cancelled';
    return `<article class="appointment-card ${cancelled ? 'is-cancelled' : ''} ${compact ? 'is-compact' : ''}">
      <div class="appointment-time"><strong>${escapeHTML(formatVisit(appointment.starts_at, false))}</strong><span>${escapeHTML(appointment.booking_code || '')}</span></div>
      <div class="appointment-details"><strong>${escapeHTML(appointment.customer_first_name)} ${escapeHTML(appointment.customer_last_name)}</strong>
        <span>${escapeHTML(servicesById[appointment.service_id] || 'Услуга')} · ${escapeHTML(barbersById[appointment.barber_id] || 'Специалист')}</span>
        <a href="tel:${escapeHTML(appointment.customer_phone)}">${escapeHTML(appointment.customer_phone)}</a>
        ${appointment.customer_email ? `<a href="mailto:${escapeHTML(appointment.customer_email)}">${escapeHTML(appointment.customer_email)}</a>` : ''}
        <span class="appointment-source">${appointment.source === 'admin' ? 'Добавлена администратором' : 'Через сайт'}</span>
        ${appointment.admin_note ? `<span class="appointment-admin-note">Заметка: ${escapeHTML(appointment.admin_note)}</span>` : ''}</div>
      <div class="appointment-actions"><span class="admin-status ${cancelled ? 'cancelled' : ''}">${cancelled ? 'ОТМЕНЕНА' : 'ПОДТВЕРЖДЕНА'}</span>
        ${!cancelled ? `<button class="admin-small-button" data-cancel-appointment="${escapeHTML(appointment.id)}" type="button">Отменить запись</button>` : ''}</div>
    </article>`;
  }

  async function fetchMonthAppointments() {
    const from = dateStartUtc(monthFirst(viewYear, viewMonth));
    const to = dateStartUtc(nextMonthFirst(viewYear, viewMonth));
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const result = await client.from('appointments')
        .select('id,booking_code,barber_id,service_id,starts_at,ends_at,customer_first_name,customer_last_name,customer_phone,customer_email,status,source,admin_note')
        .gte('starts_at', from).lt('starts_at', to).order('starts_at').range(offset, offset + 499);
      if (result.error) throw result.error;
      rows.push(...(result.data || []));
      if ((result.data || []).length < 500) break;
    }
    monthBookings = rows;
    renderCalendar();
  }

  async function loadDashboard() {
    const today = todayKey();
    const from = dateStartUtc(today);
    const to = dateStartUtc(shiftDate(today, 1));
    const [countResult, upcomingResult] = await Promise.all([
      client.from('appointments').select('id', { count: 'exact', head: true }).eq('status', 'confirmed').gte('starts_at', from).lt('starts_at', to),
      client.from('appointments').select('id,booking_code,barber_id,service_id,starts_at,ends_at,customer_first_name,customer_last_name,customer_phone,customer_email,status,source,admin_note')
        .eq('status', 'confirmed').gte('starts_at', new Date().toISOString()).order('starts_at').limit(6)
    ]);
    if (countResult.error) throw countResult.error;
    if (upcomingResult.error) throw upcomingResult.error;
    document.querySelector('#metric-today').textContent = String(countResult.count ?? 0);
    document.querySelector('#metric-today-note').textContent = (countResult.count ?? 0) === 1 ? 'подтверждённая запись' : 'подтверждённых записей';
    const upcoming = upcomingResult.data || [];
    const nextLabel = document.querySelector('#metric-next');
    const nextNote = document.querySelector('#metric-next-note');
    if (upcoming[0]) {
      nextLabel.textContent = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(upcoming[0].starts_at));
      nextNote.textContent = `${barberMap()[upcoming[0].barber_id] || 'Специалист'} · ${upcoming.length} ближайших визитов`;
    } else {
      nextLabel.textContent = '—';
      nextNote.textContent = 'пока нет ближайших визитов';
    }
    upcomingBookings = upcoming;
    renderUpcoming();
  }

  function renderCalendar() {
    const firstKey = monthFirst(viewYear, viewMonth);
    const firstDate = new Date(`${firstKey}T12:00:00Z`);
    document.querySelector('#calendar-month-label').textContent = monthFormatter.format(firstDate);
    const filtered = monthBookings.filter(row => appointmentBarberMatches(row, document.querySelector('#calendar-barber-filter').value));
    const byDate = new Map();
    for (const appointment of filtered) {
      const key = localDateKey(appointment.starts_at);
      const bucket = byDate.get(key) || [];
      bucket.push(appointment);
      byDate.set(key, bucket);
    }
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const offset = (firstDate.getUTCDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push('<span class="calendar-empty" role="gridcell"></span>');
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const items = byDate.get(key) || [];
      const confirmed = items.filter(item => item.status === 'confirmed').length;
      const cancelled = items.length - confirmed;
      const classes = ['calendar-day', key === todayKey() ? 'is-today' : '', key === selectedDay ? 'is-selected' : '', items.length ? 'has-bookings' : ''].filter(Boolean).join(' ');
      cells.push(`<button class="${classes}" type="button" role="gridcell" data-calendar-date="${key}" aria-label="${escapeHTML(formatCalendarDate(key))}${items.length ? `, записей: ${items.length}` : ', записей нет'}" aria-pressed="${key === selectedDay}">
        <span class="calendar-day-number">${day}</span>${items.length ? `<span class="calendar-day-count">${items.length}</span>` : '<span class="calendar-day-dot"></span>'}
        ${confirmed && cancelled ? '<span class="calendar-day-indicator mixed"></span>' : confirmed ? '<span class="calendar-day-indicator"></span>' : cancelled ? '<span class="calendar-day-indicator cancelled"></span>' : ''}</button>`);
    }
    const trailing = (7 - cells.length % 7) % 7;
    for (let i = 0; i < trailing; i++) cells.push('<span class="calendar-empty" role="gridcell"></span>');
    document.querySelector('#calendar-grid').innerHTML = cells.join('');
    document.querySelector('#day-heading').textContent = formatCalendarDate(selectedDay);
    const statusFilter = document.querySelector('#booking-status-filter').value;
    const dayRows = (byDate.get(selectedDay) || []).filter(row => statusFilter === 'all' || row.status === statusFilter)
      .slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    document.querySelector('#day-bookings').innerHTML = dayRows.length
      ? dayRows.map(row => appointmentCard(row)).join('')
      : `<p class="empty-admin">${(byDate.get(selectedDay) || []).length ? 'Для этого статуса записей нет.' : 'На этот день записей нет.'}</p>`;
  }

  async function loadWeeklySchedule() {
    const barberId = document.querySelector('#weekly-barber').value;
    if (!barberId) { weeklyRows = []; renderWeeklySchedule(); return; }
    const result = await client.from('weekly_schedule').select('id,barber_id,weekday,opens_at,closes_at,is_open').eq('barber_id', barberId).order('weekday');
    if (result.error) throw result.error;
    weeklyRows = result.data || [];
    renderWeeklySchedule();
    fillWeeklyForm(Number(document.querySelector('#weekly-weekday').value));
  }

  function renderWeeklySchedule() {
    const root = document.querySelector('#weekly-schedule-list');
    if (!weeklyRows.length) { root.innerHTML = '<p class="empty-admin">Расписание пока не задано.</p>'; return; }
    root.innerHTML = `<div class="weekly-list-label">НЕДЕЛЬНЫЙ ГРАФИК</div>` + weeklyRows.map(row => `<button class="weekly-row ${row.is_open ? '' : 'is-closed'}" type="button" data-edit-weekday="${row.weekday}">
      <span>${weekdayNames[row.weekday]}</span><strong>${row.is_open ? `${escapeHTML(String(row.opens_at).slice(0, 5))} — ${escapeHTML(String(row.closes_at).slice(0, 5))}` : 'Выходной'}</strong><span>Изменить</span></button>`).join('');
  }

  function fillWeeklyForm(weekday) {
    const row = weeklyRows.find(item => Number(item.weekday) === Number(weekday));
    const form = document.querySelector('#weekly-form');
    form.elements.weekday.value = String(weekday);
    form.elements.is_open.checked = row ? row.is_open : false;
    form.elements.opens_at.value = row?.opens_at?.slice(0, 5) || '10:00';
    form.elements.closes_at.value = row?.closes_at?.slice(0, 5) || '22:00';
  }

  async function loadOverrides() {
    const barberId = document.querySelector('#override-barber').value;
    if (!barberId) { overrides = []; renderOverrides(); return; }
    const result = await client.from('schedule_overrides').select('id,barber_id,service_date,is_closed,opens_at,closes_at,note')
      .eq('barber_id', barberId).gte('service_date', todayKey()).order('service_date').limit(100);
    if (result.error) throw result.error;
    overrides = result.data || [];
    renderOverrides();
  }

  function renderOverrides() {
    const root = document.querySelector('#overrides-list');
    if (!overrides.length) { root.innerHTML = '<p class="empty-admin">Предстоящих исключений нет.</p>'; return; }
    root.innerHTML = overrides.map(row => `<article class="override-row"><div><strong>${escapeHTML(formatCalendarDate(row.service_date))}</strong><small>${row.is_closed ? 'Выходной' : `${escapeHTML(String(row.opens_at).slice(0, 5))} — ${escapeHTML(String(row.closes_at).slice(0, 5))}`}${row.note ? ` · ${escapeHTML(row.note)}` : ''}</small></div><button class="admin-small-button" type="button" data-delete-override="${escapeHTML(row.id)}" aria-label="Удалить исключение ${escapeHTML(row.service_date)}">Удалить</button></article>`).join('');
  }

  async function loadAdminData() {
    notify(message, 'Загружаем расписание и бронирования…');
    document.querySelectorAll('#admin-panel .admin-card').forEach(card => card.classList.add('is-loading'));
    try {
      const [barberResult, serviceResult] = await Promise.all([
        client.from('barbers').select('id,slug,display_name,bio,active,demo_profile,created_at').order('created_at'),
        client.from('services').select('id,slug,name,description,duration_minutes,price_kgs,active,sort_order').order('sort_order')
      ]);
      if (barberResult.error) throw barberResult.error;
      if (serviceResult.error) throw serviceResult.error;
      barbers = barberResult.data || [];
      services = serviceResult.data || [];
      updateBarberOptions();
      renderBarbers();
      renderServices();
      await Promise.all([fetchMonthAppointments(), loadDashboard(), loadWeeklySchedule(), loadOverrides()]);
      notify(message, 'Данные обновлены.');
    } catch (error) {
      notify(message, failMessage(error));
    } finally {
      document.querySelectorAll('#admin-panel .admin-card').forEach(card => card.classList.remove('is-loading'));
    }
  }

  async function verifySession(session, generation = ++authGeneration) {
    if (generation !== authGeneration) return;
    if (!session) {
      loginBox.hidden = false;
      panel.hidden = true;
      document.querySelector('#admin-identity').textContent = '';
      return;
    }
    const { data, error } = await client.auth.getUser();
    if (generation !== authGeneration) return;
    if (error || !data.user || data.user.id !== session.user.id || !isAdmin(data.user)) {
      loginBox.hidden = false;
      panel.hidden = true;
      notify(loginMessage, 'У этой учётной записи нет административной роли. Назначьте booking_admin в app_metadata.');
      await client.auth.signOut();
      return;
    }
    loginBox.hidden = true;
    panel.hidden = false;
    document.querySelector('#admin-identity').textContent = data.user.email || 'Администратор';
    document.querySelector('#sidebar-identity').textContent = data.user.email || 'Администратор';
    document.querySelector('#settings-identity').textContent = data.user.email || 'Администратор';
    document.querySelector('#admin-avatar').textContent = (data.user.email || 'B').trim().slice(0, 1).toUpperCase();
    await loadAdminData();
  }

  function refreshCurrentMonth() {
    return fetchMonthAppointments().then(renderCalendar).catch(error => notify(message, failMessage(error)));
  }
  async function cancelAppointment(id) {
    if (!window.confirm('Отменить выбранную запись? Это освободит интервал для клиентов.')) return;
    notify(message, 'Отменяем запись…');
    const { error } = await client.from('appointments').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'confirmed');
    if (error) { notify(message, failMessage(error)); return; }
    await loadAdminData();
    notify(message, 'Запись отменена, время снова доступно для бронирования.');
  }

  const manualDialog = document.querySelector('#manual-booking-dialog');
  const manualForm = document.querySelector('#manual-booking-form');
  const manualMessage = document.querySelector('#manual-booking-message');
  const manualServiceSelect = manualForm.elements.service_id;
  const manualBarberSelect = manualForm.elements.barber_id;
  const manualDateInput = manualForm.elements.service_date;
  const manualTimeSelect = manualForm.elements.starts_at;
  const manualSubmit = document.querySelector('#manual-booking-submit');

  function populateManualBookingOptions() {
    const serviceValue = manualServiceSelect.value;
    const barberValue = manualBarberSelect.value;
    manualServiceSelect.innerHTML = '<option value="">Выберите услугу</option>' + services.filter(item => item.active).map(item =>
      `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)} · ${Number(item.duration_minutes)} мин · ${Number(item.price_kgs).toLocaleString('ru-RU')} сом</option>`).join('');
    manualBarberSelect.innerHTML = '<option value="">Выберите специалиста</option>' + barbers.filter(item => item.active).map(item =>
      `<option value="${escapeHTML(item.id)}">${escapeHTML(item.display_name)}</option>`).join('');
    if (services.some(item => item.active && item.id === serviceValue)) manualServiceSelect.value = serviceValue;
    if (barbers.some(item => item.active && item.id === barberValue)) manualBarberSelect.value = barberValue;
  }

  function clearManualSlots(label = 'Сначала выберите услугу, специалиста и дату') {
    manualTimeSelect.innerHTML = `<option value="">${escapeHTML(label)}</option>`;
    manualTimeSelect.disabled = true;
    manualSubmit.disabled = true;
  }

  async function loadManualSlots() {
    const requestId = ++manualSlotRequest;
    clearManualSlots('Загружаем свободное время…');
    const serviceId = manualServiceSelect.value;
    const barberId = manualBarberSelect.value;
    const date = manualDateInput.value;
    if (!serviceId || !barberId || !date) { clearManualSlots(); return; }
    notify(manualMessage, 'Проверяем расписание и занятость…');
    try {
      const response = await fetch(`${String(cfg.url).replace(/\/$/, '')}/functions/v1/availability`, {
        method: 'POST',
        headers: { apikey: cfg.publishableKey, Authorization: `Bearer ${cfg.publishableKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId, barberId, date })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || 'Не удалось получить свободное время.');
      if (requestId !== manualSlotRequest) return;
      const slots = Array.isArray(payload.slots) ? payload.slots : [];
      manualTimeSelect.innerHTML = '<option value="">Выберите свободное время</option>' + slots.map(slot =>
        `<option value="${escapeHTML(slot.starts_at)}">${escapeHTML(slot.local_time)}</option>`).join('');
      manualTimeSelect.disabled = slots.length === 0;
      if (!slots.length) {
        manualTimeSelect.innerHTML = '<option value="">Свободных часов нет</option>';
        notify(manualMessage, 'На эту дату свободного времени нет. Выберите другую дату.');
      } else notify(manualMessage, 'Отображаются только свободные интервалы с учётом длительности услуги.');
    } catch (error) {
      if (requestId !== manualSlotRequest) return;
      clearManualSlots('Время недоступно');
      notify(manualMessage, error.message || 'Не удалось загрузить расписание. Попробуйте ещё раз.');
    }
  }

  function openManualBooking() {
    manualForm.reset();
    populateManualBookingOptions();
    const today = todayKey();
    const max = new Date(`${today}T12:00:00+06:00`);
    max.setDate(max.getDate() + 90);
    manualDateInput.min = today;
    manualDateInput.max = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit' }).format(max);
    clearManualSlots();
    notify(manualMessage, '');
    if (!manualDialog.open) manualDialog.showModal();
  }

  document.querySelector('#new-appointment').addEventListener('click', openManualBooking);
  document.querySelector('#manual-booking-close').addEventListener('click', () => manualDialog.close());
  document.querySelector('#manual-booking-cancel').addEventListener('click', () => manualDialog.close());
  manualDialog.addEventListener('click', event => { if (event.target === manualDialog) manualDialog.close(); });
  [manualServiceSelect, manualBarberSelect, manualDateInput].forEach(control => control.addEventListener('change', () => {
    notify(manualMessage, '');
    void loadManualSlots();
  }));
  manualTimeSelect.addEventListener('change', () => { manualSubmit.disabled = !manualTimeSelect.value; });
  manualForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!manualForm.reportValidity() || !manualTimeSelect.value) return;
    const data = new FormData(manualForm);
    const values = {
      p_submission_id: crypto.randomUUID(),
      p_service_id: String(data.get('service_id')),
      p_barber_id: String(data.get('barber_id')),
      p_starts_at: String(data.get('starts_at')),
      p_first_name: String(data.get('first_name')).trim(),
      p_last_name: String(data.get('last_name')).trim(),
      p_phone: String(data.get('phone')).trim(),
      p_email: String(data.get('email') || '').trim() || null,
      p_admin_note: String(data.get('admin_note') || '').trim()
    };
    manualSubmit.disabled = true;
    notify(manualMessage, 'Создаём запись…');
    const { error } = await client.rpc('admin_create_booking', values);
    if (error) {
      if (error.code === '23P01' || /slot_unavailable|conflict|пересека/i.test(error.message || '')) {
        notify(manualMessage, 'Это время только что заняли. Обновляем свободные часы…');
        await loadManualSlots();
      } else notify(manualMessage, failMessage(error));
      manualSubmit.disabled = !manualTimeSelect.value;
      return;
    }
    const chosenDate = String(data.get('service_date'));
    selectedDay = chosenDate;
    viewYear = Number(chosenDate.slice(0, 4));
    viewMonth = Number(chosenDate.slice(5, 7)) - 1;
    await loadAdminData();
    manualDialog.close();
    notify(message, 'Запись добавлена. Время уже занято и исключено из публичных слотов.');
  });

  if (!ready) {
    notify(loginMessage, 'Supabase не настроен. Проверьте URL и публичный ключ в booking-config.js.');
    authForm.querySelectorAll('input,button').forEach(element => { element.disabled = true; });
    return;
  }

  selectedDay = todayKey();
  viewYear = Number(selectedDay.slice(0, 4));
  viewMonth = Number(selectedDay.slice(5, 7)) - 1;
  client = window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true } });

  const sidebar = document.querySelector('.admin-sidebar');
  const mobileNavToggle = document.querySelector('#admin-mobile-nav-toggle');
  const navigationLinks = [...document.querySelectorAll('[data-admin-section]')];
  const setActiveSection = id => navigationLinks.forEach(link => {
    if (link.dataset.adminSection === id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  mobileNavToggle.addEventListener('click', () => {
    const open = mobileNavToggle.getAttribute('aria-expanded') !== 'true';
    mobileNavToggle.setAttribute('aria-expanded', String(open));
    sidebar.classList.toggle('is-open', open);
  });
  navigationLinks.forEach(link => link.addEventListener('click', () => {
    setActiveSection(link.dataset.adminSection);
    mobileNavToggle.setAttribute('aria-expanded', 'false');
    sidebar.classList.remove('is-open');
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      mobileNavToggle.setAttribute('aria-expanded', 'false');
      sidebar.classList.remove('is-open');
    }
  });
  if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveSection(visible[0].target.id);
    }, { rootMargin: '-18% 0px -68% 0px', threshold: 0 });
    navigationLinks.forEach(link => {
      const section = document.getElementById(link.dataset.adminSection);
      if (section) sectionObserver.observe(section);
    });
  }

  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.querySelector('#admin-login-button');
    button.disabled = true;
    notify(loginMessage, 'Проверяем учётную запись…');
    const formData = new FormData(authForm);
    const { data, error } = await client.auth.signInWithPassword({ email: formData.get('email'), password: formData.get('password') });
    button.disabled = false;
    if (error) { notify(loginMessage, 'Не удалось войти. Проверьте email, пароль и доступ администратора.'); return; }
    await verifySession(data.session);
  });

  client.auth.onAuthStateChange((_event, session) => {
    const generation = ++authGeneration;
    window.setTimeout(() => { void verifySession(session, generation); }, 0);
  });

  document.querySelector('#admin-signout').addEventListener('click', async () => {
    const { error } = await client.auth.signOut();
    if (error) notify(message, failMessage(error));
  });
  document.querySelector('#refresh-bookings').addEventListener('click', loadAdminData);
  document.querySelector('#booking-search').addEventListener('input', renderUpcoming);
  document.querySelector('#calendar-barber-filter').addEventListener('change', renderCalendar);
  document.querySelector('#booking-status-filter').addEventListener('change', renderCalendar);
  document.querySelector('#calendar-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-calendar-date]');
    if (!button) return;
    selectedDay = button.dataset.calendarDate;
    renderCalendar();
  });
  document.querySelector('#calendar-prev').addEventListener('click', async () => {
    const date = new Date(Date.UTC(viewYear, viewMonth - 1, 1)); viewYear = date.getUTCFullYear(); viewMonth = date.getUTCMonth(); selectedDay = monthFirst(viewYear, viewMonth); await refreshCurrentMonth();
  });
  document.querySelector('#calendar-next').addEventListener('click', async () => {
    const date = new Date(Date.UTC(viewYear, viewMonth + 1, 1)); viewYear = date.getUTCFullYear(); viewMonth = date.getUTCMonth(); selectedDay = monthFirst(viewYear, viewMonth); await refreshCurrentMonth();
  });
  document.querySelector('#calendar-today').addEventListener('click', async () => {
    selectedDay = todayKey(); viewYear = Number(selectedDay.slice(0, 4)); viewMonth = Number(selectedDay.slice(5, 7)) - 1; await refreshCurrentMonth();
  });

  document.querySelector('#barbers-list').addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit-barber]');
    if (editButton) {
      const barber = barbers.find(item => item.id === editButton.dataset.editBarber);
      if (!barber) return;
      barberEditForm.elements.barber_id.value = barber.id;
      barberEditForm.elements.display_name.value = barber.display_name;
      barberEditForm.elements.bio.value = barber.bio || '';
      notify(barberEditMessage, '');
      barberEditDialog.showModal();
      return;
    }
    const button = event.target.closest('[data-toggle-barber]');
    if (!button) return;
    const active = button.dataset.active !== 'true';
    if (!active && !window.confirm('Приостановить профиль? Новые бронирования для этого специалиста будут недоступны.')) return;
    const { error } = await client.from('barbers').update({ active }).eq('id', button.dataset.toggleBarber);
    if (error) notify(message, failMessage(error)); else await loadAdminData();
  });

  const barberEditDialog = document.querySelector('#barber-edit-dialog');
  const barberEditForm = document.querySelector('#barber-edit-form');
  const barberEditMessage = document.querySelector('#barber-edit-message');
  document.querySelector('#barber-edit-close').addEventListener('click', () => barberEditDialog.close());
  document.querySelector('#barber-edit-cancel').addEventListener('click', () => barberEditDialog.close());
  barberEditDialog.addEventListener('click', event => { if (event.target === barberEditDialog) barberEditDialog.close(); });
  barberEditForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!barberEditForm.reportValidity()) return;
    const values = new FormData(barberEditForm);
    const button = barberEditForm.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = 'Сохраняем…';
    const { error } = await client.from('barbers').update({
      display_name: String(values.get('display_name')).trim(),
      bio: String(values.get('bio') || '').trim(),
      demo_profile: false
    }).eq('id', values.get('barber_id'));
    button.disabled = false;
    button.textContent = 'Сохранить ↗';
    if (error) { notify(barberEditMessage, failMessage(error)); return; }
    barberEditDialog.close();
    await loadAdminData();
    notify(message, 'Профиль специалиста обновлён.');
  });

  document.querySelector('#new-barber-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const { error } = await client.from('barbers').insert({ slug: `barber-${crypto.randomUUID().slice(0, 8)}`, display_name: String(data.get('display_name')).trim(), bio: String(data.get('bio') || '').trim(), active: true, demo_profile: false });
    if (error) notify(message, failMessage(error)); else { form.reset(); await loadAdminData(); notify(message, 'Специалист добавлен.'); }
  });

  document.querySelector('#weekly-barber').addEventListener('change', () => loadWeeklySchedule().catch(error => notify(message, failMessage(error))));
  document.querySelector('#weekly-weekday').addEventListener('change', event => fillWeeklyForm(Number(event.currentTarget.value)));
  document.querySelector('#weekly-schedule-list').addEventListener('click', event => {
    const button = event.target.closest('[data-edit-weekday]');
    if (!button) return;
    document.querySelector('#weekly-weekday').value = button.dataset.editWeekday;
    fillWeeklyForm(Number(button.dataset.editWeekday));
    document.querySelector('#weekly-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.querySelector('#weekly-form').addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const open = data.get('is_open') === 'on';
    const opensAt = String(data.get('opens_at') || '');
    const closesAt = String(data.get('closes_at') || '');
    if (open && (!opensAt || !closesAt || opensAt >= closesAt)) { notify(message, 'Время закрытия должно быть позже времени открытия.'); return; }
    const { error } = await client.from('weekly_schedule').upsert({ barber_id: data.get('barber_id'), weekday: Number(data.get('weekday')), is_open: open, opens_at: opensAt || '10:00', closes_at: closesAt || '22:00', updated_at: new Date().toISOString() }, { onConflict: 'barber_id,weekday' });
    if (error) { notify(message, failMessage(error)); return; }
    await loadWeeklySchedule();
    notify(message, `График на «${weekdayNames[Number(data.get('weekday'))]}» сохранён.`);
  });

  document.querySelector('#override-barber').addEventListener('change', () => loadOverrides().catch(error => notify(message, failMessage(error))));
  document.querySelector('#override-form').addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const start = String(data.get('start_date') || '');
    const end = String(data.get('end_date') || '');
    const closed = data.get('is_closed') === 'on';
    if (!start || !end || end < start) { notify(message, 'Дата окончания должна быть не раньше даты начала.'); return; }
    const count = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
    if (count > 366) { notify(message, 'Период не может быть длиннее одного года.'); return; }
    const opensAt = String(data.get('opens_at') || '');
    const closesAt = String(data.get('closes_at') || '');
    if (!closed && (!opensAt || !closesAt || opensAt >= closesAt)) { notify(message, 'Время закрытия должно быть позже времени открытия.'); return; }
    const note = String(data.get('note') || '').trim();
    const rows = Array.from({ length: count }, (_, index) => ({
      barber_id: data.get('barber_id'), service_date: shiftDate(start, index), is_closed: closed,
      opens_at: closed ? null : opensAt, closes_at: closed ? null : closesAt, note, updated_at: new Date().toISOString()
    }));
    const { error } = await client.from('schedule_overrides').upsert(rows, { onConflict: 'barber_id,service_date' });
    if (error) { notify(message, failMessage(error)); return; }
    await loadOverrides();
    notify(message, `Исключения добавлены на ${count} ${count === 1 ? 'день' : 'дн.'}.`);
  });
  document.querySelector('#overrides-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-override]');
    if (!button) return;
    if (!window.confirm('Удалить это исключение? Для даты снова будет действовать недельное расписание.')) return;
    const { error } = await client.from('schedule_overrides').delete().eq('id', button.dataset.deleteOverride);
    if (error) notify(message, failMessage(error)); else { await loadOverrides(); notify(message, 'Исключение удалено.'); }
  });

  const serviceForm = document.querySelector('#service-form');
  const resetServiceForm = () => {
    serviceForm.reset(); serviceForm.elements.service_id.value = '';
    document.querySelector('#save-service-button').textContent = 'Добавить услугу';
    document.querySelector('#cancel-service-edit').hidden = true;
  };
  document.querySelector('#cancel-service-edit').addEventListener('click', resetServiceForm);
  document.querySelector('#services-list').addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit-service]');
    if (editButton) {
      const service = services.find(item => item.id === editButton.dataset.editService);
      if (!service) return;
      serviceForm.elements.service_id.value = service.id;
      serviceForm.elements.name.value = service.name;
      serviceForm.elements.description.value = service.description || '';
      serviceForm.elements.price_kgs.value = service.price_kgs;
      serviceForm.elements.duration_minutes.value = service.duration_minutes;
      document.querySelector('#save-service-button').textContent = 'Сохранить изменения';
      document.querySelector('#cancel-service-edit').hidden = false;
      serviceForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const toggleButton = event.target.closest('[data-toggle-service]');
    if (!toggleButton) return;
    const active = toggleButton.dataset.active !== 'true';
    const { error } = await client.from('services').update({ active }).eq('id', toggleButton.dataset.toggleService);
    if (error) notify(message, failMessage(error)); else { await loadAdminData(); notify(message, active ? 'Услуга возвращена в меню.' : 'Услуга скрыта из меню.'); }
  });
  serviceForm.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(serviceForm);
    const serviceId = String(data.get('service_id') || '');
    const values = {
      name: String(data.get('name') || '').trim(),
      description: String(data.get('description') || '').trim(),
      price_kgs: Number(data.get('price_kgs')),
      duration_minutes: Number(data.get('duration_minutes'))
    };
    if (!values.name || !Number.isInteger(values.price_kgs) || values.price_kgs < 0 || !Number.isInteger(values.duration_minutes) || values.duration_minutes < 15 || values.duration_minutes > 240) {
      notify(message, 'Проверьте название, цену и продолжительность услуги.'); return;
    }
    const result = serviceId
      ? await client.from('services').update(values).eq('id', serviceId)
      : await client.from('services').insert({ ...values, slug: `service-${crypto.randomUUID().slice(0, 8)}`, active: true, sort_order: services.reduce((max, service) => Math.max(max, Number(service.sort_order) || 0), 0) + 1 });
    if (result.error) { notify(message, failMessage(result.error)); return; }
    resetServiceForm();
    await loadAdminData();
    notify(message, serviceId ? 'Услуга обновлена.' : 'Услуга добавлена в меню.');
  });

  ['#upcoming-list', '#day-bookings'].forEach(selector => {
    document.querySelector(selector).addEventListener('click', event => {
      const button = event.target.closest('[data-cancel-appointment]');
      if (button) void cancelAppointment(button.dataset.cancelAppointment);
    });
  });
})();
