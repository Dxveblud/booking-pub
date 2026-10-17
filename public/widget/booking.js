/**
 * Flusso di prenotazione: servizio → giorno → orario → dati → conferma.
 * Gira dentro l'iframe del widget (o da solo aprendo /widget/booking.html).
 */
(function () {
  'use strict';

  var STEPS = ['service', 'day', 'time', 'details', 'confirm', 'done'];
  var STEP_LABELS = {
    service: 'Scegli il servizio',
    day: 'Scegli il giorno',
    time: "Scegli l'orario",
    details: 'I tuoi dati',
    confirm: 'Riepilogo',
    done: 'Fatto',
  };

  var isEmbedded = window.parent !== window;
  var state = { business: null, service: null, date: null, time: null, customer: null, step: 'service' };

  var $ = function (id) { return document.getElementById(id); };

  /* ----------------------------- Utility ------------------------------ */

  function api(path, options) {
    options = options || {};
    var init = { method: options.method || 'GET', headers: { Accept: 'application/json' } };
    if (options.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return fetch('/api' + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((data.error && data.error.message) || 'Errore di rete');
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
    (children || []).forEach(function (c) { node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  function formatPrice(value) {
    var b = state.business || {};
    return new Intl.NumberFormat(b.locale || 'it-IT', { style: 'currency', currency: b.currency || 'EUR' }).format(value);
  }

  /** "2026-10-20" → Date locale a mezzogiorno (evita problemi di fuso) */
  function parseDate(str) { return new Date(str + 'T12:00:00'); }

  function formatDate(str, opts) {
    return parseDate(str).toLocaleDateString((state.business && state.business.locale) || 'it-IT', opts);
  }

  function setLoading(on) { $('bk-loading').hidden = !on; }

  function showError(id, msg) { var n = $(id); n.textContent = msg || ''; n.hidden = !msg; }

  /* ---------------------------- Navigazione --------------------------- */

  function goTo(step) {
    state.step = step;
    document.querySelectorAll('.bk-step').forEach(function (s) { s.hidden = s.getAttribute('data-step') !== step; });
    var index = STEPS.indexOf(step);
    $('bk-step-label').textContent = STEP_LABELS[step];
    $('bk-back').hidden = index === 0 || step === 'done';
    $('bk-progress-bar').style.width = ((index + 1) / STEPS.length) * 100 + '%';
    $('bk-body').scrollTop = 0;
  }

  function back() {
    var index = STEPS.indexOf(state.step);
    if (index > 0) goTo(STEPS[index - 1]);
  }

  /* ------------------------------ Step 1 ------------------------------ */

  function renderServices(services) {
    var list = $('bk-services');
    list.innerHTML = '';
    if (!services.length) {
      list.appendChild(el('li', { class: 'bk-muted', text: 'Nessun servizio prenotabile al momento.' }));
      return;
    }
    services.forEach(function (s) {
      var btn = el('button', { type: 'button', class: 'bk-service' }, [
        el('span', {}, [
          el('span', { class: 'bk-service-name', text: s.name }),
          el('span', { class: 'bk-service-meta', text: s.durationMinutes + ' min' + (s.description ? ' · ' + s.description : '') }),
        ]),
        el('span', { class: 'bk-service-price', text: formatPrice(s.price) }),
      ]);
      btn.addEventListener('click', function () { selectService(s); });
      list.appendChild(el('li', {}, [btn]));
    });
  }

  function selectService(service) {
    state.service = service;
    setLoading(true);
    api('/availability/days?serviceId=' + encodeURIComponent(service.id))
      .then(function (data) { renderDays(data.days); goTo('day'); })
      .catch(function (err) { alert(err.message); })
      .finally(function () { setLoading(false); });
  }

  /* ------------------------------ Step 2 ------------------------------ */

  function renderDays(days) {
    var box = $('bk-days');
    box.innerHTML = '';
    var any = days.some(function (d) { return d.available > 0; });
    $('bk-days-empty').hidden = any;
    if (!any) return;

    var lastMonth = '';
    days.forEach(function (d) {
      var month = formatDate(d.date, { month: 'long', year: 'numeric' });
      if (month !== lastMonth) {
        box.appendChild(el('p', { class: 'bk-month', text: month }));
        lastMonth = month;
      }
      var btn = el('button', { type: 'button', class: 'bk-day', role: 'option', 'aria-label': formatDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' }) }, [
        el('small', { text: formatDate(d.date, { weekday: 'short' }) }),
        el('b', { text: String(parseDate(d.date).getDate()) }),
      ]);
      if (!d.available) btn.disabled = true;
      btn.addEventListener('click', function () { selectDay(d.date); });
      box.appendChild(btn);
    });
  }

  function selectDay(date) {
    state.date = date;
    setLoading(true);
    loadSlots()
      .then(function () { goTo('time'); })
      .catch(function (err) { alert(err.message); })
      .finally(function () { setLoading(false); });
  }

  /* ------------------------------ Step 3 ------------------------------ */

  function loadSlots() {
    return api('/availability?serviceId=' + encodeURIComponent(state.service.id) + '&date=' + state.date).then(function (data) {
      $('bk-time-date').textContent = formatDate(state.date, { weekday: 'long', day: 'numeric', month: 'long' });
      var box = $('bk-slots');
      box.innerHTML = '';
      $('bk-slots-empty').hidden = data.slots.length > 0;
      data.slots.forEach(function (time) {
        var btn = el('button', { type: 'button', class: 'bk-slot', text: time });
        btn.addEventListener('click', function () { state.time = time; goTo('details'); $('bk-form').elements.name.focus(); });
        box.appendChild(btn);
      });
    });
  }

  /* ------------------------------ Step 4 ------------------------------ */

  function onSubmitDetails(e) {
    e.preventDefault();
    var f = e.target.elements;
    var name = f.name.value.trim();
    var phone = f.phone.value.trim();
    if (name.length < 2) return showError('bk-form-error', 'Inserisci il tuo nome.');
    if (!/^\+?[0-9\s().-]{6,20}$/.test(phone)) return showError('bk-form-error', 'Inserisci un numero di telefono valido.');
    showError('bk-form-error', '');
    state.customer = { name: name, phone: phone, notes: f.notes.value.trim() };
    renderSummary();
    goTo('confirm');
  }

  /* ------------------------------ Step 5 ------------------------------ */

  function renderSummary() {
    var rows = [
      ['Servizio', state.service.name],
      ['Giorno', formatDate(state.date, { weekday: 'long', day: 'numeric', month: 'long' })],
      ['Orario', state.time],
      ['Durata', state.service.durationMinutes + ' min'],
      ['Prezzo', formatPrice(state.service.price)],
      ['Nome', state.customer.name],
      ['Telefono', state.customer.phone],
    ];
    var dl = $('bk-summary');
    dl.innerHTML = '';
    rows.forEach(function (r) { dl.appendChild(el('div', {}, [el('dt', { text: r[0] }), el('dd', { text: r[1] })])); });
    showError('bk-confirm-error', '');
  }

  function confirmBooking() {
    var btn = $('bk-confirm');
    btn.disabled = true;
    setLoading(true);
    api('/bookings', {
      method: 'POST',
      body: {
        serviceId: state.service.id,
        date: state.date,
        time: state.time,
        customer: { name: state.customer.name, phone: state.customer.phone },
        notes: state.customer.notes,
      },
    })
      .then(function (b) {
        $('bk-done-text').textContent = 'Ti aspettiamo ' + formatDate(b.date, { weekday: 'long', day: 'numeric', month: 'long' }) +
          ' alle ' + b.start + ' per "' + b.serviceName + '".';
        goTo('done');
      })
      .catch(function (err) {
        if (err.code === 'SLOT_TAKEN' || err.code === 'SLOT_UNAVAILABLE') {
          // Qualcuno ha prenotato nel frattempo: ricarica gli orari
          alert("Ci dispiace, l'orario è appena stato prenotato da qualcun altro. Scegline un altro.");
          return loadSlots().then(function () { goTo('time'); });
        }
        showError('bk-confirm-error', err.message);
      })
      .finally(function () { btn.disabled = false; setLoading(false); });
  }

  function restart() {
    state.service = state.date = state.time = null;
    $('bk-form').reset();
    goTo('service');
  }

  /* ------------------------------- Avvio ------------------------------ */

  function init() {
    if (isEmbedded) {
      $('bk-close').hidden = false;
      $('bk-close').addEventListener('click', function () {
        window.parent.postMessage({ source: 'booking-widget', type: 'close' }, '*');
      });
    }
    $('bk-back').addEventListener('click', back);
    $('bk-form').addEventListener('submit', onSubmitDetails);
    $('bk-confirm').addEventListener('click', confirmBooking);
    $('bk-restart').addEventListener('click', restart);

    goTo('service');
    setLoading(true);
    Promise.all([api('/business'), api('/services')])
      .then(function (res) {
        state.business = res[0];
        $('bk-business').textContent = res[0].name;
        document.title = 'Prenota · ' + res[0].name;
        if (res[0].primaryColor) document.documentElement.style.setProperty('--primary', res[0].primaryColor);
        renderServices(res[1]);
      })
      .catch(function () {
        $('bk-services').innerHTML = '';
        $('bk-services').appendChild(el('li', { class: 'bk-muted', text: 'Impossibile caricare i servizi. Riprova più tardi.' }));
      })
      .finally(function () { setLoading(false); });
  }

  init();
})();
