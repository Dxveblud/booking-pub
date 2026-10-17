/**
 * Provider WhatsApp — NON IMPLEMENTATO.
 *
 * Suggerimento: WhatsApp Business Cloud API (Meta) oppure Twilio.
 * Nota: per messaggi avviati dall'attività servono template approvati.
 * Variabili previste in .env.example: WHATSAPP_*.
 */
module.exports = {
  name: 'whatsapp',

  isEnabled() {
    // Cambia in: return process.env.NOTIFY_WHATSAPP_ENABLED === 'true';
    return false;
  },

  // eslint-disable-next-line no-unused-vars
  async send({ template, booking }) {
    // TODO: inviare il template a booking.customer.phone (formato E.164)
    throw new Error('Provider WhatsApp non ancora implementato');
  },
};
