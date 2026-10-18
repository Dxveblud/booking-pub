/**
 * Sito del negozio (/s/<codice>, /servizi, /chi-siamo, /contatti).
 * L'HTML arriva dal server con nome e link; qui si riempiono i contenuti
 * (via API) presenti nella pagina corrente: ogni funzione salta da sola gli
 * elementi che non ci sono. I pulsanti "Prenota" li gestisce il widget.
 */
(function () {
  'use strict';

  var DAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  var SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  var SHOP = document.body.getAttribute('data-shop') || '';
  var PAGE = document.body.getAttribute('data-page') || 'home';

  function $(id) { return document.getElementById(id); }
  function getJson(url) {
    if (SHOP) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'shop=' + encodeURIComponent(SHOP);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); });
  }
  function text(id, value) { var n = $(id); if (n) n.textContent = value || ''; }
  function hide(id) { var n = $(id); if (n) n.hidden = true; }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function toMin(hhmm) { var p = hhmm.split(':'); return +p[0] * 60 + +p[1]; }
  function initials(name) {
    return String(name || '').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '•';
  }

  /** Logo di ripiego: l'iniziale del negozio nei suoi colori. */
  function monogram(name, color) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="' + (color || '#1c1917') +
      '" stroke="rgba(255,255,255,.35)"/><text x="32" y="41" font-family="Georgia,serif" font-size="24" fill="#fff" text-anchor="middle">' +
      initials(name).charAt(0) + '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  /** Giorno della settimana e minuti correnti nel fuso orario dell'attività. */
  function nowIn(timeZone) {
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date());
    var get = function (t) { return parts.find(function (p) { return p.type === t; }).value; };
    var wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { day: wd, minutes: +get('hour') * 60 + +get('minute') };
  }

  /* ------------------------------- Menu --------------------------------- */

  document.querySelectorAll('[data-nav]').forEach(function (a) {
    if (a.getAttribute('data-nav') === PAGE) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
  });
  var toggle = $('menu-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Chiudi il menu' : 'Apri il menu');
    });
  }

  /* ------------------------------ Contenuti ----------------------------- */

  function renderCommon(b) {
    var site = b.site || {};
    var logo = b.logo || monogram(b.name, b.primaryColor);
    $('biz-logo').src = logo;
    $('biz-logo').alt = b.name;
    document.querySelectorAll('.brand-footer img').forEach(function (img) { img.src = logo; });

    var root = document.documentElement.style;
    if (b.primaryColor) root.setProperty('--ink', b.primaryColor);
    if (b.accentColor) root.setProperty('--accent', b.accentColor);

    text('footer-tagline', b.tagline);
    text('footer-address', b.address);
    var tel = b.phone ? 'tel:' + b.phone.replace(/[^+\d]/g, '') : '';
    [['footer-phone', b.phone], ['biz-phone', b.phone]].forEach(function (p) {
      var a = $(p[0]);
      if (a && p[1]) { a.textContent = p[1]; a.href = tel; a.hidden = false; }
    });
    if ($('call-link') && tel) { $('call-link').href = tel; $('call-link').hidden = false; }
    if ($('biz-email') && b.email) { $('biz-email').textContent = b.email; $('biz-email').href = 'mailto:' + b.email; $('biz-email').hidden = false; }
    if ($('biz-instagram') && /^https:\/\//.test(b.instagram || '')) { $('biz-instagram').href = b.instagram; $('biz-instagram').hidden = false; }
    if ($('maps-link')) $('maps-link').href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(b.address || b.name);
    text('biz-address', b.address);

    if (site.demoNotice) {
      text('demo-bar', 'Sito dimostrativo · prenotazioni di prova');
      $('demo-bar').hidden = false;
      text('demo-footer', site.demoNotice);
      $('demo-footer').hidden = false;
    }
  }

  function renderHero(b) {
    if (!$('hero')) return;
    var site = b.site || {};
    text('biz-tagline', b.tagline);
    if (b.address) text('hero-eyebrow', 'Su appuntamento · ' + (b.mapsQuery || b.address.split(',').pop().replace(/\d{5}/, '').trim()));
    if (b.logo) { $('hero-logo').src = b.logo; $('hero-logo').alt = b.name; $('hero-logo').hidden = false; }
    if (site.heroImage) { $('hero').style.backgroundImage = 'url("' + site.heroImage + '")'; $('hero').classList.add('has-photo'); }
  }

  function renderAbout(b) {
    var site = b.site || {};
    text('biz-description', b.description);
    if (site.aboutTitle && $('about-title')) text('about-title', site.aboutTitle);
    if ($('about-img')) {
      if (site.aboutImage) { $('about-img').src = site.aboutImage; $('about-img').alt = b.name; $('about-img').hidden = false; }
      else if ($('chi-siamo')) $('chi-siamo').classList.add('no-photo');
    }
  }

  function renderHighlights(b) {
    var hl = $('highlights');
    if (!hl) return;
    var list = (b.site && b.site.highlights) || [];
    if (!list.length) { hide('highlights-section'); return; }
    list.forEach(function (h, i) {
      var li = el('li');
      li.appendChild(el('span', 'num', String(i + 1).padStart(2, '0')));
      var body = el('div');
      body.appendChild(el('strong', null, h.title));
      body.appendChild(el('span', null, h.text));
      li.appendChild(body);
      hl.appendChild(li);
    });
  }

  function renderTeam(b) {
    var box = $('team');
    if (!box) return;
    var team = (b.site && b.site.team) || [];
    if (!team.length) { hide('team-section'); return; }
    team.forEach(function (m) {
      var card = el('figure', 'member');
      var pic = el('div', 'member-photo');
      if (m.photo) {
        var img = el('img');
        img.src = m.photo; img.alt = m.name; img.loading = 'lazy';
        pic.appendChild(img);
      } else {
        pic.classList.add('empty');
        pic.appendChild(el('span', 'member-initials', initials(m.name)));
      }
      card.appendChild(pic);
      var cap = el('figcaption');
      cap.appendChild(el('strong', null, m.name));
      if (m.role) cap.appendChild(el('span', null, m.role));
      card.appendChild(cap);
      box.appendChild(card);
    });
  }

  function renderGallery(b) {
    var box = $('gallery');
    if (!box) return;
    var list = (b.site && b.site.gallery) || [];
    if (!list.length) { hide('galleria'); return; }
    list.forEach(function (src) {
      var fig = el('figure');
      var img = el('img');
      img.src = src; img.alt = ''; img.loading = 'lazy';
      fig.appendChild(img);
      box.appendChild(fig);
    });
  }

  function renderBrands(b) {
    var ul = $('brands');
    if (!ul) return;
    var list = (b.site && b.site.brands) || [];
    if (!list.length) { hide('brands-section'); return; }
    list.forEach(function (name) { ul.appendChild(el('li', null, name)); });
  }

  /** Valutazione Google (inserita dal negozio) con il link alle recensioni. */
  function renderReviews(b) {
    var r = b.reviews;
    var holder = $('reviews-box');
    if (!holder || !r || !r.rating) return;
    var box = el('div', 'reviews');
    box.appendChild(el('p', 'eyebrow', 'Dicono di noi'));
    var full = Math.round(r.rating);
    box.appendChild(el('span', 'reviews-stars', '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full)));
    box.appendChild(el('span', 'reviews-score', Number(r.rating).toFixed(1).replace('.', ',')));
    if (r.count) box.appendChild(el('span', 'reviews-count', r.count + (r.count === 1 ? ' recensione' : ' recensioni') + ' su Google'));
    if (r.url) {
      var a = el('a', 'btn btn-outline btn-sm', 'Leggi le recensioni');
      a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
      box.appendChild(a);
    }
    holder.appendChild(box);
    $('reviews-section').hidden = false;
  }

  function priceFormat(b) {
    return new Intl.NumberFormat(b.locale || 'it-IT', { style: 'currency', currency: b.currency || 'EUR', minimumFractionDigits: 0 });
  }
  function bookButton(service, cls, label) {
    var btn = el('button', cls, label || 'Prenota');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      if (window.BookingWidget) window.BookingWidget.open({ serviceId: service.id });
    });
    return btn;
  }

  /** Listino completo (pagina Servizi). */
  function renderServices(services, b) {
    var ul = $('services');
    if (!ul) return;
    var fmt = priceFormat(b);
    services.forEach(function (s) {
      var li = el('li', 'menu-item');
      var line = el('div', 'menu-line');
      line.appendChild(el('span', 'menu-name', s.name));
      line.appendChild(el('span', 'menu-dots'));
      line.appendChild(el('span', 'menu-price', fmt.format(s.price)));
      li.appendChild(line);
      if (s.description) li.appendChild(el('span', 'menu-desc', s.description));
      var meta = el('div', 'menu-meta');
      meta.appendChild(el('span', 'menu-duration', s.durationMinutes + ' minuti'));
      meta.appendChild(bookButton(s, 'menu-book'));
      li.appendChild(meta);
      ul.appendChild(li);
    });
  }

  /** Tre servizi in evidenza (home). */
  function renderFeatured(services, b) {
    var box = $('featured');
    if (!box) return;
    if (!services.length) { hide('featured-section'); return; }
    var fmt = priceFormat(b);
    services.slice(0, 3).forEach(function (s, i) {
      var card = el('article', 'feature');
      card.appendChild(el('span', 'feature-num', String(i + 1).padStart(2, '0')));
      card.appendChild(el('h3', null, s.name));
      if (s.description) card.appendChild(el('p', 'feature-desc', s.description));
      var foot = el('div', 'feature-foot');
      foot.appendChild(el('span', 'feature-price', 'da ' + fmt.format(s.price) + ' · ' + s.durationMinutes + ' min'));
      foot.appendChild(bookButton(s, 'menu-book'));
      card.appendChild(foot);
      box.appendChild(card);
    });
  }

  /** "Mar–Gio 09:00–18:00 · Ven 09:00–19:00": giorni di fila con lo stesso orario raggruppati. */
  function hoursSummary(hours) {
    var groups = [];
    WEEK_ORDER.forEach(function (d) {
      var key = (hours[d] || []).map(function (i) { return i.start + '–' + i.end; }).join(', ');
      var last = groups[groups.length - 1];
      if (last && last.key === key) last.to = d; else groups.push({ from: d, to: d, key: key });
    });
    return groups.filter(function (g) { return g.key; }).map(function (g) {
      return (g.from === g.to ? SHORT[g.from] : SHORT[g.from] + '–' + SHORT[g.to]) + ' ' + g.key;
    });
  }

  function renderHours(hours, b) {
    var now = nowIn(b.timezone || 'Europe/Rome');
    var footer = $('footer-hours');
    if (footer) {
      footer.innerHTML = '';
      hoursSummary(hours).forEach(function (line) { footer.appendChild(el('span', 'footer-line', line)); });
    }

    var dl = $('hours');
    if (dl) {
      WEEK_ORDER.forEach(function (d) {
        var intervals = hours[d] || [];
        var dt = el('dt', d === now.day ? 'today' : '', DAYS[d]);
        var dd = el('dd', d === now.day ? 'today' : (intervals.length ? '' : 'closed'), intervals.length ? null : 'Chiuso');
        intervals.forEach(function (i) { dd.appendChild(el('span', null, i.start + ' – ' + i.end)); });
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
    }

    var status = $('open-status');
    if (status) {
      var today = hours[now.day] || [];
      var current = today.find(function (i) { return now.minutes >= toMin(i.start) && now.minutes < toMin(i.end); });
      if (current) {
        status.textContent = 'Aperto ora · chiude alle ' + current.end;
        status.classList.add('open');
      } else {
        var next = today.find(function (i) { return toMin(i.start) > now.minutes; });
        status.textContent = next ? 'Chiuso ora · riapre alle ' + next.start : 'Chiuso ora · prenota per i prossimi giorni';
      }
      status.hidden = false;
    }
  }

  // La barra "Prenota" fissa su mobile compare dopo il primo schermo
  var bar = document.querySelector('.mobile-cta');
  var first = document.querySelector('.hero, .page-hero');
  if (bar && first && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      bar.classList.toggle('show', !entries[0].isIntersecting);
    }, { threshold: 0.15 }).observe(first);
  } else if (bar) {
    bar.classList.add('show');
  }

  var needsServices = $('services') || $('featured');
  getJson('/api/business')
    .then(function (b) {
      renderCommon(b);
      renderHero(b);
      renderAbout(b);
      renderHighlights(b);
      renderTeam(b);
      renderGallery(b);
      renderBrands(b);
      renderReviews(b);
      return Promise.all([needsServices ? getJson('/api/services') : [], getJson('/api/opening-hours')]).then(function (res) {
        renderServices(res[0], b);
        renderFeatured(res[0], b);
        renderHours(res[1], b);
      });
    })
    .catch(function (err) {
      console.error('Errore nel caricamento dei dati', err);
      text('biz-name', 'Pagina non disponibile');
      text('hero-eyebrow', '');
      text('biz-tagline', 'Questo negozio non esiste o non è più attivo.');
      document.querySelectorAll('[data-booking-open], .nav-links, .section, .cta').forEach(function (n) { n.hidden = true; });
    });
})();
