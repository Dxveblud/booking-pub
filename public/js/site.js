/**
 * Sito template: riempie la pagina con i dati di config.json (via API).
 * Il pulsante "Prenota" è gestito dal widget (attributo data-booking-open).
 */
(function () {
  'use strict';

  var DAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function $(id) { return document.getElementById(id); }
  function getJson(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); }); }
  function text(id, value) { var n = $(id); if (n) n.textContent = value || ''; }

  function renderBusiness(b) {
    document.title = b.name + ' · Prenota online';
    text('biz-name', b.name);
    text('biz-name-header', b.name);
    text('biz-tagline', b.tagline);
    text('biz-description', b.description);
    text('biz-address', b.address);
    text('biz-footer', '© ' + new Date().getFullYear() + ' ' + b.name);
    if (b.logo) { $('biz-logo').src = b.logo; $('biz-logo').alt = b.name; }
    if (b.phone) { $('biz-phone').textContent = b.phone; $('biz-phone').href = 'tel:' + b.phone.replace(/\s/g, ''); }
    if (b.email) { $('biz-email').textContent = b.email; $('biz-email').href = 'mailto:' + b.email; }
    if (b.primaryColor) document.documentElement.style.setProperty('--primary', b.primaryColor);
    var meta = document.querySelector('meta[name="description"]');
    if (meta && b.tagline) meta.content = b.name + ' – ' + b.tagline;
    return b;
  }

  function renderServices(services, b) {
    var fmt = new Intl.NumberFormat(b.locale || 'it-IT', { style: 'currency', currency: b.currency || 'EUR' });
    var ul = $('services');
    ul.innerHTML = '';
    services.forEach(function (s) {
      var li = document.createElement('li');
      var left = document.createElement('div');
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = s.name;
      var meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = s.durationMinutes + ' min' + (s.description ? ' · ' + s.description : '');
      left.appendChild(name);
      left.appendChild(meta);
      var price = document.createElement('div');
      price.className = 'price';
      price.textContent = fmt.format(s.price);
      li.appendChild(left);
      li.appendChild(price);
      ul.appendChild(li);
    });
  }

  function renderHours(hours) {
    var dl = $('hours');
    dl.innerHTML = '';
    WEEK_ORDER.forEach(function (d) {
      var dt = document.createElement('dt');
      dt.textContent = DAYS[d];
      var dd = document.createElement('dd');
      var intervals = hours[d] || [];
      dd.textContent = intervals.length
        ? intervals.map(function (i) { return i.start + '–' + i.end; }).join(', ')
        : 'Chiuso';
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
  }

  getJson('/api/business')
    .then(renderBusiness)
    .then(function (b) {
      return Promise.all([getJson('/api/services'), getJson('/api/opening-hours')]).then(function (res) {
        renderServices(res[0], b);
        renderHours(res[1]);
      });
    })
    .catch(function (err) { console.error('Errore nel caricamento dei dati', err); });
})();
