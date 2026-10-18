/** Pagina di login: accesso, password dimenticata, nuova password dal link. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var resetToken = (window.location.pathname.match(/^\/admin\/reset\/([a-f0-9]{48})\/?$/) || [])[1];

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Operazione non riuscita');
        return data;
      });
    });
  }

  function show(id) {
    ['login-form', 'forgot-form', 'reset-form'].forEach(function (f) { $(f).hidden = f !== id; });
    var first = $(id).querySelector('input');
    if (first) first.focus();
  }

  /** Gestione comune: disabilita il pulsante durante l'invio, mostra l'errore. */
  function handle(form, errorId, run) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      $(errorId).hidden = true;
      Promise.resolve()
        .then(run)
        .catch(function (err) {
          $(errorId).textContent = err.message;
          $(errorId).hidden = false;
        })
        .finally(function () { btn.disabled = false; });
    });
  }

  document.querySelectorAll('[data-show]').forEach(function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-show')); });
  });

  var login = $('login-form');
  handle(login, 'login-error', function () {
    return post('/admin/api/login', { username: login.username.value, password: login.password.value })
      .then(function () { window.location.href = '/admin'; });
  });

  var forgot = $('forgot-form');
  handle(forgot, 'forgot-error', function () {
    return post('/admin/api/password/forgot', { username: forgot.username.value }).then(function () {
      $('forgot-done').hidden = false;
    });
  });

  var reset = $('reset-form');
  handle(reset, 'reset-error', function () {
    if (reset.password.value.length < 8) throw new Error('La password deve avere almeno 8 caratteri');
    if (reset.password.value !== reset.repeat.value) throw new Error('Le due password non coincidono');
    return post('/admin/api/password/reset', { token: resetToken, password: reset.password.value }).then(function () {
      window.history.replaceState(null, '', '/admin/login');
      show('login-form');
      $('login-notice').hidden = false;
    });
  });

  if (resetToken) show('reset-form');
})();
