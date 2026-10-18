/**
 * Tema del pannello: scuro di base, chiaro se scelto con il pulsante ☀/☾.
 * Caricato nel <head> (senza defer) così la pagina non lampeggia di bianco.
 * Sulla pagina di login c'è lo stesso pulsante.
 */
(function () {
  'use strict';
  var theme = 'dark';
  try { theme = localStorage.getItem('bt-theme') || 'dark'; } catch (e) { /* storage non disponibile */ }
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');

  // Pagina di login: il pulsante non ha altra logica intorno
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn || !document.body.classList.contains('login-page')) return;
    var sync = function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      btn.textContent = dark ? '☀' : '☾';
      btn.setAttribute('aria-label', dark ? 'Passa al tema chiaro' : 'Passa al tema scuro');
    };
    btn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('bt-theme', next); } catch (e) { /* storage non disponibile */ }
      sync();
    });
    sync();
  });
})();
