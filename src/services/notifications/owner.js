/**
 * Avvisi al titolare: un'email quando un cliente prenota online e quando
 * disdice dal suo link.
 *
 * L'indirizzo si imposta nel pannello (Negozio → Avvisi). Niente avviso per
 * le operazioni fatte dal pannello (le ha appena fatte il titolare), per le
 * prenotazioni finte della demo e per il negozio dimostrativo.
 */
const config = require('../../config');
const mailer = require('../mailer');
const { getBusiness } = require('../businessService');
const { fromMinutes } = require('../../utils/time');
const { BOOKING_EVENTS, onBookingEvent } = require('../events');
const { renderEmail, formatPrice, when, publicUrl } = require('./layout');

const FOOTER = "Ricevi questa email perché l'indirizzo è impostato negli avvisi del pannello.";

function detailRows(business, booking) {
  const rows = [
    ['Servizio', `${booking.serviceName} (${booking.durationMinutes} min, ${formatPrice(booking.priceCents, business)})`],
    ['Quando', `${when(business, booking)} – ${fromMinutes(booking.endMinutes)}`],
    ['Cliente', booking.customer.name],
    ['Telefono', booking.customer.phone],
  ];
  if (booking.staffName) rows.splice(2, 0, ['Con', booking.staffName]);
  if (booking.customer.email) rows.push(['Email', booking.customer.email]);
  if (booking.notes) rows.push(['Note', booking.notes]);
  return rows;
}

function message(business, booking, { eyebrow, subject }) {
  const panel = publicUrl('/admin');
  const { html, text } = renderEmail({
    business,
    eyebrow,
    rows: detailRows(business, booking),
    button: panel ? { href: panel, label: 'Apri il calendario' } : null,
    footer: FOOTER,
    links: { Telefono: `tel:${booking.customer.phone.replace(/[^+\d]/g, '')}` },
  });
  return { subject, text, html, replyTo: booking.customer.email || undefined, fromName: `Prenotazioni ${business.name}` };
}

function buildNewBookingEmail(business, booking) {
  return message(business, booking, {
    eyebrow: 'Nuova prenotazione',
    subject: `Nuova prenotazione: ${booking.customer.name}, ${when(business, booking)}`,
  });
}

function buildCancelledEmail(business, booking) {
  return message(business, booking, {
    eyebrow: 'Disdetta',
    subject: `Disdetta: ${booking.customer.name}, ${when(business, booking)}`,
  });
}

/** Negozio a cui mandare l'avviso, oppure null se non va mandato. */
async function recipientShop(booking) {
  if (booking.isDemo || !mailer.isEnabled()) return null;
  if (config.demo.enabled && booking.businessId === config.platform.demoShop) return null;
  const business = await getBusiness(booking.businessId);
  return business && business.notifyEmail ? business : null;
}

async function notifyNewBooking(booking) {
  if (booking.source !== 'online') return false;
  const business = await recipientShop(booking);
  if (!business) return false;
  return mailer.sendMail({ to: business.notifyEmail, ...buildNewBookingEmail(business, booking) });
}

async function notifyCancelled(booking) {
  if (booking.cancelledBy !== 'customer') return false;
  const business = await recipientShop(booking);
  if (!business) return false;
  return mailer.sendMail({ to: business.notifyEmail, ...buildCancelledEmail(business, booking) });
}

function registerOwnerNotifications() {
  onBookingEvent(BOOKING_EVENTS.CREATED, notifyNewBooking);
  onBookingEvent(BOOKING_EVENTS.CANCELLED, notifyCancelled);
}

module.exports = { registerOwnerNotifications, notifyNewBooking, notifyCancelled, buildNewBookingEmail };
