/**
 * Pagine generate dal server: "/" (presenta il prodotto ai futuri clienti) e
 * le informative privacy (/privacy e /s/<negozio>/privacy).
 *
 * I modelli sono in src/views/ (fuori da public/, così non vengono serviti
 * "grezzi"). I segnaposto {{chiave}} si riempiono con i dati (config.json →
 * platform, dati del negozio); i blocchi <!--if:chiave-->…<!--/if:chiave-->
 * spariscono quando quel dato è vuoto (es. niente email → niente pulsante).
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const VIEWS = path.join(config.ROOT, 'src', 'views');
// Da aggiornare quando cambia il testo dell'informativa
const PRIVACY_UPDATED = '2026-10-18';

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const IF_BLOCK = /<!--if:(\w+)-->([\s\S]*?)<!--\/if:\1-->/g;

function render(template, data) {
  // I blocchi possono essere annidati: si ripete finché ne restano
  let out = template;
  let prev;
  do {
    prev = out;
    out = out.replace(IF_BLOCK, (m, key, inner) => (data[key] ? inner : ''));
  } while (out !== prev);
  return out.replace(/\{\{(\w+)\}\}/g, (m, key) => escapeHtml(data[key]));
}

// In produzione i modelli si leggono una volta sola; in sviluppo a ogni
// richiesta, così le modifiche all'HTML si vedono subito.
const templates = {};
function template(name) {
  if (!templates[name] || !config.env.isProduction) templates[name] = fs.readFileSync(path.join(VIEWS, name), 'utf8');
  return templates[name];
}

function renderLanding() {
  const { name, email, phone, demoShop } = config.platform;
  return render(template('landing.html'), {
    name,
    email,
    phone,
    tel: String(phone || '').replace(/[^+\d]/g, ''),
    demoShop,
    retentionMonths: config.privacy.retentionMonths,
    year: new Date().getFullYear(),
  });
}

/** Informativa privacy del negozio indicato, oppure della piattaforma (business = null). */
function renderPrivacy(business) {
  const { name: platformName, email: platformEmail } = config.platform;
  const data = {
    platformName,
    platformEmail,
    retentionMonths: config.privacy.retentionMonths,
    updated: new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(PRIVACY_UPDATED)),
    platform: !business,
    title: platformName,
    homeUrl: '/',
    logo: '/img/logo.svg',
  };
  if (business) {
    Object.assign(data, {
      shop: true,
      title: business.name,
      homeUrl: `/s/${business.slug}`,
      logo: business.logo,
      shopName: business.name,
      shopAddress: business.address,
      shopEmail: business.email,
      shopPhone: business.phone,
      shopContact: Boolean(business.email),
      shopPhoneOnly: !business.email && Boolean(business.phone),
    });
  }
  return render(template('privacy.html'), data);
}

module.exports = { renderLanding, renderPrivacy, render, escapeHtml };
