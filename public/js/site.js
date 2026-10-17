/**
 * Sito template: riempie la pagina con i dati di config.json (via API).
 * I pulsanti "Prenota" sono gestiti dal widget (attributo data-booking-open).
 */
(function () {
  'use strict';

  var DAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function $(id) { return document.getElementById(id); }
  function getJson(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); }); }
  function text(id, value) { var n = $(id); if (n) n.textContent = value || ''; }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function toMin(hhmm) { var p = hhmm.split(':'); return +p[0] * 60 + +p[1]; }

  /** Giorno della settimana e minuti correnti nel fuso orario dell'attività. */
  function nowIn(timeZone) {
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date());
    var get = function (t) { return parts.find(function (p) { return p.type === t; }).value; };
    var wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { day: wd, minutes: +get('hour') * 60 + +get('minute') };
  }

  function renderBusiness(b) {
    var site = b.site || {};
    document.title = b.name + ' · Prenota online';
    text('biz-name', b.name);
    text('biz-name-header', b.name);
    text('biz-footer-name', b.name);
    text('biz-tagline', b.tagline);
    text('biz-description', b.description);
    text('biz-address', b.address);
    text('biz-footer', b.address + (b.phone ? ' · ' + b.phone : ''));
    if (b.address) text('hero-eyebrow', 'Su appuntamento · ' + (b.mapsQuery || b.address.split(',').pop().trim()));
    if (b.logo) { $('biz-logo').src = b.logo; }
    if (b.phone) {
      var tel = 'tel:' + b.phone.replace(/[^+\d]/g, '');
      $('biz-phone').textContent = b.phone; $('biz-phone').href = tel; $('hero-call').href = tel;
    } else {
      $('hero-call').hidden = true;
    }
    if (b.email) { $('biz-email').textContent = b.email; $('biz-email').href = 'mailto:' + b.email; }
    $('maps-link').href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(b.address || b.name);

    var root = document.documentElement.style;
    if (b.primaryColor) root.setProperty('--ink', b.primaryColor);
    if (b.accentColor) root.setProperty('--accent', b.accentColor);
    var meta = document.querySelector('meta[name="description"]');
    if (meta && b.tagline) meta.content = b.name + ' – ' + b.tagline + ' Prenota online.';

    if (site.heroImage) $('hero').style.backgroundImage = 'url("' + site.heroImage + '")';
    if (site.aboutImage) { $('about-img').src = site.aboutImage; $('about-img').alt = b.name; $('about-img').hidden = false; }
    if (site.aboutTitle) text('about-title', site.aboutTitle);

    var hl = $('highlights');
    (site.highlights || []).forEach(function (h, i) {
      var li = el('li');
      li.appendChild(el('span', 'num', String(i + 1).padStart(2, '0')));
      var body = el('div');
      body.appendChild(el('strong', null, h.title));
      body.appendChild(el('span', null, h.text));
      li.appendChild(body);
      hl.appendChild(li);
    });

    var gallery = $('gallery');
    if (!(site.gallery || []).length) $('galleria').hidden = true;
    (site.gallery || []).forEach(function (src) {
      var fig = el('figure');
      var img = el('img');
      img.src = src; img.alt = ''; img.loading = 'lazy';
      fig.appendChild(img);
      gallery.appendChild(fig);
    });

    if (site.demoNotice) {
      text('demo-bar', 'Sito dimostrativo · prenotazioni di prova');
      $('demo-bar').hidden = false;
      text('demo-footer', site.demoNotice);
      $('demo-footer').hidden = false;
    }
    return b;
  }

  function renderServices(services, b) {
    var fmt = new Intl.NumberFormat(b.locale || 'it-IT', { style: 'currency', currency: b.currency || 'EUR', minimumFractionDigits: 0 });
    var ul = $('services');
    ul.innerHTML = '';
    services.forEach(function (s) {
      var li = el('li', 'menu-item');
      li.appendChild(el('span', 'menu-name', s.name));
      li.appendChild(el('span', 'menu-price', fmt.format(s.price)));
      li.appendChild(el('span', 'menu-desc', s.description || ''));
      var meta = el('span', 'menu-meta');
      meta.appendChild(el('span', 'menu-duration', s.durationMinutes + ' min'));
      var book = el('button', 'menu-book', 'Prenota →');
      book.type = 'button';
      book.addEventListener('click', function () {
        if (window.BookingWidget) window.BookingWidget.open({ serviceId: s.id });
      });
      meta.appendChild(book);
      li.appendChild(meta);
      ul.appendChild(li);
    });
  }

  function renderHours(hours, b) {
    var now = nowIn(b.timezone || 'Europe/Rome');
    var dl = $('hours');
    dl.innerHTML = '';
    WEEK_ORDER.forEach(function (d) {
      var intervals = hours[d] || [];
      var dt = el('dt', d === now.day ? 'today' : '', DAYS[d]);
      var dd = el('dd', d === now.day ? 'today' : (intervals.length ? '' : 'closed'),
        intervals.length ? intervals.map(function (i) { return i.start + '–' + i.end; }).join('  ·  ') : 'Chiuso');
      dl.appendChild(dt);
      dl.appendChild(dd);
    });

    // "Aperto ora" / "Chiuso" nell'hero
    var today = hours[now.day] || [];
    var current = today.find(function (i) { return now.minutes >= toMin(i.start) && now.minutes < toMin(i.end); });
    var status = $('open-status');
    if (current) {
      status.textContent = 'Aperto ora · chiude alle ' + current.end;
      status.classList.add('open');
    } else {
      var next = today.find(function (i) { return toMin(i.start) > now.minutes; });
      status.textContent = next ? 'Chiuso ora · riapre alle ' + next.start : 'Chiuso ora · prenota per i prossimi giorni';
    }
    status.hidden = false;
  }

  getJson('/api/business')
    .then(renderBusiness)
    .then(function (b) {
      return Promise.all([getJson('/api/services'), getJson('/api/opening-hours')]).then(function (res) {
        renderServices(res[0], b);
        renderHours(res[1], b);
      });
    })
    .catch(function (err) { console.error('Errore nel caricamento dei dati', err); });
})();
