/**
 * Aspetto comune delle email (titolare e clienti): intestazione scura con il
 * nome del negozio, tabella dei dettagli, un pulsante facoltativo.
 * Restituisce sia la versione HTML sia quella di solo testo.
 */
const { escapeHtml } = require('../landing');
const { fromMinutes } = require('../../utils/time');

function formatDate(date, locale) {
  return new Intl.DateTimeFormat(locale || 'it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
}

function formatPrice(cents, b) {
  return new Intl.NumberFormat(b.locale || 'it-IT', { style: 'currency', currency: b.currency || 'EUR', minimumFractionDigits: 0 })
    .format((cents || 0) / 100);
}

/** "martedì 20 ottobre alle 09:00" */
function when(business, booking) {
  return `${formatDate(booking.date, business.locale)} alle ${fromMinutes(booking.startMinutes)}`;
}

/** Indirizzo pubblico del sito (PUBLIC_URL), senza barra finale. Vuoto = niente link nelle email. */
function publicUrl(pathname = '') {
  const base = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  return base ? base + pathname : '';
}

const TD_KEY = 'padding:10px 20px;color:#6f655b;border-top:1px solid #f0e9df;width:96px;vertical-align:top';
const TD_VAL = 'padding:10px 20px;border-top:1px solid #f0e9df;font-weight:bold';

/**
 * @param {object} p
 * @param {object} p.business  negozio (nome, colori)
 * @param {string} p.eyebrow   riga piccola sopra il nome (es. "Nuova prenotazione")
 * @param {string} [p.intro]   paragrafo sotto l'intestazione
 * @param {[string,string][]} p.rows  dettagli (etichetta, valore)
 * @param {{href:string,label:string}} [p.button]
 * @param {string} [p.outro]   paragrafo dopo i dettagli
 * @param {string} p.footer    nota in fondo (perché si riceve l'email)
 * @param {Object<string,string>} [p.links]  etichetta → href per trasformare un valore in link (es. telefono)
 */
function renderEmail({ business, eyebrow, intro, rows, button, outro, footer, links = {} }) {
  const ink = business.primaryColor || '#1c1917';
  const accent = business.accentColor || '#b08a4e';
  const cell = (k, v) => (links[k]
    ? `<a href="${escapeHtml(links[k])}" style="color:${ink}">${escapeHtml(v)}</a>`
    : escapeHtml(v).replace(/\n/g, '<br>'));

  const html = `<!doctype html><html><body style="margin:0;background:#f6f1ea;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
  <div style="background:#fff;border:1px solid #e7dfd3;border-radius:14px;overflow:hidden">
    <div style="background:${escapeHtml(ink)};color:#f5efe6;padding:18px 20px">
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${escapeHtml(accent)}">${escapeHtml(eyebrow)}</div>
      <div style="font-size:20px;font-weight:bold;margin-top:4px">${escapeHtml(business.name)}</div>
    </div>
    ${intro ? `<p style="margin:0;padding:16px 20px;font-size:15px;line-height:1.5">${escapeHtml(intro)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      ${rows.map(([k, v]) => `<tr><td style="${TD_KEY}">${escapeHtml(k)}</td><td style="${TD_VAL}">${cell(k, v)}</td></tr>`).join('')}
    </table>
    ${button ? `<div style="padding:16px 20px;border-top:1px solid #f0e9df"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:${escapeHtml(ink)};color:#f5efe6;text-decoration:none;padding:11px 18px;border-radius:999px;font-weight:bold;font-size:14px">${escapeHtml(button.label)}</a></div>` : ''}
    ${outro ? `<p style="margin:0;padding:0 20px 16px;font-size:14px;line-height:1.5;color:#6f655b">${escapeHtml(outro)}</p>` : ''}
  </div>
  <p style="font-size:12px;color:#6f655b;margin-top:14px">${escapeHtml(footer)}</p>
</div></body></html>`;

  const text = [
    eyebrow.toUpperCase() + ' · ' + business.name,
    '',
    intro || '',
    intro ? '' : null,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    button ? `${button.label}: ${button.href}` : '',
    outro || '',
    '',
    footer,
  ].filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { html, text };
}

module.exports = { renderEmail, formatDate, formatPrice, when, publicUrl };
