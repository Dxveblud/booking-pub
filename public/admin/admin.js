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

  /** Logo di ripiego: l'iniziale del negozio nei suoi colori. */
  function monogram(name, color) {
    var letter = (String(name || '').trim().charAt(0) || '•').toUpperCase().replace(/[^A-Z0-9À-Ý]/, '•');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="' + (color || '#1c1917') +
      '"/><text x="32" y="43" font-family="Georgia,serif" font-size="32" fill="#fff" text-anchor="middle">' + letter + '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }


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

  var VIEWS = ['day', 'week', 'month'];
  function savedView() {
    try { var v = localStorage.getItem('bt-view'); return VIEWS.indexOf(v) >= 0 ? v : null; } catch (e) { return null; }
  }

  var state = {
    view: savedView() || (window.innerWidth < 720 ? 'day' : 'week'),
    selected: null, // giorno selezionato nella vista mensile
    anchor: today(),
    settings: null,
    services: [],
    bookings: [],
    blocks: [],
    editing: null, // prenotazione in modifica nella modale
    me: null, // utente loggato e negozio corrente
    staff: [], // collaboratori del negozio (vuoto = agenda unica)
    staffFilter: savedStaffFilter(), // id del collaboratore mostrato nel calendario ('' = tutti)
  };

  function savedStaffFilter() {
    try { return localStorage.getItem('bt-staff') || ''; } catch (e) { return ''; }
  }

  /* =================================================================== */
  /* Collaboratori: filtri e utilità                                     */
  /* =================================================================== */

  function loadStaff() {
    return api('/staff').then(function (list) {
      state.staff = list;
      // Filtro su un collaboratore che non c'è più: torna a "tutti"
      if (state.staffFilter && !list.some(function (s) { return s.id === state.staffFilter && s.active; })) state.staffFilter = '';
      return list;
    });
  }
  function activeStaff() { return state.staff.filter(function (s) { return s.active; }); }
  function staffMode() { return activeStaff().length > 0; }
  function staffName(id) {
    var s = state.staff.filter(function (x) { return x.id === id; })[0];
    return s ? s.name : '';
  }

  /** Prenotazioni e blocchi visibili con il filtro attuale (quelle non assegnate si vedono sempre). */
  function filteredBookings() {
    if (!state.staffFilter) return state.bookings;
    return state.bookings.filter(function (b) { return !b.staffId || b.staffId === state.staffFilter; });
  }
  function filteredBlocks() {
    if (!state.staffFilter) return state.blocks;
    return state.blocks.filter(function (b) { return !b.staffId || b.staffId === state.staffFilter; });
  }

  function renderStaffFilter() {
    var box = $('staff-filter');
    var list = activeStaff();
    box.hidden = !list.length;
    box.innerHTML = '';
    if (!list.length) return;
    [{ id: '', name: 'Tutti' }].concat(list).forEach(function (s) {
      box.appendChild(el('button', {
        type: 'button',
        class: 'chip-btn' + (state.staffFilter === s.id ? ' active' : ''),
        'aria-pressed': state.staffFilter === s.id ? 'true' : 'false',
        text: s.name,
        onclick: function () {
          state.staffFilter = s.id;
          try { localStorage.setItem('bt-staff', s.id); } catch (e) { /* storage non disponibile */ }
          loadCalendar();
        },
      }));
    });
  }

  /** Sistema gli appuntamenti sovrapposti uno accanto all'altro (corsie). */
  function layoutLanes(items) {
    items.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var groups = [];
    var current = null;
    var groupEnd = -1;
    items.forEach(function (it) {
      if (!current || it.s >= groupEnd) { current = []; groups.push(current); groupEnd = it.e; } else groupEnd = Math.max(groupEnd, it.e);
      current.push(it);
    });
    groups.forEach(function (g) {
      var lanes = [];
      g.forEach(function (it) {
        var i = lanes.findIndex(function (end) { return end <= it.s; });
        if (i < 0) { i = lanes.length; lanes.push(it.e); } else lanes[i] = it.e;
        it.lane = i;
      });
      g.forEach(function (it) { it.lanes = lanes.length; });
    });
    return items;
  }

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
    if (name === 'services') Promise.all([loadServices(), loadStaff(), loadSettings()]).then(function () { renderServices(); renderStaffList(); });
    if (name === 'hours') loadSettings().then(renderHours);
    if (name === 'shop') renderShopPanel();
    if (name === 'platform') loadPlatform();
  }

  /* =================================================================== */
  /* Calendario                                                          */
  /* =================================================================== */

  function firstOfMonth(s) { return s.slice(0, 8) + '01'; }
  function sameMonth(a, b) { return a.slice(0, 7) === b.slice(0, 7); }

  /** Giorni visibili: 1 (giorno), 7 (settimana) o 6 settimane intere (mese). */
  function visibleDays() {
    if (state.view === 'day') return [state.anchor];
    var start = mondayOf(state.view === 'month' ? firstOfMonth(state.anchor) : state.anchor);
    var n = state.view === 'month' ? 42 : 7;
    var out = [];
    for (var i = 0; i < n; i += 1) out.push(addDays(start, i));
    return out;
  }

  function setView(view) {
    state.view = view;
    try { localStorage.setItem('bt-view', view); } catch (e) { /* storage non disponibile */ }
    loadCalendar();
  }

  function renderHeader(days) {
    document.querySelectorAll('.view-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === state.view); });
    var label;
    if (state.view === 'day') label = formatDate(state.anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    else if (state.view === 'month') label = formatDate(state.anchor, { month: 'long', year: 'numeric' });
    else label = formatDate(days[0], { day: 'numeric', month: 'short' }) + ' – ' + formatDate(days[6], { day: 'numeric', month: 'short', year: 'numeric' });
    $('cal-label').textContent = label;
    var isMonth = state.view === 'month';
    $('calendar-wrap').hidden = isMonth;
    $('month').hidden = !isMonth;
    $('agenda').hidden = !isMonth;
    $('cal-hint').textContent = isMonth
      ? 'Tocca un giorno per vedere i suoi appuntamenti.'
      : 'Tocca uno spazio libero per aggiungere, un appuntamento per modificarlo.';
  }

  function loadCalendar() {
    var days = visibleDays();
    var from = days[0];
    var to = days[days.length - 1];
    var q = '?from=' + from + '&to=' + to;
    return Promise.all([api('/bookings' + q), api('/blocks' + q), loadSettings(), loadServices(), loadStaff()])
      .then(function (res) {
        state.bookings = res[0];
        state.blocks = res[1];
        renderStaffFilter();
        renderHeader(days);
        renderStats(days);
        if (state.view === 'month') renderMonth(days);
        else renderCalendar(days);
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

  /**
   * Colonne del calendario. Normalmente una per giorno; nella vista giornaliera
   * di un negozio con collaboratori (filtro "Tutti") una per collaboratore,
   * più "Da assegnare" se quel giorno ci sono appuntamenti senza collaboratore.
   * staffId: undefined = tutte le agende, '' = solo non assegnati, id = quel collaboratore.
   */
  function calendarColumns(days) {
    var list = activeStaff();
    if (state.view === 'day' && list.length && !state.staffFilter) {
      var d = days[0];
      var cols = list.map(function (s) { return { date: d, staffId: s.id, staff: s, label: s.name, exact: true }; });
      if (state.bookings.some(function (b) { return b.date === d && !b.staffId; })) cols.push({ date: d, staffId: '', label: 'Da assegnare' });
      return cols;
    }
    var staff = state.staffFilter ? state.staff.filter(function (s) { return s.id === state.staffFilter; })[0] : null;
    return days.map(function (d) { return { date: d, staffId: state.staffFilter || undefined, staff: staff }; });
  }

  /** Fasce di lavoro di una colonna: quelle del collaboratore se ha orari propri. */
  function columnHours(col) {
    var wd = parseISO(col.date).getDay();
    if (col.staff && col.staff.customHours) return col.staff.openingHours[wd] || [];
    return state.settings.openingHours[wd] || [];
  }

  function inColumn(item, col) {
    if (item.date !== col.date) return false;
    if (col.staffId === undefined) return true;
    if (col.staffId === '') return !item.staffId;
    // Con il filtro su un collaboratore si vedono anche i non assegnati (occupano tutti)
    return item.staffId === col.staffId || (!col.exact && !item.staffId);
  }

  function renderCalendar(days) {
    var cal = $('calendar');
    var range = visibleHours(days);
    var height = (range.end - range.start) * PX_PER_MIN;
    var t = today();
    var columns = calendarColumns(days);
    var byStaff = columns.length && columns[0].label !== undefined;
    var showStaffName = staffMode() && !state.staffFilter && !byStaff;

    cal.innerHTML = '';
    cal.style.setProperty('--days', columns.length);
    cal.style.setProperty('--col-min', state.view === 'day' ? (byStaff ? '150px' : '220px') : '96px');

    // Intestazioni
    cal.appendChild(el('div', { class: 'cal-head corner' }));
    columns.forEach(function (c) {
      cal.appendChild(el('div', { class: 'cal-head' + (c.date === t && !byStaff ? ' today' : '') + (byStaff ? ' staff-head' : '') }, byStaff
        ? [el('b', { text: c.label })]
        : [formatDate(c.date, { weekday: 'short' }), el('b', { text: String(parseISO(c.date).getDate()) })]));
    });

    // Colonna delle ore
    var gutter = el('div', { class: 'cal-gutter', style: 'height:' + height + 'px;position:sticky' });
    for (var m = range.start; m <= range.end; m += 60) {
      if (m === range.start) continue;
      gutter.appendChild(el('span', { class: 'cal-hour-label', style: 'top:' + (m - range.start) * PX_PER_MIN + 'px', text: fromMin(m) }));
    }
    cal.appendChild(gutter);

    // Colonne (giorni o collaboratori)
    columns.forEach(function (c) {
      var d = c.date;
      var col = el('div', { class: 'cal-col', style: 'height:' + height + 'px' });
      var y = function (min) { return (min - range.start) * PX_PER_MIN; };

      // Fasce di apertura (sfondo bianco), il resto appare grigio = chiuso
      columnHours(c).forEach(function (i) {
        col.appendChild(el('div', { class: 'cal-open', style: 'top:' + y(toMin(i.start)) + 'px;height:' + (toMin(i.end) - toMin(i.start)) * PX_PER_MIN + 'px;background-position:0 ' + -y(toMin(i.start)) + 'px' }));
      });

      // Blocchi: quelli del negozio ovunque, quelli di un collaboratore nella sua colonna
      state.blocks.filter(function (b) {
        if (b.date !== d) return false;
        if (!b.staffId) return true;
        return c.staffId === undefined ? !state.staffFilter || b.staffId === state.staffFilter : b.staffId === c.staffId;
      }).forEach(function (b) {
        var s = Math.max(toMin(b.start), range.start);
        var e = b.allDay ? range.end : Math.min(b.end === '24:00' ? 1440 : toMin(b.end), range.end);
        var who = b.staffId && (showStaffName || c.staffId === undefined) ? staffName(b.staffId) + ': ' : '';
        col.appendChild(el('div', { class: 'cal-block' + (b.staffId ? ' staff' : ''), style: 'top:' + y(s) + 'px;height:' + (e - s) * PX_PER_MIN + 'px', text: who + (b.reason || 'Bloccato') }));
      });

      // Prenotazioni, affiancate se si sovrappongono (agende diverse nella stessa colonna)
      var items = state.bookings.filter(function (b) { return inColumn(b, c); })
        .map(function (b) { return { b: b, s: toMin(b.start), e: toMin(b.end) }; });
      layoutLanes(items).forEach(function (it) {
        var b = it.b;
        var w = 'calc((100% - 8px) / ' + it.lanes + ' - 2px)';
        var left = 'calc(4px + (100% - 8px) * ' + it.lane + ' / ' + it.lanes + ')';
        var label = showStaffName ? (b.staffName || 'Da assegnare') + ' · ' + b.serviceName : b.serviceName;
        col.appendChild(el('button', {
          type: 'button',
          class: 'cal-event' + (b.source === 'admin' ? ' admin' : '') + (staffMode() && !b.staffId ? ' unassigned' : ''),
          style: 'top:' + y(it.s) + 'px;height:' + Math.max((it.e - it.s) * PX_PER_MIN - 2, 18) + 'px;left:' + left + ';width:' + w + ';right:auto',
          title: b.start + '–' + b.end + ' ' + b.customer.name + ' (' + b.serviceName + (b.staffName ? ', ' + b.staffName : '') + ') ' + b.customer.phone,
          onclick: function (ev) { ev.stopPropagation(); openBookingDialog(b); },
        }, [el('strong', { text: b.start + ' ' + b.customer.name }), label]));
      });

      // Linea dell'ora attuale
      if (d === t) {
        var now = new Date();
        var nowMin = now.getHours() * 60 + now.getMinutes();
        if (nowMin >= range.start && nowMin <= range.end) col.appendChild(el('div', { class: 'cal-now', style: 'top:' + y(nowMin) + 'px' }));
      }

      // Click su uno spazio vuoto → nuova prenotazione a quell'ora (e con quel collaboratore)
      col.addEventListener('click', function (ev) {
        var rect = col.getBoundingClientRect();
        var step = state.settings.slotStepMinutes || 15;
        var minutes = range.start + Math.floor((ev.clientY - rect.top) / PX_PER_MIN / step) * step;
        openBookingDialog(null, { date: d, time: fromMin(Math.max(range.start, Math.min(minutes, range.end - step))), staffId: c.staffId || '' });
      });

      cal.appendChild(col);
    });
  }

  /** Riepilogo sopra il calendario: appuntamenti e incasso previsto. */
  function renderStats(days) {
    var t = today();
    var fmt = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 });
    var sum = function (list) { return list.reduce(function (acc, b) { return acc + (b.price || 0); }, 0); };
    // Con il filtro su un collaboratore si contano solo i suoi appuntamenti
    var mine = state.staffFilter ? state.bookings.filter(function (b) { return b.staffId === state.staffFilter; }) : state.bookings;
    var period = state.view === 'month'
      ? mine.filter(function (b) { return sameMonth(b.date, state.anchor); })
      : mine;
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
    stats.push([{ day: 'Giorno', week: 'Settimana', month: 'Mese' }[state.view], period.length + ' appunt. · ' + fmt.format(sum(period))]);
    stats.push(['Prenotati online', period.length ? Math.round((online / period.length) * 100) + '%' : '—']);

    var box = $('cal-stats');
    box.innerHTML = '';
    stats.forEach(function (s) { box.appendChild(el('div', { class: 'stat' }, [el('small', { text: s[0] }), el('b', { text: s[1] })])); });
  }

  function shiftCalendar(direction) {
    if (state.view === 'month') {
      var d = parseISO(firstOfMonth(state.anchor));
      d.setMonth(d.getMonth() + direction);
      state.anchor = toISO(d);
      state.selected = null;
    } else {
      state.anchor = addDays(state.anchor, direction * (state.view === 'day' ? 1 : 7));
    }
    loadCalendar();
  }

  /* ------------------------------ Vista mese ------------------------------ */

  function isClosed(date) { return !(state.settings.openingHours[parseISO(date).getDay()] || []).length; }
  function bookingsOf(date) { return filteredBookings().filter(function (b) { return b.date === date; }); }
  function blocksOf(date) { return filteredBlocks().filter(function (b) { return b.date === date; }); }

  function renderMonth(days) {
    var t = today();
    if (!state.selected || !sameMonth(state.selected, state.anchor)) {
      state.selected = sameMonth(t, state.anchor) ? t : firstOfMonth(state.anchor);
    }
    var box = $('month');
    box.innerHTML = '';
    ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].forEach(function (n) { box.appendChild(el('div', { class: 'm-head', text: n })); });

    days.forEach(function (d) {
      var list = bookingsOf(d);
      var blocked = blocksOf(d);
      var cls = 'm-cell';
      if (!sameMonth(d, state.anchor)) cls += ' other';
      if (d === t) cls += ' today';
      if (d === state.selected) cls += ' selected';
      if (isClosed(d)) cls += ' closed';
      if (blocked.some(function (b) { return b.allDay; })) cls += ' blocked';

      var cell = el('div', { class: cls, role: 'button', tabindex: '0', 'aria-label': formatDate(d, { weekday: 'long', day: 'numeric', month: 'long' }) + ', ' + list.length + ' appuntamenti' });
      var top = el('div', { class: 'm-top' }, [el('span', { class: 'm-num', text: String(parseISO(d).getDate()) })]);
      if (list.length) top.appendChild(el('span', { class: 'm-count', text: String(list.length) }));
      cell.appendChild(top);

      // Su desktop: primi appuntamenti del giorno (su mobile si vedono solo i puntini)
      var ul = el('div', { class: 'm-list' });
      list.slice(0, 3).forEach(function (b) {
        ul.appendChild(el('button', {
          type: 'button',
          class: 'm-item' + (b.source === 'admin' ? ' admin' : ''),
          text: b.start + ' ' + b.customer.name,
          onclick: function (ev) { ev.stopPropagation(); openBookingDialog(b); },
        }));
      });
      if (list.length > 3) ul.appendChild(el('span', { class: 'm-more', text: '+' + (list.length - 3) + ' altri' }));
      if (blocked.length && !list.length) ul.appendChild(el('span', { class: 'm-more', text: blocked[0].reason || 'Bloccato' }));
      cell.appendChild(ul);

      var dots = el('div', { class: 'm-dots' });
      for (var i = 0; i < Math.min(list.length, 4); i += 1) dots.appendChild(el('i'));
      cell.appendChild(dots);

      var select = function () {
        state.selected = d;
        if (!sameMonth(d, state.anchor)) { state.anchor = d; loadCalendar(); return; }
        box.querySelectorAll('.m-cell.selected').forEach(function (c) { c.classList.remove('selected'); });
        cell.classList.add('selected');
        renderAgenda(d);
        if (window.innerWidth < 720) $('agenda').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
      cell.addEventListener('click', select);
      cell.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
      box.appendChild(cell);
    });
    renderAgenda(state.selected);
  }

  /** Elenco degli appuntamenti del giorno selezionato (sotto la vista mese). */
  function renderAgenda(date) {
    var box = $('agenda');
    box.innerHTML = '';
    var list = bookingsOf(date);
    var fmt = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 });
    var total = list.reduce(function (a, b) { return a + (b.price || 0); }, 0);

    var head = el('div', { class: 'agenda-head' }, [
      el('div', {}, [
        el('h3', { text: formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' }) }),
        el('span', { class: 'muted small', text: isClosed(date) && !list.length ? 'Chiuso' : list.length + ' appuntamenti' + (list.length ? ' · ' + fmt.format(total) : '') }),
      ]),
      el('div', { class: 'agenda-actions' }, [
        el('button', { type: 'button', class: 'btn btn-small', text: 'Apri giorno', onclick: function () { state.anchor = date; setView('day'); } }),
        el('button', { type: 'button', class: 'btn btn-small btn-primary', text: '+ Aggiungi', onclick: function () { openBookingDialog(null, { date: date }); } }),
      ]),
    ]);
    box.appendChild(head);

    blocksOf(date).forEach(function (b) {
      box.appendChild(el('div', { class: 'agenda-block', text: (b.allDay ? 'Tutto il giorno' : b.start + '–' + b.end) + ' · ' + (b.reason || 'Bloccato') }));
    });

    if (!list.length) {
      box.appendChild(el('p', { class: 'muted agenda-empty', text: 'Nessun appuntamento.' }));
      return;
    }
    var ul = el('ul', { class: 'agenda-list' });
    list.forEach(function (b) {
      var phone = el('a', { class: 'agenda-phone', href: 'tel:' + b.customer.phone.replace(/[^+\d]/g, ''), title: 'Chiama ' + b.customer.phone, 'aria-label': 'Chiama ' + b.customer.name });
      phone.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h2.6l1.4 4-2 1.3a12 12 0 0 0 6.6 6.6l1.3-2 4 1.4v2.6A2.1 2.1 0 0 1 18.4 19.5 15 15 0 0 1 4.5 5.6 2.1 2.1 0 0 1 6.6 3.5z"/></svg>';
      phone.appendChild(el('span', { text: b.customer.phone }));
      ul.appendChild(el('li', {}, [
        el('button', { type: 'button', class: 'agenda-item' + (b.source === 'admin' ? ' admin' : ''), onclick: function () { openBookingDialog(b); } }, [
          el('span', { class: 'agenda-time' }, [el('b', { text: b.start }), el('small', { text: b.end })]),
          el('span', { class: 'agenda-body' }, [
            el('strong', { text: b.customer.name }),
            el('span', { text: b.serviceName + ' · ' + fmt.format(b.price || 0) + (staffMode() ? ' · ' + (b.staffName || 'da assegnare') : '') }),
            b.notes ? el('em', { text: b.notes }) : null,
          ]),
        ]),
        phone,
      ]));
    });
    box.appendChild(ul);
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

  /** Scelta del collaboratore nella modale (solo nei negozi che ne hanno). */
  function fillStaffSelect(select, booking, defaults) {
    select.innerHTML = '';
    var list = activeStaff().slice();
    // Collaboratore disattivato ma ancora assegnato a questa prenotazione
    if (booking && booking.staffId && !list.some(function (s) { return s.id === booking.staffId; })) {
      list.push({ id: booking.staffId, name: (booking.staffName || staffName(booking.staffId)) + ' (disattivato)' });
    }
    if (booking && !booking.staffId) select.appendChild(el('option', { value: '', text: '— da assegnare —' }));
    list.forEach(function (s) { select.appendChild(el('option', { value: s.id, text: s.name })); });
    var wanted = booking ? (booking.staffId || '') : ((defaults && defaults.staffId) || state.staffFilter || (list[0] && list[0].id) || '');
    select.value = wanted;
    if (select.value !== wanted && list[0]) select.value = list[0].id;
    $('booking-staff-field').hidden = !list.length;
  }

  function openBookingDialog(booking, defaults) {
    var form = $('booking-form');
    var f = form.elements;
    state.editing = booking;
    form.reset();
    $('booking-error').hidden = true;
    fillServiceSelect(f.serviceId, booking);
    fillStaffSelect(f.staffId, booking, defaults);

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
    if (!$('booking-staff-field').hidden) body.staffId = f.staffId.value;
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
        state.selected = body.date;
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
    return Promise.all([api('/blocks?from=' + from + '&to=' + addDays(from, 365)), loadStaff()])
      .then(function (res) { fillBlockStaff(); renderBlocks(res[0]); })
      .catch(function (err) { toast(err.message, true); });
  }

  /** "Per chi": tutto il negozio o un collaboratore (es. le sue ferie). */
  function fillBlockStaff() {
    var select = $('block-form').elements.staffId;
    var current = select.value;
    select.innerHTML = '';
    select.appendChild(el('option', { value: '', text: 'Tutto il negozio' }));
    activeStaff().forEach(function (s) { select.appendChild(el('option', { value: s.id, text: s.name })); });
    select.value = current;
    $('block-staff-field').hidden = !staffMode();
  }

  function renderBlocks(blocks) {
    var ul = $('block-list');
    ul.innerHTML = '';
    if (!blocks.length) { ul.appendChild(el('li', { class: 'muted', text: 'Nessun blocco in programma.' })); return; }
    blocks.forEach(function (b) {
      ul.appendChild(el('li', {}, [
        el('div', {}, [
          el('strong', { text: formatDate(b.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) }),
          ' · ' + (b.allDay ? 'Tutto il giorno' : b.start + '–' + b.end) + (b.staffId ? ' · solo ' + staffName(b.staffId) : '') + (b.reason ? ' · ' + b.reason : ''),
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
      staffId: f.staffId.value || undefined,
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
    var fmt = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, minimumFractionDigits: 0 });

    // Ogni servizio è una scheda compatta che si apre per modificarlo
    state.services.forEach(function (s) {
      var name = el('input', { value: s.name, maxlength: 80 });
      var duration = el('input', { type: 'number', min: 5, step: 5, value: s.durationMinutes, inputmode: 'numeric' });
      var price = el('input', { type: 'number', min: 0, step: 0.5, value: s.price, inputmode: 'decimal' });
      var desc = el('input', { value: s.description, maxlength: 300 });
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

      box.appendChild(el('details', { class: 'service-card' + (s.active ? '' : ' inactive') }, [
        el('summary', {}, [
          el('span', { class: 'sc-main' }, [
            el('strong', { text: s.name }),
            el('span', { class: 'muted small', text: s.durationMinutes + ' min' + (s.active ? '' : ' · non prenotabile online') }),
          ]),
          el('span', { class: 'sc-price', text: fmt.format(s.price) }),
          el('span', { class: 'sc-chevron', 'aria-hidden': 'true', text: '›' }),
        ]),
        el('div', { class: 'sc-body' }, [
          el('label', { class: 'field sc-name' }, [el('span', { text: 'Nome' }), name]),
          el('div', { class: 'grid-2 sc-nums' }, [
            el('label', { class: 'field' }, [el('span', { text: 'Durata (min)' }), duration]),
            el('label', { class: 'field' }, [el('span', { text: 'Prezzo' }), price]),
          ]),
          el('label', { class: 'field' }, [el('span', { text: 'Descrizione' }), desc]),
          el('div', { class: 'sc-actions' }, [
            el('label', { class: 'checkbox' }, [active, 'Prenotabile online']),
            el('span', { class: 'spacer' }),
            el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Elimina', onclick: remove }),
            el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Salva', onclick: save }),
          ]),
        ]),
      ]));
    });
  }

  /* =================================================================== */
  /* Collaboratori                                                       */
  /* =================================================================== */

  function refreshStaff() { return loadStaff().then(renderStaffList); }

  /** Editor degli orari propri: una riga per giorno, come quelli del negozio. */
  function staffHoursEditor(staff) {
    var box = el('div', { class: 'staff-hours' });
    var base = staff.customHours ? staff.openingHours : (state.settings ? state.settings.openingHours : {});
    WEEK_ORDER.forEach(function (day) {
      var list = el('div', { 'data-day': day });
      (base[day] || []).forEach(function (i) { list.appendChild(intervalRow(i)); });
      box.appendChild(el('div', { class: 'day-row' }, [
        el('div', { class: 'day-row-head' }, [
          el('strong', { text: DAY_NAMES[day] }),
          el('button', { type: 'button', class: 'btn btn-small', text: '+ fascia', onclick: function () { list.appendChild(intervalRow({ start: '09:00', end: '13:00' })); } }),
        ]),
        list,
      ]));
    });
    return box;
  }

  function readHours(box) {
    var out = {};
    box.querySelectorAll('[data-day]').forEach(function (list) {
      out[list.getAttribute('data-day')] = Array.prototype.map.call(list.querySelectorAll('.interval'), function (row) {
        return { start: row.querySelector('[data-role=start]').value, end: row.querySelector('[data-role=end]').value };
      });
    });
    return out;
  }

  function renderStaffList() {
    var box = $('staff-list');
    box.innerHTML = '';
    if (!state.staff.length) {
      box.appendChild(el('p', { class: 'muted small', text: 'Nessun collaboratore: il negozio ha un\'agenda unica.' }));
      return;
    }
    state.staff.forEach(function (s) {
      var name = el('input', { value: s.name, maxlength: 60 });
      var active = el('input', { type: 'checkbox' });
      active.checked = s.active;
      var checks = state.services.map(function (svc) {
        var cb = el('input', { type: 'checkbox', value: svc.id });
        cb.checked = s.serviceIds.indexOf(svc.id) >= 0;
        return el('label', { class: 'checkbox' }, [cb, svc.name]);
      });
      var custom = el('input', { type: 'checkbox' });
      custom.checked = s.customHours;
      var hours = staffHoursEditor(s);
      hours.hidden = !s.customHours;
      custom.addEventListener('change', function () { hours.hidden = !custom.checked; });

      var save = function () {
        var serviceIds = checks.map(function (l) { return l.querySelector('input'); })
          .filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
        var body = { name: name.value, active: active.checked, serviceIds: serviceIds, customHours: custom.checked };
        if (custom.checked) body.openingHours = readHours(hours);
        api('/staff/' + s.id, { method: 'PUT', body: body })
          .then(function () { toast('Collaboratore salvato'); return refreshStaff(); })
          .catch(function (err) { toast(err.message, true); });
      };
      var remove = function () {
        if (!confirm('Eliminare ' + s.name + '? Se ha appuntamenti in programma conviene disattivarlo.')) return;
        api('/staff/' + s.id, { method: 'DELETE' })
          .then(function () { toast('Collaboratore eliminato'); return refreshStaff(); })
          .catch(function (err) { toast(err.message, true); });
      };

      var what = s.serviceIds.length ? s.serviceIds.length + ' servizi' : 'tutti i servizi';
      box.appendChild(el('details', { class: 'service-card' + (s.active ? '' : ' inactive') }, [
        el('summary', {}, [
          el('span', { class: 'sc-main' }, [
            el('strong', { text: s.name }),
            el('span', { class: 'muted small', text: (s.active ? what : 'disattivato') + (s.customHours ? ' · orari propri' : '') }),
          ]),
          el('span', { class: 'sc-chevron', 'aria-hidden': 'true', text: '›' }),
        ]),
        el('div', { class: 'sc-body' }, [
          el('label', { class: 'field' }, [el('span', { text: 'Nome' }), name]),
          el('div', { class: 'staff-services' }, [
            el('strong', { text: 'Servizi che fa' }),
            el('p', { class: 'muted small', text: 'Nessuna spunta = tutti i servizi.' }),
            el('div', { class: 'check-grid' }, checks),
          ]),
          el('label', { class: 'checkbox' }, [custom, 'Orari diversi da quelli del negozio (es. part-time)']),
          hours,
          el('div', { class: 'sc-actions' }, [
            el('label', { class: 'checkbox' }, [active, 'Attivo']),
            el('span', { class: 'spacer' }),
            el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Elimina', onclick: remove }),
            el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Salva', onclick: save }),
          ]),
        ]),
      ]));
    });
  }

  function addStaff(e) {
    e.preventDefault();
    var f = e.target.elements;
    api('/staff', { method: 'POST', body: { name: f.name.value } })
      .then(function () { e.target.reset(); toast('Collaboratore aggiunto'); return refreshStaff(); })
      .catch(function (err) { toast(err.message, true); });
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
    f.cancelNoticeHours.value = Math.round((s.cancelNoticeMinutes || 0) / 60);
    f.reminderHours.value = s.reminderHours;
    f.reviewDelayMinutes.value = s.reviewDelayMinutes;
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
        cancelNoticeMinutes: Number(f.cancelNoticeHours.value) * 60,
        reminderHours: Number(f.reminderHours.value),
        reviewDelayMinutes: Number(f.reviewDelayMinutes.value),
      },
    })
      .then(function (s) { state.settings = s; renderHours(); toast('Orari salvati'); })
      .catch(function (err) { toast(err.message, true); });
  }

  /* =================================================================== */
  /* Negozio: dati, aspetto, codice da incollare                         */
  /* =================================================================== */

  /** Applica nome, logo e colori del negozio corrente all'interfaccia. */
  function applyBusiness(b) {
    $('business-name').textContent = b.name;
    document.title = 'Gestione · ' + b.name;
    if (b.locale) LOCALE = b.locale;
    if (b.currency) CURRENCY = b.currency;
    $('business-logo').src = b.logo || monogram(b.name, b.primaryColor);
    state.brand = { primary: b.primaryColor, accent: b.accentColor };
    applyBrandColors();
    $('view-site').href = '/s/' + b.slug;
  }

  /**
   * Colori del negozio nel pannello. Nel tema scuro il colore principale
   * (spesso scuro) renderebbe i pulsanti illeggibili: si usa quello d'accento.
   */
  function applyBrandColors() {
    var brand = state.brand || {};
    var root = document.documentElement.style;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    root.removeProperty('--primary');
    root.removeProperty('--accent');
    if (dark) {
      if (brand.accent) { root.setProperty('--primary', brand.accent); root.setProperty('--accent', brand.accent); }
    } else {
      if (brand.primary) root.setProperty('--primary', brand.primary);
      if (brand.accent) root.setProperty('--accent', brand.accent);
    }
  }

  /** Pulsante ☀/☾: cambia tema e lo ricorda (vedi /admin/theme.js). */
  function initThemeToggle() {
    var btn = $('theme-toggle');
    if (!btn) return;
    var sync = function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      btn.textContent = dark ? '☀' : '☾';
      btn.setAttribute('aria-label', dark ? 'Passa al tema chiaro' : 'Passa al tema scuro');
      btn.title = btn.getAttribute('aria-label');
    };
    btn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('bt-theme', next); } catch (e) { /* storage non disponibile */ }
      applyBrandColors();
      sync();
    });
    sync();
  }

  function loadMe() {
    return api('/me').then(function (me) {
      state.me = me;
      $('admin-user').textContent = me.username;
      var isSuper = me.role === 'super';
      $('role-badge').hidden = !isSuper;
      $('tab-platform').hidden = !isSuper;
      document.body.classList.toggle('is-super', isSuper);
      applyBusiness(me.business);
      return me;
    });
  }

  function copyText(id, btn) {
    var value = $(id).textContent;
    var done = function () { var old = btn.textContent; btn.textContent = 'Copiato ✓'; setTimeout(function () { btn.textContent = old; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(value).then(done, function () { window.prompt('Copia il testo:', value); });
    else window.prompt('Copia il testo:', value);
  }

  /** Carica un'immagine e restituisce il suo indirizzo. */
  function uploadImage(file) {
    if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('Immagine troppo grande (massimo 5 MB)'));
    return fetch('/admin/api/uploads', { method: 'POST', headers: { 'Content-Type': file.type }, body: file, credentials: 'same-origin' })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error((data.error && data.error.message) || 'Caricamento non riuscito');
          return data.url;
        });
      });
  }

  // Bozza delle immagini del modulo (salvate solo con "Salva modifiche")
  var draft = { images: {}, gallery: [], team: [], reviewItems: [] };

  function renderImageField(box) {
    var key = box.getAttribute('data-img');
    var url = draft.images[key];
    var preview = box.querySelector('.img-preview');
    preview.innerHTML = '';
    preview.classList.toggle('empty', !url);
    if (url) preview.appendChild(el('img', { src: url, alt: '' }));
    else preview.appendChild(el('span', { text: 'Nessuna immagine' }));
    box.querySelector('.img-remove').hidden = !url;
  }

  function renderGalleryEdit() {
    var box = $('gallery-edit');
    box.innerHTML = '';
    draft.gallery.forEach(function (url, i) {
      box.appendChild(el('figure', {}, [
        el('img', { src: url, alt: '' }),
        el('button', { type: 'button', class: 'g-remove', 'aria-label': 'Rimuovi foto', text: '✕', onclick: function () { draft.gallery.splice(i, 1); renderGalleryEdit(); } }),
      ]));
    });
    if (!draft.gallery.length) box.appendChild(el('p', { class: 'muted small', text: 'Nessuna foto: la sezione Galleria non viene mostrata.' }));
  }

  function renderHighlightFields(list) {
    var box = $('highlights-fields');
    box.innerHTML = '';
    for (var i = 0; i < 3; i += 1) {
      var h = list[i] || {};
      box.appendChild(el('div', { class: 'grid-hl' }, [
        el('input', { 'data-hl': 'title', value: h.title || '', maxlength: 60, placeholder: 'Titolo ' + (i + 1), 'aria-label': 'Titolo punto di forza ' + (i + 1) }),
        el('input', { 'data-hl': 'text', value: h.text || '', maxlength: 160, placeholder: 'Descrizione breve', 'aria-label': 'Descrizione punto di forza ' + (i + 1) }),
      ]));
    }
  }

  /** Righe del team: nome, ruolo, foto (bozza salvata con "Salva modifiche"). */
  function renderTeamFields() {
    var box = $('team-fields');
    box.innerHTML = '';
    if (!draft.team.length) box.appendChild(el('p', { class: 'muted small', text: 'Nessuna persona: la sezione Team non viene mostrata.' }));
    draft.team.forEach(function (m, i) {
      var photo = el('div', { class: 'team-photo' + (m.photo ? '' : ' empty') });
      if (m.photo) photo.appendChild(el('img', { src: m.photo, alt: '' }));
      else photo.appendChild(el('span', { text: 'Foto' }));
      var file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
      file.addEventListener('change', function () {
        var f = file.files[0];
        if (!f) return;
        uploadImage(f)
          .then(function (url) { m.photo = url; renderTeamFields(); toast('Foto caricata: ricordati di salvare'); })
          .catch(function (err) { toast(err.message, true); });
      });
      box.appendChild(el('div', { class: 'team-row' }, [
        photo,
        el('div', { class: 'team-inputs' }, [
          el('input', { value: m.name || '', maxlength: 60, placeholder: 'Nome', 'aria-label': 'Nome', oninput: function (e) { m.name = e.target.value; } }),
          el('input', { value: m.role || '', maxlength: 60, placeholder: 'Ruolo (es. Hair stylist)', 'aria-label': 'Ruolo', oninput: function (e) { m.role = e.target.value; } }),
          el('div', { class: 'team-actions' }, [
            el('label', { class: 'btn btn-small' }, [m.photo ? 'Cambia foto' : 'Carica foto', file]),
            m.photo ? el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Togli foto', onclick: function () { m.photo = ''; renderTeamFields(); } }) : null,
            el('button', { type: 'button', class: 'btn btn-small btn-danger', text: 'Rimuovi', onclick: function () { draft.team.splice(i, 1); renderTeamFields(); } }),
          ]),
        ]),
      ]));
    });
    $('team-add').hidden = draft.team.length >= 12;
  }

  /** Recensioni scelte: autore, stelle, quando, testo (bozza salvata con "Salva modifiche"). */
  function renderReviewFields() {
    var box = $('review-fields');
    box.innerHTML = '';
    if (!draft.reviewItems.length) box.appendChild(el('p', { class: 'muted small', text: 'Nessuna recensione: sul sito compaiono solo la valutazione e il link.' }));
    draft.reviewItems.forEach(function (r, i) {
      var stars = el('select', { 'aria-label': 'Stelle', onchange: function (e) { r.rating = Number(e.target.value); } });
      [5, 4, 3, 2, 1].forEach(function (n) { stars.appendChild(el('option', { value: n, text: '★★★★★'.slice(0, n) + ' ' + n })); });
      stars.value = String(r.rating || 5);
      box.appendChild(el('div', { class: 'review-row' }, [
        el('div', { class: 'review-top' }, [
          el('input', { value: r.author || '', maxlength: 60, placeholder: 'Nome (es. Giulia R.)', 'aria-label': 'Autore', oninput: function (e) { r.author = e.target.value; } }),
          stars,
          el('input', { value: r.when || '', maxlength: 40, placeholder: 'Quando (es. un mese fa)', 'aria-label': 'Quando', oninput: function (e) { r.when = e.target.value; } }),
        ]),
        el('textarea', { rows: 3, maxlength: 600, placeholder: 'Testo della recensione', 'aria-label': 'Testo', oninput: function (e) { r.text = e.target.value; } }, [r.text || '']),
        el('button', { type: 'button', class: 'btn btn-small btn-danger', text: 'Rimuovi', onclick: function () { draft.reviewItems.splice(i, 1); renderReviewFields(); } }),
      ]));
    });
    $('review-add').hidden = draft.reviewItems.length >= 8;
  }

  function renderShopPanel() {
    var b = state.me.business;
    var origin = window.location.origin;
    $('snippet-float').textContent = '<script src="' + origin + '/widget/widget.js" data-shop="' + b.slug + '" defer></script>';
    $('snippet-inline').textContent = '<script src="' + origin + '/widget/widget.js" data-shop="' + b.slug + '" data-mode="none" defer></script>';
    $('shop-page').textContent = origin + '/s/' + b.slug;
    $('shop-page-open').href = '/s/' + b.slug;

    var f = $('shop-form').elements;
    ['name', 'tagline', 'description', 'address', 'phone', 'email', 'instagram'].forEach(function (k) { f[k].value = b[k] || ''; });
    f.notifyEmail.value = b.notifyEmail || '';
    var rv = b.reviews || {};
    f.reviewRating.value = rv.rating || '';
    f.reviewCount.value = rv.count || '';
    f.reviewUrl.value = rv.url || '';
    f.reviewWriteUrl.value = rv.writeUrl || '';
    f.placeId.value = (b.google && b.google.placeId) || '';
    draft.reviewItems = (rv.items || []).map(function (it) { return { author: it.author, rating: it.rating, text: it.text, when: it.when }; });
    renderReviewFields();
    $('notify-warning').hidden = Boolean(state.me.features && state.me.features.email);
    f.primaryColor.value = b.primaryColor || '#1c1917';
    f.accentColor.value = b.accentColor || '#b08a4e';
    f.aboutTitle.value = b.site.aboutTitle || '';
    draft.images = { logo: b.logo, heroImage: b.site.heroImage, aboutImage: b.site.aboutImage };
    draft.gallery = b.site.gallery.slice();
    document.querySelectorAll('.img-field').forEach(renderImageField);
    renderGalleryEdit();
    renderHighlightFields(b.site.highlights || []);
    draft.team = (b.site.team || []).map(function (m) { return { name: m.name, role: m.role, photo: m.photo }; });
    renderTeamFields();
    f.brands.value = (b.site.brands || []).join('\n');
  }

  function saveShop(e) {
    e.preventDefault();
    var f = e.target.elements;
    var highlights = [];
    $('highlights-fields').querySelectorAll('.grid-hl').forEach(function (row) {
      var title = row.querySelector('[data-hl=title]').value.trim();
      if (title) highlights.push({ title: title, text: row.querySelector('[data-hl=text]').value.trim() });
    });
    var body = {
      name: f.name.value, tagline: f.tagline.value, description: f.description.value,
      address: f.address.value, phone: f.phone.value, email: f.email.value, instagram: f.instagram.value,
      notifyEmail: f.notifyEmail.value,
      reviews: { rating: Number(String(f.reviewRating.value).replace(',', '.')) || 0, count: Number(f.reviewCount.value) || 0, url: f.reviewUrl.value.trim(), writeUrl: f.reviewWriteUrl.value.trim(),
        items: draft.reviewItems.filter(function (it) { return (it.author || '').trim() && (it.text || '').trim(); }) },
      google: { placeId: f.placeId.value.trim() },
      primaryColor: f.primaryColor.value, accentColor: f.accentColor.value,
      logo: draft.images.logo || '',
      site: {
        heroImage: draft.images.heroImage || '', aboutImage: draft.images.aboutImage || '',
        aboutTitle: f.aboutTitle.value, highlights: highlights, gallery: draft.gallery,
        team: draft.team.filter(function (m) { return (m.name || '').trim(); }),
        brands: f.brands.value.split('\n').map(function (v) { return v.trim(); }).filter(Boolean),
      },
    };
    var btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    api('/business', { method: 'PUT', body: body })
      .then(function (b) { state.me.business = b; applyBusiness(b); toast('Negozio aggiornato'); })
      .catch(function (err) { toast(err.message, true); })
      .finally(function () { btn.disabled = false; });
  }

  function changePassword(e) {
    e.preventDefault();
    var f = e.target.elements;
    if (f.password.value.length < 8) return toast('La nuova password deve avere almeno 8 caratteri', true);
    if (f.password.value !== f.repeat.value) return toast('Le due password nuove non coincidono', true);
    var btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    return api('/password', { method: 'PUT', body: { current: f.current.value, password: f.password.value } })
      .then(function () { e.target.reset(); toast('Password cambiata'); })
      .catch(function (err) { toast(err.message, true); })
      .finally(function () { btn.disabled = false; });
  }

  function initShopForm() {
    $('shop-form').addEventListener('submit', saveShop);
    $('password-form').addEventListener('submit', changePassword);
    document.querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () { copyText(b.getAttribute('data-copy'), b); });
    });
    document.querySelectorAll('.img-field').forEach(function (box) {
      var key = box.getAttribute('data-img');
      box.querySelector('input[type=file]').addEventListener('change', function (e) {
        var file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        box.classList.add('loading');
        uploadImage(file)
          .then(function (url) { draft.images[key] = url; renderImageField(box); toast('Immagine caricata: ricordati di salvare'); })
          .catch(function (err) { toast(err.message, true); })
          .finally(function () { box.classList.remove('loading'); });
      });
      box.querySelector('.img-remove').addEventListener('click', function () { draft.images[key] = ''; renderImageField(box); });
    });
    $('review-add').addEventListener('click', function () {
      draft.reviewItems.push({ author: '', rating: 5, text: '', when: '' });
      renderReviewFields();
      var last = $('review-fields').querySelector('.review-row:last-child input');
      if (last) last.focus();
    });
    $('team-add').addEventListener('click', function () {
      draft.team.push({ name: '', role: '', photo: '' });
      renderTeamFields();
      var last = $('team-fields').querySelector('.team-row:last-child input');
      if (last) last.focus();
    });
    $('gallery-add').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files, 0, 12 - draft.gallery.length);
      e.target.value = '';
      files.reduce(function (p, file) {
        return p.then(function () { return uploadImage(file).then(function (url) { draft.gallery.push(url); renderGalleryEdit(); }); });
      }, Promise.resolve())
        .then(function () { if (files.length) toast('Foto caricate: ricordati di salvare'); })
        .catch(function (err) { toast(err.message, true); });
    });
  }

  /* =================================================================== */
  /* Negozi (solo super admin)                                           */
  /* =================================================================== */

  function slugify(v) {
    return v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  function loadPlatform() {
    var types = $('newshop-type');
    if (!types.options.length) {
      api('/platform/templates').then(function (list) {
        list.forEach(function (t) { types.appendChild(el('option', { value: t.id, text: t.label })); });
      });
    }
    return api('/platform/shops').then(renderShopList).catch(function (err) { toast(err.message, true); });
  }

  function credentialsBox(title, slug, owner) {
    var origin = window.location.origin;
    var lines = [
      'Pannello: ' + origin + '/admin',
      'Utente: ' + owner.username,
      'Password: ' + owner.password,
      'Pagina: ' + origin + '/s/' + slug,
      'Widget: <script src="' + origin + '/widget/widget.js" data-shop="' + slug + '" defer></script>',
    ];
    var pre = el('pre', { id: 'cred-' + slug, text: lines.join('\n') });
    var copy = el('button', { type: 'button', class: 'btn btn-small btn-primary', text: 'Copia tutto' });
    copy.addEventListener('click', function () { copyText('cred-' + slug, copy); });
    return el('div', {}, [el('strong', { text: title }), el('p', { class: 'muted small', text: 'Mandali al cliente: la password non verrà più mostrata.' }), pre, copy]);
  }

  function renderShopList(list) {
    var box = $('shop-list');
    box.innerHTML = '';
    var current = state.me.business.slug;
    list.forEach(function (b) {
      var enter = el('button', { type: 'button', class: 'btn btn-small btn-primary', text: b.slug === current ? 'In uso' : 'Gestisci' });
      enter.disabled = b.slug === current;
      enter.addEventListener('click', function () {
        api('/platform/shops/' + b.slug + '/enter', { method: 'POST', body: {} })
          .then(function () { return loadMe(); })
          .then(function () { state.services = []; state.selected = null; toast('Ora stai gestendo ' + b.name); showTab('calendar'); })
          .catch(function (err) { toast(err.message, true); });
      });
      var toggle = el('button', { type: 'button', class: 'btn btn-small' + (b.active ? ' btn-danger' : ''), text: b.active ? 'Disattiva' : 'Riattiva' });
      toggle.addEventListener('click', function () {
        if (b.active && !confirm('Disattivare "' + b.name + '"? Widget e pagina smetteranno di accettare prenotazioni.')) return;
        api('/platform/shops/' + b.slug, { method: 'PUT', body: { active: !b.active } }).then(loadPlatform).catch(function (err) { toast(err.message, true); });
      });
      var reset = el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Nuova password' });
      var extra = el('div', { class: 'shop-cred' });
      reset.addEventListener('click', function () {
        if (!confirm('Generare una nuova password per il titolare di "' + b.name + '"? Quella vecchia smetterà di funzionare.')) return;
        api('/platform/shops/' + b.slug + '/reset-password', { method: 'POST', body: {} })
          .then(function (owner) { extra.innerHTML = ''; extra.appendChild(credentialsBox('Nuove credenziali', b.slug, owner)); })
          .catch(function (err) { toast(err.message, true); });
      });
      box.appendChild(el('div', { class: 'shop-row' + (b.active ? '' : ' inactive') }, [
        el('img', { src: b.logo || monogram(b.name, b.primaryColor), alt: '', class: 'shop-logo' }),
        el('div', { class: 'shop-info' }, [
          el('strong', { text: b.name + (b.active ? '' : ' (disattivato)') }),
          el('span', { class: 'muted small', text: b.slug + (b.owner ? ' · titolare: ' + b.owner : '') + ' · ' + b.upcoming + ' prenotazioni in arrivo' }),
          el('a', { href: '/s/' + b.slug, target: '_blank', rel: 'noopener', class: 'small', text: window.location.host + '/s/' + b.slug }),
        ]),
        el('div', { class: 'shop-actions' }, [enter, reset, toggle]),
        extra,
      ]));
    });
  }

  function initPlatform() {
    var f = $('newshop-form');
    var slugTouched = false;
    f.elements.slug.addEventListener('input', function () { slugTouched = true; });
    f.elements.name.addEventListener('input', function () { if (!slugTouched) f.elements.slug.value = slugify(f.elements.name.value); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      $('newshop-error').hidden = true;
      var body = { name: f.elements.name.value, slug: f.elements.slug.value, type: f.elements.type.value, ownerUsername: f.elements.ownerUsername.value };
      api('/platform/shops', { method: 'POST', body: body })
        .then(function (res) {
          var box = $('newshop-result');
          box.innerHTML = '';
          box.appendChild(credentialsBox('Negozio "' + res.business.name + '" creato', res.business.slug, res.owner));
          box.hidden = false;
          f.reset(); slugTouched = false;
          loadPlatform();
        })
        .catch(function (err) { $('newshop-error').textContent = err.message; $('newshop-error').hidden = false; });
    });
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
    $('cal-today').addEventListener('click', function () { state.anchor = today(); state.selected = today(); loadCalendar(); });
    $('cal-new').addEventListener('click', function () {
      openBookingDialog(null, { date: state.view === 'month' ? (state.selected || state.anchor) : state.anchor });
    });
    document.querySelectorAll('.view-btn').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
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
    $('staff-form').addEventListener('submit', addStaff);
    $('hours-form').addEventListener('submit', saveHours);

    $('logout').addEventListener('click', function () {
      api('/logout', { method: 'POST', body: {} }).finally(function () { window.location.href = '/admin/login'; });
    });

    initShopForm();
    initThemeToggle();
    initPlatform();
    loadMe().then(function () { showTab('calendar'); });
  }

  init();
})();
