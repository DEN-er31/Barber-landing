(() => {
  const config = window.BLACKWOOD_SUPABASE_CONFIG || {};
  const demoServices = [
    { id: 'demo-service-mens-haircut', name: 'Мужская стрижка', description: 'Форма, текстура и укладка с учётом твоего ритма.', duration_minutes: 45, price_kgs: 1200 },
    { id: 'demo-service-beard-trim', name: 'Стрижка бороды', description: 'Чёткий контур и аккуратная форма.', duration_minutes: 30, price_kgs: 700 },
    { id: 'demo-service-haircut-and-beard', name: 'Стрижка + борода', description: 'Полный ритуал: свежая форма и ухоженная борода.', duration_minutes: 70, price_kgs: 1700 }
  ];
  const demoBarbers = [
    { id: 'demo-barber-timur', display_name: 'Тимур Исмаилов', bio: 'Демонстрационный профиль мастера.', demo_profile: true },
    { id: 'demo-barber-arsen', display_name: 'Арсен Муратов', bio: 'Демонстрационный профиль мастера.', demo_profile: true },
    { id: 'demo-barber-bek', display_name: 'Бек Садыков', bio: 'Демонстрационный профиль мастера.', demo_profile: true }
  ];
  const dialog = document.querySelector('#booking-dialog');
  if (!dialog) return;
  const serviceRoot = document.querySelector('#service-choices');
  const barberRoot = document.querySelector('#barber-choices');
  const dateInput = document.querySelector('#booking-date');
  const slotsRoot = document.querySelector('#time-slots');
  const alertBox = document.querySelector('#booking-alert');
  const progress = document.querySelector('.progress-line i');
  const stepLabel = document.querySelector('.step-label');
  const steps = [...document.querySelectorAll('.booking-step')];
  const supabaseUrl = typeof config.url === 'string' ? config.url.replace(/\/$/, '') : '';
  const publishableKey = typeof config.publishableKey === 'string' ? config.publishableKey : '';
  const backendReady = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) && publishableKey.length > 20;
  let services = demoServices;
  let barbers = demoBarbers;
  let isDemoCatalog = true;
  let catalogLoading = false;
  let currentStep = 1;
  let captchaToken = '';
  let widgetId = null;
  let bookingSubmissionId = '';
  let busy = false;
  const selection = { service: null, barber: null, date: '', time: '', customer: null };

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const money = value => `${new Intl.NumberFormat('ru-RU').format(Number(value))} сом`;
  const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const localDate = value => {
    const date = new Date(`${value}T12:00:00+06:00`);
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  };
  const localTime = value => {
    const date = new Date(value);
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit' }).format(date);
  };
  function showAlert(message) { alertBox.textContent = message; alertBox.hidden = false; }
  function clearAlert() { alertBox.textContent = ''; alertBox.hidden = true; }
  function apiHeaders() { return { apikey: publishableKey, Authorization: `Bearer ${publishableKey}`, 'Content-Type': 'application/json' }; }
  async function endpoint(name, options = {}) {
    if (!backendReady) throw new Error('Онлайн-запись пока не подключена. Добавьте URL и публичный ключ Supabase в dist/booking-config.js, примените миграцию и настройте Edge Functions.');
    const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, { ...options, headers: { ...apiHeaders(), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || 'Не удалось связаться с сервисом записи.');
    return payload;
  }

  function renderServices() {
    serviceRoot.innerHTML = services.map(item => `<button class="choice-card" type="button" ${catalogLoading ? 'disabled' : ''} data-service-id="${escapeHTML(item.id)}" aria-pressed="false"><h3>${escapeHTML(item.name)}</h3><p>${escapeHTML(item.description || '')}</p><p class="choice-meta">${Number(item.duration_minutes)} МИН</p><strong class="choice-price">${money(item.price_kgs)}</strong></button>`).join('');
    document.querySelector('#demo-catalog-note').hidden = !isDemoCatalog;
  }
  function renderBarbers() {
    barberRoot.innerHTML = barbers.map(item => `<button class="choice-card" type="button" ${catalogLoading ? 'disabled' : ''} data-barber-id="${escapeHTML(item.id)}" aria-pressed="false"><h3>${escapeHTML(item.display_name)}</h3><p>${escapeHTML(item.bio || 'Мастер BLACKWOOD')}</p>${item.demo_profile ? '<span class="demo-tag">ДЕМО-ПРОФИЛЬ</span>' : ''}</button>`).join('');
    document.querySelector('#demo-barber-note').hidden = !barbers.some(item => item.demo_profile) && !isDemoCatalog;
  }
  async function loadCatalog() {
    if (!backendReady) return;
    catalogLoading = true; renderServices(); renderBarbers();
    try {
      const catalog = await endpoint('availability');
      if (Array.isArray(catalog.services) && catalog.services.length && Array.isArray(catalog.barbers) && catalog.barbers.length) {
        services = catalog.services;
        barbers = catalog.barbers;
        isDemoCatalog = false;
      } else {
        isDemoCatalog = true;
      }
    } catch (error) {
      isDemoCatalog = true;
      console.warn('BLACKWOOD catalog unavailable:', error.message);
    } finally {
      catalogLoading = false; renderServices(); renderBarbers();
      document.querySelector('[data-step="1"] .next-step').disabled = !selection.service;
      document.querySelector('[data-step="2"] .next-step').disabled = !selection.barber;
    }
  }
  function showStep(number) {
    currentStep = number;
    steps.forEach(section => { section.hidden = Number(section.dataset.step) !== number; });
    document.querySelector('#booking-success').hidden = true;
    progress.style.width = `${(number / 6) * 100}%`;
    stepLabel.textContent = `ШАГ ${number} ИЗ 6`;
    dialog.querySelector('.booking-shell').scrollTop = 0;
    clearAlert();
    if (number === 6) { renderSummary(); renderCaptcha(); }
  }
  function renderSummary(target = '#booking-summary') {
    const node = document.querySelector(target);
    if (!selection.service || !selection.barber || !selection.customer) return;
    const rows = [
      ['Услуга', selection.service.name], ['Специалист', selection.barber.display_name],
      ['Дата', localDate(selection.date)], ['Время', selection.time],
      ['Длительность', `${selection.service.duration_minutes} минут`], ['Стоимость', money(selection.service.price_kgs)],
      ['Клиент', `${selection.customer.firstName} ${selection.customer.lastName}`]
    ];
    node.className = 'booking-summary';
    node.innerHTML = rows.map(([label, value]) => `<div class="summary-row"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`).join('');
  }
  function setBusy(value) {
    busy = value;
    const button = document.querySelector('#confirm-booking');
    button.disabled = value || !captchaToken || !backendReady;
    button.innerHTML = value ? 'Сохраняем…' : 'Подтвердить запись <span>↗</span>';
  }
  function renderCaptcha() {
    captchaToken = '';
    if (widgetId !== null && window.turnstile) { try { window.turnstile.reset(widgetId); } catch {} }
    setBusy(false);
    const hint = document.querySelector('#captcha-hint');
    if (!config.turnstileSiteKey) {
      hint.textContent = 'CAPTCHA не настроена. Добавьте публичный site key Turnstile в конфигурацию сайта.';
      return;
    }
    hint.textContent = 'Подтверди, что ты не робот.';
    const mount = () => {
      if (currentStep !== 6 || !window.turnstile || widgetId !== null) return;
      widgetId = window.turnstile.render('#turnstile-widget', {
        sitekey: config.turnstileSiteKey,
        callback: token => { captchaToken = token; setBusy(false); },
        'expired-callback': () => { captchaToken = ''; setBusy(false); },
        'error-callback': () => { captchaToken = ''; setBusy(false); hint.textContent = 'Проверка CAPTCHA не загрузилась. Обнови страницу и попробуй снова.'; }
      });
    };
    mount();
    if (!window.turnstile) window.addEventListener('load', mount, { once: true });
    if (!window.turnstile) window.setTimeout(mount, 1500);
  }
  function resetFlow() {
    currentStep = 1; selection.service = null; selection.barber = null; selection.date = ''; selection.time = ''; selection.customer = null;
    bookingSubmissionId = ''; captchaToken = ''; busy = false;
    if (widgetId !== null && window.turnstile) { try { window.turnstile.remove(widgetId); } catch {} widgetId = null; }
    dateInput.value = ''; dateInput.min = localToday();
    const max = new Date(`${localToday()}T12:00:00+06:00`); max.setDate(max.getDate() + 90);
    dateInput.max = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit' }).format(max);
    document.querySelectorAll('.choice-card').forEach(card => card.setAttribute('aria-pressed', 'false'));
    document.querySelectorAll('.next-step').forEach(button => { button.disabled = true; });
    document.querySelectorAll('.customer-fields input').forEach(input => { input.value = ''; });
    document.querySelector('[name="website"]').value = '';
    document.querySelector('#confirm-booking').disabled = true;
    document.querySelector('#booking-success').hidden = true;
    document.querySelector('#demo-catalog-note').hidden = !isDemoCatalog;
    document.querySelector('#demo-barber-note').hidden = !isDemoCatalog && !barbers.some(item => item.demo_profile);
    slotsRoot.innerHTML = '';
    showStep(1);
  }
  function openBooking() {
    resetFlow(); catalogLoading = backendReady; renderServices(); renderBarbers();
    if (!dialog.open) dialog.showModal();
    void loadCatalog();
  }

  document.querySelectorAll('.js-booking-trigger').forEach(button => button.addEventListener('click', openBooking));
  document.querySelector('.booking-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { if (widgetId !== null && window.turnstile) { try { window.turnstile.remove(widgetId); } catch {} widgetId = null; } });
  document.querySelector('#finish-booking').addEventListener('click', () => dialog.close());

  serviceRoot.addEventListener('click', event => {
    const card = event.target.closest('[data-service-id]'); if (!card) return;
    serviceRoot.querySelectorAll('[data-service-id]').forEach(item => item.setAttribute('aria-pressed', String(item === card)));
    selection.service = services.find(item => item.id === card.dataset.serviceId) || null;
    selection.barber = null; selection.date = ''; selection.time = '';
    dateInput.value = ''; slotsRoot.innerHTML = '';
    renderBarbers(); document.querySelector('[data-step="2"] .next-step').disabled = true;
    document.querySelector('[data-step="3"] .next-step').disabled = true;
    document.querySelector('[data-step="1"] .next-step').disabled = !selection.service;
  });
  barberRoot.addEventListener('click', event => {
    const card = event.target.closest('[data-barber-id]'); if (!card) return;
    barberRoot.querySelectorAll('[data-barber-id]').forEach(item => item.setAttribute('aria-pressed', String(item === card)));
    selection.barber = barbers.find(item => item.id === card.dataset.barberId) || null;
    selection.date = ''; selection.time = ''; dateInput.value = ''; slotsRoot.innerHTML = '';
    document.querySelector('[data-step="3"] .next-step').disabled = true;
    document.querySelector('[data-step="2"] .next-step').disabled = !selection.barber;
  });
  dateInput.min = localToday();
  dateInput.addEventListener('change', () => {
    selection.date = dateInput.value; selection.time = '';
    document.querySelector('[data-step="3"] .next-step').disabled = !selection.date;
  });
  document.querySelectorAll('.prev-step').forEach(button => button.addEventListener('click', () => showStep(Math.max(1, currentStep - 1))));
  document.querySelectorAll('.next-step').forEach(button => button.addEventListener('click', async () => {
    if (currentStep === 3) {
      if (!selection.date || !selection.service || !selection.barber) return;
      if (!backendReady || isDemoCatalog) { showAlert('Свободное время пока недоступно: подключите Supabase и замените демо-каталог актуальными данными.'); return; }
      showStep(4); slotsRoot.innerHTML = '<p class="slots-message">Проверяем свободное время…</p>';
      try {
        const result = await endpoint('availability', { method: 'POST', body: JSON.stringify({ serviceId: selection.service.id, barberId: selection.barber.id, date: selection.date }) });
        if (!result.slots?.length) { slotsRoot.innerHTML = '<p class="slots-message">На эту дату свободных интервалов нет. Выбери другой день.</p>'; return; }
        slotsRoot.innerHTML = result.slots.map(slot => `<button class="slot-button" type="button" data-time="${escapeHTML(slot.local_time)}" aria-pressed="false">${escapeHTML(slot.local_time)}</button>`).join('');
      } catch (error) { slotsRoot.innerHTML = ''; showStep(3); showAlert(error.message); }
      return;
    }
    if (currentStep === 5) {
      const inputs = [...document.querySelectorAll('.customer-fields input')];
      const invalid = inputs.find(input => !input.checkValidity());
      if (invalid) { invalid.reportValidity(); return; }
      selection.customer = Object.fromEntries(inputs.map(input => [input.name, input.value.trim()]));
    }
    showStep(Math.min(6, currentStep + 1));
  }));
  slotsRoot.addEventListener('click', event => {
    const button = event.target.closest('[data-time]'); if (!button) return;
    slotsRoot.querySelectorAll('[data-time]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    selection.time = button.dataset.time;
    document.querySelector('[data-step="4"] .next-step').disabled = !selection.time;
  });

  document.querySelector('#confirm-booking').addEventListener('click', async () => {
    if (busy || !backendReady || !captchaToken || !selection.customer || !selection.time) return;
    if (!bookingSubmissionId) bookingSubmissionId = crypto.randomUUID();
    setBusy(true); clearAlert();
    try {
      const result = await endpoint('create-booking', { method: 'POST', body: JSON.stringify({
        serviceId: selection.service.id, barberId: selection.barber.id, date: selection.date, time: selection.time,
        ...selection.customer, website: document.querySelector('[name="website"]').value,
        submissionId: bookingSubmissionId, turnstileToken: captchaToken
      }) });
      const booking = result.booking;
      steps.forEach(section => { section.hidden = true; });
      document.querySelector('.booking-progress').hidden = true;
      document.querySelector('.booking-alert').hidden = true;
      document.querySelector('#success-name').textContent = booking.customer_first_name;
      document.querySelector('#success-details').innerHTML = [
        ['Код записи', booking.booking_code], ['Услуга', booking.service_name], ['Специалист', booking.barber_name],
        ['Дата', localDate(selection.date)], ['Время', localTime(booking.starts_at)],
        ['Стоимость', money(booking.price_kgs)]
      ].map(([label, value]) => `<div class="summary-row"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`).join('');
      document.querySelector('#success-details').className = 'booking-summary';
      document.querySelector('#booking-success').hidden = false;
      dialog.querySelector('.booking-shell').scrollTop = 0;
    } catch (error) {
      captchaToken = '';
      showAlert(error.message);
      if (window.turnstile && widgetId !== null) { try { window.turnstile.reset(widgetId); } catch {} }
      setBusy(false);
    }
  });
  renderServices(); renderBarbers();
})();
