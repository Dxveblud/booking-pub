/**
 * Flusso di prenotazione: servizio → (con chi) → giorno → orario → dati → riepilogo → fatto.
 * Il passo "con chi" compare solo se il servizio lo fanno almeno due collaboratori.
 * Gira dentro l'iframe del widget (o da solo aprendo /widget/booking.html).
 * Parametri URL: ?service=<id> per partire da un servizio già scelto.
 */
(function () {
  'use strict';

  var STEPS = ['service', 'staff', 'day', 'time', 'details', 'confirm', 'done'];
  var STEP_LABELS = {
    service: 'Scegli il servizio',
    staff: 'Con chi?',
    day: 'Scegli il giorno',
    time: "Scegli l'orario",
    details: 'I tuoi dati',
    confirm: 'Controlla e conferma',
    done: 'Prenotazione confermata',
  };
  var PROGRESS = { service: 0, staff: 0, day: 1, time: 2, details: 3, confirm: 4, done: 4 };

  var params = new URLSearchParams(window.location.search);
  var SHOP = params.get('shop') || '';
  var isEmbedded = window.parent !== window;
  var state = {
    business: null, services: [], hours: {}, service: null, date: null, time: null, customer: null, booking: null, step: 'service',
    staffList: [], // collaboratori che fanno il servizio scelto (il passo compare se sono almeno 2)
    staff: null, // collaboratore scelto; null = chiunque
    category: '', query: '', // filtri della lista servizi ('' = tutte le categorie)
  };

  var $ = function (id) { return document.getElementById(id); };

  /** Logo di ripiego: l'iniziale del negozio nei suoi colori. */
  function monogram(name, color) {
    var letter = (String(name || '').trim().charAt(0) || '•').toUpperCase().replace(/[^A-Z0-9À-Ý]/, '•');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="' + (color || '#1c1917') +
      '"/><text x="32" y="43" font-family="Georgia,serif" font-size="32" fill="#fff" text-anchor="middle">' + letter + '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }


  /* ----------------------------- Utility ------------------------------ */

  function api(path, options) {
    options = options || {};
    var init = { method: options.method || 'GET', headers: { Accept: 'application/json' } };
    if (options.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    // Ogni chiamata indica il negozio (?shop=…)
    var url = '/api' + path + (SHOP ? (path.indexOf('?') >= 0 ? '&' : '?') + 'shop=' + encodeURIComponent(SHOP) : '');
    return fetch(url, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((data.error && data.error.message) || 'Errore di rete, riprova.');
          err.code = data.error && data.error.code;
          throw err;
        }
        return data;
      });
    });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  function locale() { return (state.business && state.business.locale) || 'it-IT'; }

  function formatPrice(value) {
    var b = state.business || {};
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: b.currency || 'EUR', minimumFractionDigits: value % 1 ? 2 : 0 }).format(value);
  }

  /** "2026-10-20" → Date a mezzogiorno (evita problemi di fuso) */
  function parseDate(str) { return new Date(str + 'T12:00:00'); }
  function formatDate(str, opts) { return parseDate(str).toLocaleDateString(locale(), opts); }
  function longDate(str) { return formatDate(str, { weekday: 'long', day: 'numeric', month: 'long' }); }
  function toMin(t) { var p = t.split(':'); return +p[0] * 60 + +p[1]; }

  function setLoading(on) { $('bk-loading').hidden = !on; }
  function showError(id, msg) { var n = $(id); n.textContent = msg || ''; n.hidden = !msg; }

  function chip(label, value) { return el('span', { class: 'bk-chip' }, [label + ' ', el('b', { text: value })]); }

  function renderChosen() {
    var chips = [];
    var withStaff = state.staffList.length > 1;
    if (state.service) chips.push(function () { return chip('', state.service.name); });
    if (withStaff) chips.push(function () { return chip('con', state.staff ? state.staff.name : 'chiunque'); });
    if (state.date) chips.push(function () { return chip('', formatDate(state.date, { weekday: 'short', day: 'numeric', month: 'short' })); });
    if (state.time) chips.push(function () { return chip('ore', state.time); });
    var extra = withStaff ? 1 : 0;
    var targets = { 'bk-chosen-staff': 1, 'bk-chosen-day': 1 + extra, 'bk-chosen-time': 2 + extra, 'bk-chosen-details': 3 + extra };
    Object.keys(targets).forEach(function (id) {
      var box = $(id);
      box.innerHTML = '';
      chips.slice(0, targets[id]).forEach(function (make) { box.appendChild(make()); });
    });
  }

  /* ---------------------------- Navigazione --------------------------- */

  function goTo(step) {
    state.step = step;
    document.querySelectorAll('.bk-step').forEach(function (s) { s.hidden = s.getAttribute('data-step') !== step; });
    $('bk-step-label').textContent = STEP_LABELS[step];
    $('bk-back').hidden = step === 'service' || step === 'done';
    $('bk-logo').hidden = !$('bk-back').hidden;

    var p = PROGRESS[step];
    document.querySelectorAll('#bk-steps li').forEach(function (li, i) {
      li.classList.toggle('done', i < p || step === 'done');
      li.classList.toggle('current', i === p && step !== 'done' && step !== 'confirm');
    });

    // Pulsante in basso solo dove serve
    var footer = $('bk-footer');
    footer.hidden = !(step === 'details' || step === 'confirm');
    $('bk-next').textContent = step === 'confirm' ? 'Conferma prenotazione' : 'Continua';

    renderChosen();
    $('bk-body').scrollTop = 0;
  }

  function back() {
    var index = STEPS.indexOf(state.step);
    if (index <= 0) return;
    var prev = STEPS[index - 1];
    // Il passo "con chi" esiste solo se c'è da scegliere
    if (prev === 'staff' && state.staffList.length < 2) prev = 'service';
    goTo(prev);
  }

  /** ?staffId=… da aggiungere alle richieste di disponibilità (vuoto = chiunque). */
  function staffQuery() { return state.staff ? '&staffId=' + encodeURIComponent(state.staff.id) : ''; }

  /* --------------------------- 1. Servizio ---------------------------- */

  // "Massaggio Tuina 60 min" → "Massaggio Tuina": le durate dello stesso
  // trattamento diventano una sola scheda con i minuti da toccare
  var DURATION_SUFFIX = /\s*[-–·,(]?\s*\d+\s*(min|minuti|')\)?\s*$/i;

  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function groupServices(services) {
    var groups = [];
    var byKey = {};
    services.forEach(function (s) {
      var base = s.name.replace(DURATION_SUFFIX, '').trim() || s.name;
      var key = norm(s.category) + '|' + norm(base);
      if (!byKey[key]) {
        byKey[key] = { name: base, category: s.category || '', description: s.description || '', variants: [] };
        groups.push(byKey[key]);
      }
      byKey[key].variants.push(s);
    });
    groups.forEach(function (g) {
      if (g.variants.length === 1) g.name = g.variants[0].name; // da solo tiene il suo nome
      g.variants.sort(function (a, b) { return a.durationMinutes - b.durationMinutes; });
    });
    return groups;
  }

  function serviceCard(s) {
    var btn = el('button', { type: 'button', class: 'bk-service' }, [
      el('span', { class: 'bk-service-name', text: s.name }),
      el('span', { class: 'bk-service-price', text: formatPrice(s.price) }),
      el('span', { class: 'bk-service-desc', text: s.description || '' }),
      el('span', { class: 'bk-service-time', text: '⏱ ' + s.durationMinutes + ' min' }),
    ]);
    btn.addEventListener('click', function () { selectService(s); });
    return btn;
  }

  function variantCard(g) {
    var from = Math.min.apply(null, g.variants.map(function (v) { return v.price; }));
    var durations = el('div', { class: 'bk-durations' });
    g.variants.forEach(function (v) {
      var b = el('button', { type: 'button', class: 'bk-duration', 'aria-label': v.name + ', ' + formatPrice(v.price) }, [
        el('b', { text: v.durationMinutes + ' min' }),
        el('small', { text: formatPrice(v.price) }),
      ]);
      b.addEventListener('click', function () { selectService(v); });
      durations.appendChild(b);
    });
    return el('div', { class: 'bk-service bk-variants' }, [
      el('span', { class: 'bk-service-name', text: g.name }),
      el('span', { class: 'bk-service-price', text: 'da ' + formatPrice(from) }),
      g.description ? el('span', { class: 'bk-service-desc', text: g.description }) : null,
      durations,
    ]);
  }

  /** Categorie e ricerca: compaiono solo se servono (più categorie, tanti servizi). */
  function renderFilters(categories, count) {
    var cats = $('bk-cats');
    cats.innerHTML = '';
    cats.hidden = categories.length < 2;
    [''].concat(categories).forEach(function (c) {
      var b = el('button', { type: 'button', class: 'bk-cat', 'aria-pressed': String(state.category === c), text: c || 'Tutti' });
      b.addEventListener('click', function () {
        state.category = c;
        renderServices();
        $('bk-body').scrollTop = 0;
      });
      cats.appendChild(b);
    });
    $('bk-search').hidden = count < 8;
    $('bk-filters').hidden = cats.hidden && $('bk-search').hidden;
    var active = cats.querySelector('[aria-pressed="true"]');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function renderServices() {
    var list = $('bk-services');
    list.innerHTML = '';
    if (!state.services.length) {
      $('bk-filters').hidden = true;
      list.appendChild(el('li', { class: 'bk-empty', text: 'Nessun servizio prenotabile al momento.' }));
      return;
    }
    var groups = groupServices(state.services);
    var categories = [];
    groups.forEach(function (g) { if (g.category && categories.indexOf(g.category) < 0) categories.push(g.category); });
    if (categories.indexOf(state.category) < 0) state.category = '';
    renderFilters(categories, groups.length);

    var q = norm(state.query).trim();
    var shown = groups.filter(function (g) {
      return (!state.category || g.category === state.category) &&
        (!q || norm(g.name + ' ' + g.category + ' ' + g.description).indexOf(q) >= 0);
    });
    if (!shown.length) {
      list.appendChild(el('li', { class: 'bk-empty', text: 'Nessun servizio trovato.' }));
      return;
    }
    // In "Tutti" i servizi stanno sotto il titolo della loro categoria
    var withTitles = categories.length > 1 && !state.category;
    if (withTitles) {
      var rank = function (g) { return g.category ? categories.indexOf(g.category) : categories.length; };
      shown = shown.map(function (g, i) { return { g: g, i: i }; })
        .sort(function (a, b) { return rank(a.g) - rank(b.g) || a.i - b.i; })
        .map(function (x) { return x.g; });
    }
    var last = null;
    shown.forEach(function (g) {
      if (withTitles && g.category !== last) {
        list.appendChild(el('li', { class: 'bk-cat-title', text: g.category || 'Altro' }));
        last = g.category;
      }
      list.appendChild(el('li', {}, [g.variants.length > 1 ? variantCard(g) : serviceCard(g.variants[0])]));
    });
  }

  function selectService(service) {
    state.service = service;
    state.date = state.time = null;
    state.staff = null;
    setLoading(true);
    return api('/staff?serviceId=' + encodeURIComponent(service.id))
      .then(function (list) {
        state.staffList = list;
        if (list.length > 1) { renderStaff(); goTo('staff'); return null; }
        return loadDays();
      })
      .catch(function (err) { alert(err.message); })
      .finally(function () { setLoading(false); });
  }

  function loadDays() {
    return api('/availability/days?serviceId=' + encodeURIComponent(state.service.id) + staffQuery())
      .then(function (data) { renderDays(data.days); goTo('day'); });
  }

  /* ------------------------- 1b. Con chi? ----------------------------- */

  function renderStaff() {
    var list = $('bk-staff');
    list.innerHTML = '';
    var options = [{ id: '', name: 'Chiunque', hint: 'Il primo libero: più orari tra cui scegliere' }].concat(state.staffList);
    options.forEach(function (s) {
      var initial = s.id ? s.name.trim().charAt(0).toUpperCase() : '★';
      var btn = el('button', { type: 'button', class: 'bk-service bk-person' + (s.id ? '' : ' any') }, [
        el('span', { class: 'bk-avatar', 'aria-hidden': 'true', text: initial }),
        el('span', { class: 'bk-service-name', text: s.name }),
        s.hint ? el('span', { class: 'bk-service-desc', text: s.hint }) : null,
      ]);
      btn.addEventListener('click', function () {
        state.staff = s.id ? s : null;
        state.date = state.time = null;
        setLoading(true);
        loadDays().catch(function (err) { alert(err.message); }).finally(function () { setLoading(false); });
      });
      list.appendChild(el('li', {}, [btn]));
    });
  }

  /* ---------------------------- 2. Giorno ----------------------------- */

  function renderDays(days) {
    var box = $('bk-days');
    box.innerHTML = '';
    var any = days.some(function (d) { return d.available > 0; });
    $('bk-days-empty').hidden = any;
    if (!any) return;

    // "Oggi"/"Domani" calcolati nel fuso orario dell'attività
    var tz = (state.business && state.business.timezone) || 'Europe/Rome';
    var first = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    var tomorrow = parseDate(first); tomorrow.setDate(tomorrow.getDate() + 1);
    var second = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
    var lastMonth = '';
    var grid = null;
    days.forEach(function (d) {
      var month = formatDate(d.date, { month: 'long', year: 'numeric' });
      if (month !== lastMonth) {
        box.appendChild(el('p', { class: 'bk-month', text: month }));
        grid = el('div', { class: 'bk-days-grid' });
        box.appendChild(grid);
        lastMonth = month;
      }
      var weekday = parseDate(d.date).getDay();
      var closed = !(state.hours[weekday] || []).length;
      var label = d.date === first ? 'Oggi' : d.date === second ? 'Domani' : formatDate(d.date, { weekday: 'short' });
      var info = closed ? 'chiuso' : !d.available ? 'completo' : d.available <= 3 ? 'ultimi ' + d.available : d.available + ' liberi';

      var btn = el('button', { type: 'button', class: 'bk-day', 'aria-label': longDate(d.date) + ', ' + info }, [
        el('small', { text: label }),
        el('b', { text: String(parseDate(d.date).getDate()) }),
        el('em', { class: d.available && d.available <= 3 ? 'few' : '', text: info }),
      ]);
      if (!d.available) btn.disabled = true;
      btn.addEventListener('click', function () { selectDay(d.date); });
      grid.appendChild(btn);
    });
  }

  function selectDay(date) {
    state.date = date;
    state.time = null;
    setLoading(true);
    loadSlots()
      .then(function () { goTo('time'); })
      .catch(function (err) { alert(err.message); })
      .finally(function () { setLoading(false); });
  }

  /* ---------------------------- 3. Orario ----------------------------- */

  function loadSlots() {
    return api('/availability?serviceId=' + encodeURIComponent(state.service.id) + '&date=' + state.date + staffQuery()).then(function (data) {
      var box = $('bk-slots');
      box.innerHTML = '';
      $('bk-slots-empty').hidden = data.slots.length > 0;

      var periods = [
        { name: 'Mattina', test: function (m) { return m < 13 * 60; } },
        { name: 'Pomeriggio', test: function (m) { return m >= 13 * 60 && m < 17 * 60; } },
        { name: 'Sera', test: function (m) { return m >= 17 * 60; } },
      ];
      periods.forEach(function (p) {
        var times = data.slots.filter(function (t) { return p.test(toMin(t)); });
        if (!times.length) return;
        var grid = el('div', { class: 'bk-slots' });
        times.forEach(function (time) {
          var btn = el('button', { type: 'button', class: 'bk-slot' + (time === state.time ? ' selected' : ''), text: time });
          btn.addEventListener('click', function () {
            state.time = time;
            goTo('details');
            var name = $('bk-form').elements.name;
            if (!name.value) name.focus();
          });
          grid.appendChild(btn);
        });
        box.appendChild(el('div', { class: 'bk-period' }, [el('h3', { text: p.name }), grid]));
      });
    });
  }

  /* ----------------------------- 4. Dati ------------------------------ */

  function submitDetails() {
    var f = $('bk-form').elements;
    var name = f.name.value.trim();
    var phone = f.phone.value.trim();
    var email = f.email.value.trim();
    if (name.length < 2) { f.name.focus(); return showError('bk-form-error', 'Inserisci nome e cognome.'); }
    if (!/^\+?[0-9\s().-]{6,20}$/.test(phone)) { f.phone.focus(); return showError('bk-form-error', 'Inserisci un numero di cellulare valido.'); }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { f.email.focus(); return showError('bk-form-error', "Controlla l'indirizzo email (oppure lascialo vuoto)."); }
    showError('bk-form-error', '');
    state.customer = { name: name, phone: phone, email: email, notes: f.notes.value.trim(), website: f.website.value };
    renderSummary();
    goTo('confirm');
  }

  /* --------------------------- 5. Riepilogo --------------------------- */

  function endTime() { return fromMin(toMin(state.time) + state.service.durationMinutes); }
  function fromMin(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }

  function renderSummary() {
    var rows = [
      ['Quando', longDate(state.date)],
      ['Orario', state.time + ' – ' + endTime()],
    ];
    if (state.staffList.length > 1) rows.push(['Con', state.staff ? state.staff.name : 'Chiunque sia libero']);
    rows = rows.concat([
      ['Nome', state.customer.name],
      ['Cellulare', state.customer.phone],
    ]);
    if (state.customer.email) rows.push(['Email', state.customer.email]);
    if (state.customer.notes) rows.push(['Note', state.customer.notes]);

    var dl = el('dl');
    rows.forEach(function (r) { dl.appendChild(el('div', {}, [el('dt', { text: r[0] }), el('dd', { text: r[1] })])); });
    dl.appendChild(el('div', { class: 'total' }, [el('dt', { text: 'Totale in negozio' }), el('dd', { text: formatPrice(state.service.price) })]));

    var box = $('bk-summary');
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'bk-summary-head' }, [
      el('small', { text: state.service.durationMinutes + ' minuti' }),
      el('strong', { text: state.service.name }),
    ]));
    box.appendChild(dl);
    box.appendChild(el('div', { class: 'bk-summary-note', text: 'Si paga in negozio. Se non puoi venire, avvisaci per liberare il posto.' }));
    showError('bk-confirm-error', '');
  }

  function confirmBooking() {
    var btn = $('bk-next');
    btn.disabled = true;
    setLoading(true);
    api('/bookings', {
      method: 'POST',
      body: {
        serviceId: state.service.id,
        date: state.date,
        time: state.time,
        customer: { name: state.customer.name, phone: state.customer.phone, email: state.customer.email },
        notes: state.customer.notes,
        website: state.customer.website,
        staffId: state.staff ? state.staff.id : undefined,
      },
    })
      .then(function (b) {
        state.booking = b;
        var first = state.customer.name.split(' ')[0];
        $('bk-done-text').textContent = 'Grazie ' + first + ', il tuo posto è riservato.';
        var ticket = $('bk-ticket');
        ticket.innerHTML = '';
        ticket.appendChild(el('strong', { text: b.serviceName }));
        ticket.appendChild(el('span', { text: longDate(b.date) + ' · ' + b.start + '–' + b.end }));
        if (b.staffName) ticket.appendChild(el('span', { text: 'Con ' + b.staffName }));
        if (state.business.address) ticket.appendChild(el('span', { text: state.business.address }));
        $('bk-done-email').textContent = state.customer.email ? 'Ti abbiamo mandato la conferma a ' + state.customer.email + '.' : '';
        $('bk-done-email').hidden = !state.customer.email;
        $('bk-manage').hidden = !b.manageUrl;
        if (b.manageUrl) $('bk-manage').href = b.manageUrl;
        goTo('done');
      })
      .catch(function (err) {
        if (err.code === 'SLOT_TAKEN' || err.code === 'SLOT_UNAVAILABLE') {
          // Qualcuno ha prenotato nel frattempo: ricarica gli orari
          state.time = null;
          return loadSlots().then(function () {
            goTo('time');
            alert("Peccato, quell'orario è appena stato prenotato da qualcun altro. Scegline un altro.");
          });
        }
        showError('bk-confirm-error', err.message);
      })
      .finally(function () { btn.disabled = false; setLoading(false); });
  }

  /* ---------------------------- 6. Fatto ------------------------------ */

  /** File .ics per aggiungere l'appuntamento al calendario del telefono. */
  function downloadIcs() {
    var b = state.booking;
    if (!b) return;
    var esc = function (s) { return String(s || '').replace(/[\\,;]/g, function (c) { return '\\' + c; }); };
    var stamp = function (date, time) { return date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00'; };
    var now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    var ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//booking-template//IT', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + b.id + '@booking',
      'DTSTAMP:' + now,
      'DTSTART:' + stamp(b.date, b.start),
      'DTEND:' + stamp(b.date, b.end),
      'SUMMARY:' + esc(b.serviceName + ' · ' + state.business.name),
      'LOCATION:' + esc(state.business.address),
      'DESCRIPTION:' + esc('Prenotazione a nome di ' + b.customerName + (state.business.phone ? '. Per modifiche: ' + state.business.phone : '')),
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Promemoria appuntamento', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    var url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    var a = el('a', { href: url, download: 'appuntamento.ics' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function restart() {
    state.service = state.date = state.time = state.booking = state.staff = null;
    state.staffList = [];
    $('bk-manage').hidden = true;
    goTo('service');
  }

  /* ------------------------------- Avvio ------------------------------ */

  function applyBranding(b) {
    $('bk-business').textContent = b.name;
    document.title = 'Prenota · ' + b.name;
    $('bk-logo').src = b.logo || monogram(b.name, b.primaryColor);
    $('bk-privacy-link').href = '/s/' + encodeURIComponent(b.slug) + '/privacy';
    $('bk-email-field').hidden = !(b.features && b.features.emailConfirmation);
    var root = document.documentElement.style;
    if (b.primaryColor) root.setProperty('--ink', b.primaryColor);
    if (b.accentColor) root.setProperty('--accent', b.accentColor);
  }

  function init() {
    if (isEmbedded) {
      $('bk-close').hidden = false;
      var closeWidget = function () { window.parent.postMessage({ source: 'booking-widget', type: 'close' }, '*'); };
      $('bk-close').addEventListener('click', closeWidget);
      // Con il cursore dentro il widget, Esc arriva qui e non alla pagina ospite
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); closeWidget(); }
      });
    }
    $('bk-back').addEventListener('click', back);
    $('bk-form').addEventListener('submit', function (e) { e.preventDefault(); submitDetails(); });
    $('bk-next').addEventListener('click', function () {
      if (state.step === 'details') submitDetails();
      else if (state.step === 'confirm') confirmBooking();
    });
    $('bk-ics').addEventListener('click', downloadIcs);
    $('bk-restart').addEventListener('click', restart);
    $('bk-search').addEventListener('input', function (e) { state.query = e.target.value; renderServices(); });

    goTo('service');
    setLoading(true);
    Promise.all([api('/business'), api('/services'), api('/opening-hours')])
      .then(function (res) {
        state.business = res[0];
        state.services = res[1];
        state.hours = res[2];
        applyBranding(res[0]);
        renderServices();
        // Servizio già scelto dal sito (?service=…)
        var pre = params.get('service') && state.services.find(function (s) { return s.id === params.get('service'); });
        if (pre) return selectService(pre);
        return null;
      })
      .catch(function (err) {
        $('bk-services').innerHTML = '';
        var msg = err.code === 'SHOP_NOT_FOUND'
          ? 'Le prenotazioni online per questo negozio non sono attive.'
          : 'Impossibile caricare i servizi. Riprova tra poco.';
        $('bk-services').appendChild(el('li', { class: 'bk-empty', text: msg }));
      })
      .finally(function () { setLoading(false); });
  }

  init();
})();
