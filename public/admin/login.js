/** Pagina di login dell'amministratore. */
(function () {
  'use strict';
  var form = document.getElementById('login-form');
  var errorBox = document.getElementById('login-error');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button');
    btn.disabled = true;
    errorBox.hidden = true;
    fetch('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.username.value, password: form.password.value }),
    })
      .then(function (res) {
        if (res.ok) { window.location.href = '/admin'; return null; }
        return res.json().then(function (data) { throw new Error(data.error ? data.error.message : 'Accesso non riuscito'); });
      })
      .catch(function (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
        btn.disabled = false;
      });
  });
})();
