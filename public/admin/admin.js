/**
 * Pannello admin: calendario, prenotazioni, blocchi, servizi, orari.
 * JavaScript vanilla, nessuna dipendenza.
 */
(function () {
  'use strict';

  /* =================================================================== */
  /* Utility                                                             */
  /* =================================================================== */

  var DAY_NAMES = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // lunedì → domenica
  var HOUR_HEIGHT = 64; // deve coincidere con --hour-height in admin.css
  var PX_PER_MIN = HOUR_HEIGHT / 60;
  var LOCALE = 'it-IT';
  var CURRENCY = 'EUR';

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else if (k === 'style') node.style.cssText = attrs[k];
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) node.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  /** Chiamata alle API admin. In caso di sessione scaduta torna al login. */
  function api(path, options) {
    options = options || {};
    var init = { method: options.method || 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return fetch('/admin/api' + path, init).then(function (res) {
      if (res.status === 401) { window.location.href = '/admin/login'; throw new Error('Sessione scaduta'); }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error((data.error && data.error.message) || 'Errore');
        return data;
      });
    });
  }

  var toastTimer;
  function toast(message, isError) {
    var t = $('toast');
    t.textContent = message;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 5000 : 2500);
  }

  // ---- Date come stringhe "YYYY-MM-DD" (fuso orario del browser) ----
  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); }
  function today() { return toISO(new Date()); }
  function mondayOf(s) { var d = parseISO(s); var wd = (d.getDay() + 6) % 7; return addDays(s, -wd); }
  function formatDate(s, opts) { return parseISO(s).toLocaleDateString(LOCALE, opts); }

  function toMin(hhmm) { var p = hhmm.split(':'); return +p[0] * 60 + +p[1]; }
  function fromMin(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

  /* =================================================================== */
  /* Stato                                                               */
  /* =================================================================== */

  var state = {
    view: window.innerWidth < 720 ? 'day' : 'week',
    anchor: today(),
    settings: null,
    services: [],
    bookings: [],
    blocks: [],
    editing: null, // prenotazione in modifica nella modale
  };

  /* =================================================================== */
  /* Tabs                                                                */
  /* =================================================================== */

  function showTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      var active = t.getAttribute('data-tab') === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active);
    });
    document.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
    if (name === 'calendar') loadCalendar();
    if (name === 'blocks') loadBlocks();
    if (name === 'services') loadServices().then(renderServices);
    if (name === 'hours') loadSettings().then(renderHours);
  }

  /* =================================================================== */
  /* Calendario                                                          */
  /* =================================================================== */

  function visibleDays() {
    if (state.view === 'day') return [state.anchor];
    var start = mondayOf(state.anchor);
    return [0, 1, 2, 3, 4, 5, 6].map(function (i) { return addDays(start, i); });
  }

  function loadCalendar() {
    var days = visibleDays();
    var from = days[0];
    var to = days[days.length - 1];
    var q = '?from=' + from + '&to=' + to;
    return Promise.all([api('/bookings' + q), api('/blocks' + q), loadSettings(), loadServices()])
      .then(function (res) {
        state.bookings = res[0];
        state.blocks = res[1];
        renderCalendar(days);
      })
      .catch(function (err) { toast(err.message, true); });
  }

  /** Calcola la fascia oraria da mostrare (apertura + eventuali eventi fuori orario). */
  function visibleHours(days) {
    var min = Infinity;
    var max = -Infinity;
    days.forEach(function (d) {
      (state.settings.openingHours[parseISO(d).getDay()] || []).forEach(function (i) {
        min = Math.min(min, toMin(i.start));
        max = Math.max(max, toMin(i.end));
      });
    });
    state.bookings.forEach(function (b) { min = Math.min(min, toMin(b.start)); max = Math.max(max, toMin(b.end)); });
    state.blocks.forEach(function (b) {
      if (!b.allDay) { min = Math.min(min, toMin(b.start)); max = Math.max(max, toMin(b.end)); }
    });
    if (min === Infinity) { min = 8 * 60; max = 20 * 60; }
    return { start: Math.floor(min / 60) * 60, end: Math.min(1440, Math.ceil(max / 60) * 60) };
  }

  function renderCalendar(days) {
    var cal = $('calendar');
    var range = visibleHours(days);
    var height = (range.end - range.start) * PX_PER_MIN;
    var t = today();

    document.querySelectorAll('.view-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === state.view); });
    $('cal-label').textContent = state.view === 'day'
      ? formatDate(state.anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : formatDate(days[0], { day: 'numeric', month: 'short' }) + ' – ' + formatDate(days[6], { day: 'numeric', month: 'short', year: 'numeric' });

    renderStats(days);
    cal.innerHTML = '';
    cal.style.setProperty('--days', days.length);
    cal.style.setProperty('--col-min', state.view === 'day' ? '220px' : '110px');

    // Intestazioni
    cal.appendChild(el('div', { class: 'cal-head corner' }));
    days.forEach(function (d) {
      cal.appendChild(el('div', { class: 'cal-head' + (d === t ? ' today' : '') }, [
        formatDate(d, { weekday: 'short' }),
        el('b', { text: String(parseISO(d).getDate()) }),
      ]));
    });

    // Colonna delle ore
    var gutter = el('div', { class: 'cal-gutter', style: 'height:' + height + 'px;position:sticky' });
    for (var m = range.start; m <= range.end; m += 60) {
      if (m === range.start) continue;
      gutter.appendChild(el('span', { class: 'cal-hour-label', style: 'top:' + (m - range.start) * PX_PER_MIN + 'px', text: fromMin(m) }));
    }
    cal.appendChild(gutter);

    // Colonne dei giorni
    days.forEach(function (d) {
      var col = el('div', { class: 'cal-col', style: 'height:' + height + 'px' });
      var y = function (min) { return (min - range.start) * PX_PER_MIN; };

      // Fasce di apertura (sfondo bianco), il resto appare grigio = chiuso
      (state.settings.openingHours[parseISO(d).getDay()] || []).forEach(function (i) {
        col.appendChild(el('div', { class: 'cal-open', style: 'top:' + y(toMin(i.start)) + 'px;height:' + (toMin(i.end) - toMin(i.start)) * PX_PER_MIN + 'px;background-position:0 ' + -y(toMin(i.start)) + 'px' }));
      });

      // Blocchi
      state.blocks.filter(function (b) { return b.date === d; }).forEach(function (b) {
        var s = Math.max(toMin(b.start), range.start);
        var e = b.allDay ? range.end : Math.min(b.end === '24:00' ? 1440 : toMin(b.end), range.end);
        col.appendChild(el('div', { class: 'cal-block', style: 'top:' + y(s) + 'px;height:' + (e - s) * PX_PER_MIN + 'px', text: b.reason || 'Bloccato' }));
      });

      // Prenotazioni
      state.bookings.filter(function (b) { return b.date === d; }).forEach(function (b) {
        var s = toMin(b.start);
        var e = toMin(b.end);
        var btn = el('button', {
          type: 'button',
          class: 'cal-event' + (b.source === 'admin' ? ' admin' : ''),
          style: 'top:' + y(s) + 'px;height:' + Math.max((e - s) * PX_PER_MIN - 2, 18) + 'px',
          title: b.start + '–' + b.end + ' ' + b.customer.name + ' (' + b.serviceName + ') ' + b.customer.phone,
          onclick: function (ev) { ev.stopPropagation(); openBookingDialog(b); },
        }, [el('strong', { text: b.start + ' ' + b.customer.name }), b.serviceName]);
        col.appendChild(btn);
      });

      // Linea dell'ora attuale
      if (d === t) {
        var now = new Date();
        var nowMin = now.getHours() * 60 + now.getMinutes();
        if (nowMin >= range.start && nowMin <= range.end) col.appendChild(el('div', { class: 'cal-now', style: 'top:' + y(nowMin) + 'px' }));
      }

      // Click su uno spazio vuoto → nuova prenotazione a quell'ora
      col.addEventListener('click', function (ev) {
        var rect = col.getBoundingClientRect();
        var step = state.settings.slotStepMinutes || 15;
        var minutes = range.start + Math.floor((ev.clientY - rect.top) / PX_PER_MIN / step) * step;
        openBookingDialog(null, { date: d, time: fromMin(Math.max(range.start, Math.min(minutes, range.end - step))) });
      });

      cal.appendChild(col);
    });
  }

  /** Riepilogo sopra il calendario: appuntamenti e incasso previsto. */
  function renderStats(days) {
    var t = today();
    var fmt = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 });
    var sum = function (list) { return list.reduce(function (acc, b) { return acc + (b.price || 0); }, 0); };
    var period = state.bookings;
    var online = period.filter(function (b) { return b.source === 'online'; }).length;
    var stats = [];
    if (days.indexOf(t) >= 0) {
      var oggi = period.filter(function (b) { return b.date === t; });
      var now = new Date();
      var nowMin = now.getHours() * 60 + now.getMinutes();
      var next = oggi.filter(function (b) { return toMin(b.start) >= nowMin; })[0];
      stats.push(['Oggi', oggi.length + ' appunt.']);
      stats.push(['Prossimo', next ? next.start + ' · ' + next.customer.name.split(' ')[0] : '—']);
    }
    stats.push([state.view === 'day' ? 'Giorno' : 'Settimana', period.length + ' appunt. · ' + fmt.format(sum(period))]);
    stats.push(['Prenotati online', period.length ? Math.round((online / period.length) * 100) + '%' : '—']);

    var box = $('cal-stats');
    box.innerHTML = '';
    stats.forEach(function (s) { box.appendChild(el('div', { class: 'stat' }, [el('small', { text: s[0] }), el('b', { text: s[1] })])); });
  }

  function shiftCalendar(direction) {
    state.anchor = addDays(state.anchor, direction * (state.view === 'day' ? 1 : 7));
    loadCalendar();
  }

  /* =================================================================== */
  /* Modale prenotazione                                                 */
  /* =================================================================== */

  function fillServiceSelect(select, currentBooking) {
    select.innerHTML = '';
    state.services.forEach(function (s) {
      select.appendChild(el('option', { value: s.id, text: s.name + ' (' + s.durationMinutes + ' min)' + (s.active ? '' : ' – disattivato') }));
    });
    // Servizio eliminato ma ancora presente in una prenotazione
    if (currentBooking && currentBooking.serviceId && !state.services.some(function (s) { return s.id === currentBooking.serviceId; })) {
      select.appendChild(el('option', { value: currentBooking.serviceId, text: currentBooking.serviceName + ' (eliminato)' }));
    }
  }

  function openBookingDialog(booking, defaults) {
    var form = $('booking-form');
    var f = form.elements;
    state.editing = booking;
    form.reset();
    $('booking-error').hidden = true;
    fillServiceSelect(f.serviceId, booking);

    if (booking) {
      $('booking-dialog-title').textContent = 'Modifica prenotazione';
      f.serviceId.value = booking.serviceId || '';
      f.date.value = booking.date;
      f.time.value = booking.start;
      f.name.value = booking.customer.name;
      f.phone.value = booking.customer.phone;
      f.email.value = booking.customer.email || '';
      f.notes.value = booking.notes || '';
      $('booking-meta').textContent = (booking.source === 'online' ? 'Prenotata online' : 'Inserita manualmente') +
        ' il ' + new Date(booking.createdAt).toLocaleString(LOCALE) + ' · ' + booking.start + '–' + booking.end;
      $('booking-cancel').hidden = false;
    } else {
      $('booking-dialog-title').textContent = 'Nuova prenotazione';
      f.date.value = (defaults && defaults.date) || state.anchor;
      f.time.value = (defaults && defaults.time) || '09:00';
      $('booking-meta').textContent = '';
      $('booking-cancel').hidden = true;
    }
    $('booking-dialog').showModal();
  }

  function saveBooking(e) {
    e.preventDefault();
    var f = e.target.elements;
    if (!e.target.checkValidity()) { e.target.reportValidity(); return; }
    var body = {
      serviceId: f.serviceId.value,
      date: f.date.value,
      time: f.time.value,
      customer: { name: f.name.value, phone: f.phone.value, email: f.email.value },
      notes: f.notes.value,
    };
    var editing = state.editing;
    var req = editing
      ? api('/bookings/' + editing.id, { method: 'PUT', body: body })
      : api('/bookings', { method: 'POST', body: body });

    $('booking-save').disabled = true;
    req
      .then(function () {
        $('booking-dialog').close();
        toast(editing ? 'Prenotazione aggiornata' : 'Prenotazione aggiunta');
        state.anchor = body.date; // mostra il giorno della prenotazione
        loadCalendar();
      })
      .catch(function (err) { $('booking-error').textContent = err.message; $('booking-error').hidden = false; })
      .finally(function () { $('booking-save').disabled = false; });
  }

  function cancelEditingBooking() {
    var b = state.editing;
    if (!b || !confirm('Cancellare la prenotazione di ' + b.customer.name + ' (' + b.start + ')?')) return;
    api('/bookings/' + b.id, { method: 'DELETE' })
      .then(function () { $('booking-dialog').close(); toast('Prenotazione cancellata'); loadCalendar(); })
      .catch(function (err) { toast(err.message, true); });
  }

  /* =================================================================== */
  /* Blocchi                                                             */
  /* =================================================================== */

  function loadBlocks() {
    var from = today();
    return api('/blocks?from=' + from + '&to=' + addDays(from, 365))
      .then(renderBlocks)
      .catch(function (err) { toast(err.message, true); });
  }

  function renderBlocks(blocks) {
    var ul = $('block-list');
    ul.innerHTML = '';
    if (!blocks.length) { ul.appendChild(el('li', { class: 'muted', text: 'Nessun blocco in programma.' })); return; }
    blocks.forEach(function (b) {
      ul.appendChild(el('li', {}, [
        el('div', {}, [
          el('strong', { text: formatDate(b.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) }),
          ' · ' + (b.allDay ? 'Tutto il giorno' : b.start + '–' + b.end) + (b.reason ? ' · ' + b.reason : ''),
        ]),
        el('button', {
          type: 'button',
          class: 'btn btn-small btn-danger',
          text: 'Rimuovi',
          onclick: function () {
            api('/blocks/' + b.id, { method: 'DELETE' })
              .then(function () { toast('Blocco rimosso'); loadBlocks(); })
              .catch(function (err) { toast(err.message, true); });
          },
        }),
      ]));
    });
  }

  function saveBlock(e) {
    e.preventDefault();
    var f = e.target.elements;
    var body = {
      fromDate: f.fromDate.value,
      toDate: f.toDate.value || f.fromDate.value,
      allDay: f.allDay.checked,
      start: f.start.value,
      end: f.end.value,
      reason: f.reason.value,
    };
    api('/blocks', { method: 'POST', body: body })
      .then(function (res) {
        e.target.reset();
        $('block-times').hidden = true;
        toast(res.blocks.length === 1 ? 'Blocco aggiunto' : res.blocks.length + ' giorni bloccati');
        if (res.conflicts.length) {
          alert('Attenzione: ci sono già ' + res.conflicts.length + ' prenotazioni in questo periodo.\n' +
            'Non sono state cancellate, contatta i clienti se necessario:\n\n' +
            res.conflicts.map(function (b) { return '• ' + b.date + ' ' + b.start + ' – ' + b.customer.name + ' (' + b.customer.phone + ')'; }).join('\n'));
        }
        loadBlocks();
      })
      .catch(function (err) { toast(err.message, true); });
  }

  /* =================================================================== */
  /* Servizi                                                             */
  /* =================================================================== */

  function loadServices() {
    return api('/services').then(function (list) { state.services = list; return list; });
  }

  function renderServices() {
    var box = $('service-list');
    box.innerHTML = '';
    if (!state.services.length) { box.appendChild(el('p', { class: 'muted', text: 'Nessun servizio. Aggiungine uno.' })); return; }

    state.services.forEach(function (s) {
      var name = el('input', { value: s.name, maxlength: 80, 'aria-label': 'Nome' });
      var duration = el('input', { type: 'number', min: 5, step: 5, value: s.durationMinutes, 'aria-label': 'Durata in minuti' });
      var price = el('input', { type: 'number', min: 0, step: 0.5, value: s.price, 'aria-label': 'Prezzo' });
      var desc = el('input', { value: s.description, maxlength: 300, 'aria-label': 'Descrizione' });
      var active = el('input', { type: 'checkbox' });
      active.checked = s.active;

      var save = function () {
        api('/services/' + s.id, {
          method: 'PUT',
          body: { name: name.value, durationMinutes: Number(duration.value), price: Number(price.value), description: desc.value, active: active.checked },
        })
          .then(function () { toast('Servizio salvato'); return loadServices(); })
          .then(renderServices)
          .catch(function (err) { toast(err.message, true); });
      };
      var remove = function () {
        if (!confirm('Eliminare il servizio "' + s.name + '"? Le prenotazioni esistenti restano invariate.')) return;
        api('/services/' + s.id, { method: 'DELETE' })
          .then(function () { toast('Servizio eliminato'); return loadServices(); })
          .then(renderServices)
          .catch(function (err) { toast(err.message, true); });
      };

      box.appendChild(el('div', { class: 'service-row' + (s.active ? '' : ' inactive') }, [
        el('label', { class: 'field' }, [el('span', { text: 'Nome' }), name]),
        el('label', { class: 'field' }, [el('span', { text: 'Minuti' }), duration]),
        el('label', { class: 'field' }, [el('span', { text: 'Prezzo' }), price]),
        el('label', { class: 'field' }, [el('span', { text: 'Descrizione' }), desc]),
        el('div', { class: 'actions' }, [
          el('label', { class: 'checkbox', style: 'margin:0' }, [active, 'Attivo']),
          el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Salva', onclick: save }),
          el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Elimina', onclick: remove }),
        ]),
      ]));
    });
  }

  function addService(e) {
    e.preventDefault();
    var f = e.target.elements;
    api('/services', {
      method: 'POST',
      body: { name: f.name.value, durationMinutes: Number(f.durationMinutes.value), price: Number(f.price.value), description: f.description.value },
    })
      .then(function () { e.target.reset(); toast('Servizio aggiunto'); return loadServices(); })
      .then(renderServices)
      .catch(function (err) { toast(err.message, true); });
  }

  /* =================================================================== */
  /* Orari di apertura                                                   */
  /* =================================================================== */

  function loadSettings() {
    return api('/settings').then(function (s) { state.settings = s; return s; });
  }

  function intervalRow(interval) {
    var row = el('div', { class: 'interval' }, [
      el('input', { type: 'time', step: 300, value: interval.start, required: true, 'data-role': 'start', 'aria-label': 'Apertura' }),
      '–',
      el('input', { type: 'time', step: 300, value: interval.end, required: true, 'data-role': 'end', 'aria-label': 'Chiusura' }),
    ]);
    row.appendChild(el('button', { type: 'button', class: 'btn btn-small btn-ghost', 'aria-label': 'Rimuovi fascia', text: '✕', onclick: function () { row.remove(); } }));
    return row;
  }

  function renderHours() {
    var s = state.settings;
    var box = $('hours-days');
    box.innerHTML = '';
    WEEK_ORDER.forEach(function (day) {
      var list = el('div', { 'data-day': day });
      (s.openingHours[day] || []).forEach(function (i) { list.appendChild(intervalRow(i)); });
      box.appendChild(el('div', { class: 'day-row' }, [
        el('div', { class: 'day-row-head' }, [
          el('strong', { text: DAY_NAMES[day] }),
          el('button', { type: 'button', class: 'btn btn-small', text: '+ fascia', onclick: function () { list.appendChild(intervalRow({ start: '09:00', end: '13:00' })); } }),
        ]),
        list,
      ]));
    });
    var f = $('hours-form').elements;
    f.slotStepMinutes.value = s.slotStepMinutes;
    f.minNoticeMinutes.value = s.minNoticeMinutes;
    f.maxDaysAhead.value = s.maxDaysAhead;
  }

  function saveHours(e) {
    e.preventDefault();
    var openingHours = {};
    document.querySelectorAll('#hours-days [data-day]').forEach(function (list) {
      openingHours[list.getAttribute('data-day')] = Array.prototype.map.call(list.querySelectorAll('.interval'), function (row) {
        return { start: row.querySelector('[data-role=start]').value, end: row.querySelector('[data-role=end]').value };
      });
    });
    var f = e.target.elements;
    api('/settings', {
      method: 'PUT',
      body: {
        openingHours: openingHours,
        slotStepMinutes: Number(f.slotStepMinutes.value),
        minNoticeMinutes: Number(f.minNoticeMinutes.value),
        maxDaysAhead: Number(f.maxDaysAhead.value),
      },
    })
      .then(function (s) { state.settings = s; renderHours(); toast('Orari salvati'); })
      .catch(function (err) { toast(err.message, true); });
  }

  /* =================================================================== */
  /* Avvio                                                               */
  /* =================================================================== */

  function init() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
    });

    $('cal-prev').addEventListener('click', function () { shiftCalendar(-1); });
    $('cal-next').addEventListener('click', function () { shiftCalendar(1); });
    $('cal-today').addEventListener('click', function () { state.anchor = today(); loadCalendar(); });
    $('cal-new').addEventListener('click', function () { openBookingDialog(null, { date: state.anchor }); });
    document.querySelectorAll('.view-btn').forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.getAttribute('data-view'); loadCalendar(); });
    });

    $('booking-form').addEventListener('submit', saveBooking);
    $('booking-close').addEventListener('click', function () { $('booking-dialog').close(); });
    $('booking-cancel').addEventListener('click', cancelEditingBooking);

    $('block-form').addEventListener('submit', saveBlock);
    $('block-form').elements.allDay.addEventListener('change', function (e) {
      $('block-times').hidden = e.target.checked;
      $('block-form').elements.start.required = !e.target.checked;
      $('block-form').elements.end.required = !e.target.checked;
    });

    $('service-form').addEventListener('submit', addService);
    $('hours-form').addEventListener('submit', saveHours);

    $('logout').addEventListener('click', function () {
      api('/logout', { method: 'POST', body: {} }).finally(function () { window.location.href = '/admin/login'; });
    });

    api('/me').then(function (me) { $('admin-user').textContent = me.username; });
    fetch('/api/business').then(function (r) { return r.json(); }).then(function (b) {
      $('business-name').textContent = b.name;
      document.title = 'Gestione · ' + b.name;
      if (b.locale) LOCALE = b.locale;
      if (b.currency) CURRENCY = b.currency;
      if (b.logo) $('business-logo').src = b.logo;
      if (b.primaryColor) document.documentElement.style.setProperty('--primary', b.primaryColor);
      if (b.accentColor) document.documentElement.style.setProperty('--accent', b.accentColor);
    }).catch(function () {});

    showTab('calendar');
  }

  init();
})();
