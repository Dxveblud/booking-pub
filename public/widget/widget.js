/**
 * Booking Widget — loader da incorporare in qualunque sito.
 *
 * Uso minimo (pulsante flottante in basso a destra):
 *   <script src="https://TUO-DOMINIO/widget/widget.js" data-shop="codice-negozio" defer></script>
 *
 * Opzioni (attributi data-* sul tag <script>):
 *   data-shop="barberia-mario"                 codice del negozio (obbligatorio sui siti dei clienti)
 *   data-mode="floating" | "inline" | "none"   (default: floating)
 *   data-target="#id-contenitore"              dove inserire il pulsante (mode inline)
 *   data-label="Prenota ora"                   testo del pulsante
 *   data-color="#1f6f5c"                       colore del pulsante
 *   data-position="right" | "left"             lato del pulsante flottante
 *
 * Qualunque elemento con attributo [data-booking-open] apre il widget;
 * con data-booking-service="<id>" parte gia' dal servizio indicato.
 * API JavaScript: window.BookingWidget.open({ serviceId }) / .close()
 *
 * Il flusso di prenotazione gira dentro un iframe servito da questo stesso
 * server: gli stili del sito ospite non lo influenzano e viceversa.
 */
(function () {
  'use strict';

  if (window.BookingWidget) return; // già caricato

  var script = document.currentScript || document.querySelector('script[src*="widget/widget.js"]');
  var origin = new URL(script.src, window.location.href).origin;
  var opts = {
    mode: script.getAttribute('data-mode') || 'floating',
    target: script.getAttribute('data-target'),
    label: script.getAttribute('data-label') || 'Prenota',
    color: script.getAttribute('data-color') || '#1c1917',
    position: script.getAttribute('data-position') === 'left' ? 'left' : 'right',
  };
  // Letto all'apertura: la pagina può impostarlo anche dopo il caricamento
  function shop() { return script.getAttribute('data-shop') || ''; }

  var PREFIX = 'btw-';
  var overlay = null;
  var lastFocus = null;

  /* Stili del loader: tutti con prefisso per non collidere col sito ospite */
  function injectStyles() {
    var css =
      '.' + PREFIX + 'btn{font:600 16px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;background:' + opts.color + ';' +
      'border:0;border-radius:999px;padding:14px 22px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18);transition:transform .15s}' +
      '.' + PREFIX + 'btn:hover{transform:translateY(-1px)}' +
      '.' + PREFIX + 'btn:focus-visible{outline:3px solid #000;outline-offset:2px}' +
      '.' + PREFIX + 'floating{position:fixed;bottom:20px;' + opts.position + ':20px;z-index:2147483000}' +
      '.' + PREFIX + 'overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(18,15,13,.6);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;animation:' + PREFIX + 'fade .15s}' +
      '.' + PREFIX + 'frame{width:100%;height:100%;border:0;background:#fff}' +
      '@media (min-width:600px) and (min-height:640px){.' + PREFIX + 'frame{width:480px;height:min(780px,92vh);border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,.35)}}' +
      '@keyframes ' + PREFIX + 'fade{from{opacity:0}to{opacity:1}}';
    var style = document.createElement('style');
    style.setAttribute('data-booking-widget', '');
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  function open(options) {
    if (overlay) return;
    var serviceId = options && options.serviceId;
    var shopId = (options && options.shop) || shop();
    lastFocus = document.activeElement;
    overlay = document.createElement('div');
    overlay.className = PREFIX + 'overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Prenotazione');

    var iframe = document.createElement('iframe');
    iframe.className = PREFIX + 'frame';
    iframe.title = 'Prenotazione';
    iframe.src = origin + '/widget/booking.html?embed=1' +
      (shopId ? '&shop=' + encodeURIComponent(shopId) : '') +
      (serviceId ? '&service=' + encodeURIComponent(serviceId) : '');
    overlay.appendChild(iframe);

    // Click fuori dal riquadro → chiude
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    iframe.focus();
  }

  function close() {
    if (!overlay) return;
    overlay.parentNode.removeChild(overlay);
    overlay = null;
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // Messaggi dall'iframe (es. pulsante "chiudi")
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data || e.data.source !== 'booking-widget') return;
    if (e.data.type === 'close') close();
  });

  // Esc chiude il widget; preventDefault segnala al sito ospite che il tasto
  // e' gia' stato gestito (cosi' non chiude anche un suo eventuale popup)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay) { e.preventDefault(); close(); }
  });

  // Delegation: qualunque [data-booking-open] apre il widget
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-booking-open]');
    if (el) { e.preventDefault(); open({ serviceId: el.getAttribute('data-booking-service') }); }
  });

  function createButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = PREFIX + 'btn';
    btn.textContent = opts.label;
    btn.addEventListener('click', function () { open(); });
    return btn;
  }

  function init() {
    injectStyles();
    if (opts.mode === 'none') return;
    var btn = createButton();
    if (opts.mode === 'inline') {
      var container = opts.target ? document.querySelector(opts.target) : null;
      if (container) container.appendChild(btn);
      else script.parentNode.insertBefore(btn, script.nextSibling);
    } else {
      btn.classList.add(PREFIX + 'floating');
      document.body.appendChild(btn);
    }
  }

  window.BookingWidget = { open: open, close: close };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
