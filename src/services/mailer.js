/**
 * Invio email via SMTP (nodemailer).
 *
 * Attivo solo se in .env c'è SMTP_HOST. Va bene qualunque provider SMTP:
 * Brevo, Resend, Gmail con "password per le app", la casella del dominio…
 *
 *   SMTP_HOST=smtp-relay.brevo.com
 *   SMTP_PORT=587                 (465 = connessione cifrata diretta)
 *   SMTP_USER=…
 *   SMTP_PASS=…
 *   MAIL_FROM="Prenotazioni <noreply@tuodominio.it>"
 */
const nodemailer = require('nodemailer');

let transport = null;
let configured = false;

function isEnabled() {
  return Boolean(transport || process.env.SMTP_HOST);
}

function getTransport() {
  if (transport || configured) return transport;
  configured = true;
  if (!process.env.SMTP_HOST) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

/** Invia un'email. Restituisce false (senza errori) se l'email non è configurata. */
async function sendMail({ to, subject, text, html, replyTo }) {
  const t = getTransport();
  if (!t) return false;
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
    replyTo,
  });
  return true;
}

/** Solo per i test: sostituisce il trasporto SMTP (null = torna alla configurazione da .env). */
function setTransport(custom) {
  transport = custom;
  configured = Boolean(custom);
}

module.exports = { sendMail, isEnabled, setTransport };
