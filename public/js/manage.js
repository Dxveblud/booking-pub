/**
 * Pagina /disdici/<codice>: il cliente vede il suo appuntamento e può disdirlo.
 */
(function () {
  'use strict';

  var token = (window.location.pathname.match(/^\/disdici\/([a-f0-9]{32})\/?$/) || [])[1] || '';
  var $ = function (id) { return document.getElementById(id); };
  var data = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function api(path, method) {
    return fetch('/api/manage/' + token + path, {
      method: method || 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error((body.error && body.error.message) || 'Errore di rete, riprova.');
        return body;
      });
    });
  }

  function longDate(d, locale) {
    return new Date(d + 'T12:00:00').toLocaleDateString(locale || 'it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function price(v, b) {
    return new Intl.NumberFormat(b.locale || 'it-IT', { style: 'currency', currency: b.currency || 'EUR', minimumFractionDigits: v % 1 ? 2 : 0 }).format(v);
  }

  function noticeText(min) {
    if (min % 1440 === 0) return min / 1440 === 1 ? 'il giorno prima' : min / 1440 + ' giorni prima';
    if (min % 60 === 0) return min / 60 === 1 ? "un'ora prima" : min / 60 + ' ore prima';
    return min + ' minuti prima';
  }

  function render() {
    var b = data.business;
    document.title = 'Il tuo appuntamento · ' + b.name;
    $('mg-business').textContent = b.name;
    if (b.logo) $('mg-logo').src = b.logo; else $('mg-logo').hidden = true;
    var root = document.documentElement.style;
    if (b.primaryColor) root.setProperty('--ink', b.primaryColor);
    if (b.accentColor) root.setProperty('--accent', b.accentColor);

    var cancelled = data.status === 'cancelled';
    $('mg-label').textContent = cancelled ? 'Appuntamento disdetto' : data.past ? 'Appuntamento passato' : 'Appuntamento confermato';

    var box = $('mg-summary');
    box.innerHTML = '';
    var head = el('div', 'bk-summary-head');
    head.appendChild(el('small', null, data.durationMinutes + ' minuti'));
    head.appendChild(el('strong', null, data.serviceName));
    box.appendChild(head);
    var dl = el('dl');
    [['Quando', longDate(data.date, b.locale)], ['Orario', data.start + ' – ' + data.end], ['Con', data.staffName], ['Nome', data.customerName], ['Dove', b.address]]
      .forEach(function (r) {
        if (!r[1]) return;
        var row = el('div');
        row.appendChild(el('dt', null, r[0]));
        row.appendChild(el('dd', null, r[1]));
        dl.appendChild(row);
      });
    var total = el('div', 'total');
    total.appendChild(el('dt', null, 'Totale in negozio'));
    total.appendChild(el('dd', null, price(data.price, b)));
    dl.appendChild(total);
    box.appendChild(dl);
    box.classList.toggle('mg-cancelled', cancelled);
    box.hidden = false;

    var status = $('mg-status');
    if (cancelled) {
      status.textContent = data.cancelledBy === 'customer'
        ? 'Hai disdetto questo appuntamento. Grazie per aver liberato il posto.'
        : 'Il negozio ha annullato questo appuntamento.';
    } else if (data.past) {
      status.textContent = 'Questo appuntamento è già passato.';
    } else if (!data.canCancel) {
      status.textContent = 'Si può disdire online fino a ' + noticeText(data.cancelNoticeMinutes) + ". Ormai è tardi: se non puoi venire chiama il negozio.";
    } else {
      status.textContent = 'Se non puoi venire, disdici qui: liberi il posto per qualcun altro. Puoi farlo fino a ' + noticeText(data.cancelNoticeMinutes) + '.';
    }
    status.hidden = false;

    $('mg-cancel').hidden = cancelled || !data.canCancel;
    var tel = (b.phone || '').replace(/[^+\d]/g, '');
    $('mg-call').hidden = !tel || cancelled || data.past;
    $('mg-call').href = 'tel:' + tel;
    $('mg-call').textContent = 'Chiama ' + b.phone;
    $('mg-book').href = '/s/' + encodeURIComponent(b.slug);
    $('mg-actions').hidden = false;
  }

  function fail(err) {
    $('mg-label').textContent = 'Link non valido';
    $('mg-error').textContent = err.message === 'Prenotazione non trovata'
      ? 'Non troviamo questa prenotazione: il link potrebbe essere incompleto o scaduto.'
      : err.message;
    $('mg-error').hidden = false;
  }

  $('mg-cancel').addEventListener('click', function () {
    if (!window.confirm('Vuoi davvero disdire questo appuntamento?')) return;
    var btn = $('mg-cancel');
    btn.disabled = true;
    $('mg-error').hidden = true;
    api('/cancel', 'POST')
      .then(function (res) { data = res; render(); })
      .catch(function (err) { $('mg-error').textContent = err.message; $('mg-error').hidden = false; })
      .finally(function () { btn.disabled = false; });
  });

  if (!token) { $('mg-loading').hidden = true; fail(new Error('Prenotazione non trovata')); return; }
  api('')
    .then(function (res) { data = res; render(); })
    .catch(fail)
    .finally(function () { $('mg-loading').hidden = true; });
})();
