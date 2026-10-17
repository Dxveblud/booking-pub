/**
 * Provider email — NON IMPLEMENTATO.
 *
 * Suggerimento: usare nodemailer (SMTP) oppure un servizio come Resend,
 * Brevo o SendGrid. Variabili previste in .env.example: SMTP_*.
 */
module.exports = {
  name: 'email',

  isEnabled() {
    // Cambia in: return process.env.NOTIFY_EMAIL_ENABLED === 'true';
    return false;
  },

  // eslint-disable-next-line no-unused-vars
  async send({ template, booking }) {
    // TODO: comporre il messaggio da `template` e inviarlo a booking.customer.email
    throw new Error('Provider email non ancora implementato');
  },
};
