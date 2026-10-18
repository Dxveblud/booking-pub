/** Pulsanti [data-scroll="id"]: portano alla sezione senza cambiare l'indirizzo (niente "#"). */
(function () {
  'use strict';
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-scroll]');
    if (!btn) return;
    var id = btn.getAttribute('data-scroll');
    if (id === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    var target = document.getElementById(id);
    if (!target) return;
    var nav = document.querySelector('.nav');
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - (nav ? nav.offsetHeight : 0), behavior: 'smooth' });
  });
})();
