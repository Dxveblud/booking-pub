/**
 * Email ai clienti, link per disdire, promemoria, anti-spam, password,
 * privacy. Le email vengono intercettate (nessun invio vero).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;
let server;
let base;
const SUPER = { username: 'admin', password: 'password-di-test' };
const sent = [];

function client() {
  let cookie = '';
  return async function call(method, url, body) {
    const h = { Accept: 'application/json' };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (cookie) h.Cookie = cookie;
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

const time = () => require('../src/utils/time');

function nextTuesday() {
  const { nowInTimezone, addDays, weekdayOf } = time();
  let d = addDays(nowInTimezone('Europe/Rome').date, 2);
  while (weekdayOf(d) !== 2) d = addDays(d, 1);
  return d;
}

/** Data e ora tra `minutes` minuti (fuso del negozio), arrotondate ai 5 minuti. */
function inMinutes(minutes) {
  const { nowInTimezone, addDays, fromMinutes } = time();
  const now = nowInTimezone('Europe/Rome');
  let total = Math.ceil((now.minutes + minutes) / 5) * 5;
  const date = addDays(now.date, Math.floor(total / 1440));
  total %= 1440;
  // Il servizio deve finire entro la mezzanotte
  if (total > 1440 - 60) total = 1440 - 60;
  return { date, time: fromMinutes(total) };
}

/** Le email partono in modo asincrono: aspetta che ne arrivino `n` (o che scada il tempo). */
async function waitForMails(n, ms = 2000) {
  const end = Date.now() + ms;
  while (sent.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}
const mailsTo = (to) => sent.filter((m) => m.to === to);

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.CONFIG_PATH = path.join(__dirname, 'fixtures', 'config.json');
  process.env.MONGODB_URI = mongo.getUri('booking-customer');
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_USERNAME = SUPER.username;
  process.env.ADMIN_PASSWORD = SUPER.password;
  process.env.BOOKING_RATE_LIMIT = '1000';
  process.env.SESSION_SECRET = 'test-secret';
  process.env.PUBLIC_URL = 'https://booking.example.com';
  require('../src/services/mailer').setTransport({ sendMail: async (msg) => { sent.push(msg); } });
  const { connectDb } = require('../src/db');
  const { bootstrap } = require('../src/services/bootstrap');
  const { registerIntegrations } = require('../src/services/integrations');
  const { createApp } = require('../src/app');
  await connectDb();
  await bootstrap();
  registerIntegrations();
  await new Promise((resolve) => {
    server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await require('mongoose').connection.close();
  await mongo.stop();
});

const superAdmin = client();
const owner = client();
const anon = client();
const OWNER_MAIL = 'titolare@example.com';
const CUSTOMER_MAIL = 'giulia@example.com';
let shop;
let service;
let owner2; // sessione del titolare dopo il cambio password

test('preparazione: negozio con email degli avvisi', async () => {
  await superAdmin('POST', '/admin/api/login', SUPER);
  shop = (await superAdmin('POST', '/admin/api/platform/shops', { name: 'Barberia Sole', type: 'barbiere', email: 'info@sole.example' })).data;
  assert.equal((await owner('POST', '/admin/api/login', { username: shop.owner.username, password: shop.owner.password })).status, 200);
  assert.equal((await owner('PUT', '/admin/api/business', { notifyEmail: OWNER_MAIL })).status, 200);
  service = (await anon('GET', '/api/services?shop=barberia-sole')).data[0];
  const biz = await anon('GET', '/api/business?shop=barberia-sole');
  assert.equal(biz.data.features.emailConfirmation, true);
});

test('prenotazione con email: conferma al cliente con il link per disdire', async () => {
  const res = await anon('POST', '/api/bookings?shop=barberia-sole', {
    serviceId: service.id, date: nextTuesday(), time: '10:00',
    customer: { name: 'Giulia Verdi', phone: '+39 333 444 5555', email: CUSTOMER_MAIL },
  });
  assert.equal(res.status, 201);
  assert.match(res.data.manageUrl, /^\/disdici\/[a-f0-9]{32}$/);
  await waitForMails(2);
  const [confirm] = mailsTo(CUSTOMER_MAIL);
  assert.ok(confirm, 'email di conferma al cliente');
  assert.match(confirm.subject, /^Prenotazione confermata/);
  assert.ok(confirm.text.includes(`https://booking.example.com${res.data.manageUrl}`));
  assert.equal(confirm.replyTo, 'info@sole.example');
  assert.equal(mailsTo(OWNER_MAIL).length, 1);

  const token = res.data.manageUrl.split('/').pop();
  const page = await fetch(`${base}/disdici/${token}`);
  assert.equal(page.status, 200);
  const info = await anon('GET', `/api/manage/${token}`);
  assert.equal(info.data.status, 'confirmed');
  assert.equal(info.data.canCancel, true);
  assert.equal(info.data.business.name, 'Barberia Sole');
  assert.equal(info.data.customer, undefined, 'niente telefono/email nella risposta');

  const before = sent.length;
  const cancel = await anon('POST', `/api/manage/${token}/cancel`, {});
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.status, 'cancelled');
  assert.equal(cancel.data.cancelledBy, 'customer');
  await waitForMails(before + 2);
  assert.match(mailsTo(CUSTOMER_MAIL).at(-1).subject, /^Hai disdetto/);
  assert.match(mailsTo(OWNER_MAIL).at(-1).subject, /^Disdetta: Giulia Verdi/);

  // L'orario è di nuovo libero
  const again = await anon('POST', '/api/bookings?shop=barberia-sole', {
    serviceId: service.id, date: nextTuesday(), time: '10:00', customer: { name: 'Altro Cliente', phone: '3330000001' },
  });
  assert.equal(again.status, 201);
  assert.equal((await anon('GET', '/api/manage/00000000000000000000000000000000')).status, 404);
});

test('troppo tardi per disdire online', async () => {
  const soon = inMinutes(90); // il preavviso predefinito per disdire è di 2 ore
  const b = await owner('POST', '/admin/api/bookings', { serviceId: service.id, ...soon, customer: { name: 'Marco Neri', phone: '3330000002' } });
  assert.equal(b.status, 201);
  const { Booking } = require('../src/models');
  const { manageToken } = await Booking.findById(b.data.id).lean();
  const info = await anon('GET', `/api/manage/${manageToken}`);
  assert.equal(info.data.canCancel, false);
  assert.equal((await anon('POST', `/api/manage/${manageToken}/cancel`, {})).status, 409);
});

test('spostata o annullata dal negozio: il cliente viene avvisato', async () => {
  const date = nextTuesday();
  const b = await owner('POST', '/admin/api/bookings', {
    serviceId: service.id, date, time: '15:00', customer: { name: 'Sara Blu', phone: '3330000003', email: 'sara@example.com' },
  });
  await waitForMails(sent.length + 1);
  assert.match(mailsTo('sara@example.com').at(-1).subject, /^Prenotazione confermata/);
  assert.equal(mailsTo(OWNER_MAIL).filter((m) => m.subject.includes('Sara')).length, 0, 'niente avviso al titolare per le sue prenotazioni');

  let n = mailsTo('sara@example.com').length;
  await owner('PUT', `/admin/api/bookings/${b.data.id}`, { notes: 'solo una nota' });
  await owner('PUT', `/admin/api/bookings/${b.data.id}`, { time: '16:00' });
  await waitForMails(sent.length + 1, 500);
  assert.equal(mailsTo('sara@example.com').length, n + 1, 'solo il cambio di orario manda un\'email');
  assert.match(mailsTo('sara@example.com').at(-1).subject, /modificato/);

  n = mailsTo('sara@example.com').length;
  await owner('DELETE', `/admin/api/bookings/${b.data.id}`);
  await waitForMails(sent.length + 1);
  assert.match(mailsTo('sara@example.com').at(-1).subject, /^Appuntamento annullato/);
});

test('promemoria: uno solo, alle prenotazioni fatte per tempo', async () => {
  const { Booking } = require('../src/models');
  const { sendDueReminders } = require('../src/services/notifications/customer');
  const soon = inMinutes(5 * 60);
  const old = await owner('POST', '/admin/api/bookings', { serviceId: service.id, ...soon, customer: { name: 'Luca Rossi', phone: '3330000004', email: 'luca@example.com' } });
  const fresh = await owner('POST', '/admin/api/bookings', { serviceId: service.id, date: soon.date, time: '23:00', customer: { name: 'Ugo Gialli', phone: '3330000005', email: 'ugo@example.com' } });
  assert.equal(old.status, 201);
  assert.equal(fresh.status, 201);
  // La prima è stata prenotata due giorni fa, la seconda adesso
  // (direttamente sulla collezione: per Mongoose createdAt non si può modificare)
  await Booking.collection.updateOne({ _id: new (require('mongoose').Types.ObjectId)(old.data.id) }, { $set: { createdAt: new Date(Date.now() - 2 * 86400000) } });

  const first = await sendDueReminders();
  assert.ok(first >= 1);
  assert.match(mailsTo('luca@example.com').at(-1).subject, /^Promemoria/);
  assert.equal(mailsTo('ugo@example.com').filter((m) => /^Promemoria/.test(m.subject)).length, 0);
  assert.equal(await sendDueReminders(), 0, 'nessun doppione');
});

test('anti-spam: campo trappola e massimo di prenotazioni per numero', async () => {
  const date = nextTuesday();
  const trap = await anon('POST', '/api/bookings?shop=barberia-sole', {
    serviceId: service.id, date, time: '11:00', customer: { name: 'Bot', phone: '3330000009' }, website: 'http://spam.example',
  });
  assert.equal(trap.status, 400);

  const customer = { name: 'Pino Grigi', phone: '+39 333 999 8888' };
  for (const t of ['11:00', '11:30', '12:00']) {
    assert.equal((await anon('POST', '/api/bookings?shop=barberia-sole', { serviceId: service.id, date, time: t, customer })).status, 201);
  }
  // Stesso numero scritto in un altro modo
  const fourth = await anon('POST', '/api/bookings?shop=barberia-sole', { serviceId: service.id, date, time: '16:30', customer: { ...customer, phone: '3339998888' } });
  assert.equal(fourth.status, 409);
  assert.equal(fourth.data.error.code, 'TOO_MANY_ACTIVE');
});

test('password: cambio, sessioni scollegate, recupero via email', async () => {
  const other = client();
  await other('POST', '/admin/api/login', { username: shop.owner.username, password: shop.owner.password });
  assert.equal((await other('GET', '/admin/api/me')).status, 200);

  assert.equal((await owner('PUT', '/admin/api/password', { current: 'sbagliata', password: 'nuova-password-1' })).status, 400);
  assert.equal((await owner('PUT', '/admin/api/password', { current: shop.owner.password, password: 'corta' })).status, 400);
  assert.equal((await owner('PUT', '/admin/api/password', { current: shop.owner.password, password: 'nuova-password-1' })).status, 200);
  assert.equal((await owner('GET', '/admin/api/me')).status, 200, 'chi ha cambiato resta collegato');
  assert.equal((await other('GET', '/admin/api/me')).status, 401, 'gli altri dispositivi vengono scollegati');

  // Recupero: risposta uguale per username esistenti e no
  assert.equal((await anon('POST', '/admin/api/password/forgot', { username: 'non-esiste' })).status, 200);
  const before = mailsTo(OWNER_MAIL).length;
  assert.equal((await anon('POST', '/admin/api/password/forgot', { username: shop.owner.username })).status, 200);
  assert.equal(mailsTo(OWNER_MAIL).length, before + 1);
  const link = mailsTo(OWNER_MAIL).at(-1).text.match(/https:\/\/booking\.example\.com\/admin\/reset\/([a-f0-9]{48})/);
  assert.ok(link, 'link di recupero nell\'email');
  assert.equal((await fetch(`${base}/admin/reset/${link[1]}`)).status, 200);

  assert.equal((await anon('POST', '/admin/api/password/reset', { token: link[1], password: 'dal-link-1234' })).status, 200);
  assert.equal((await anon('POST', '/admin/api/password/reset', { token: link[1], password: 'di-nuovo-1234' })).status, 400, 'link usabile una volta');
  assert.equal((await owner('GET', '/admin/api/me')).status, 401);
  owner2 = client();
  assert.equal((await owner2('POST', '/admin/api/login', { username: shop.owner.username, password: 'dal-link-1234' })).status, 200);
});

test('privacy: informative e cancellazione dei dati vecchi', async () => {
  const shopPage = await fetch(`${base}/s/barberia-sole/privacy`);
  assert.equal(shopPage.status, 200);
  const html = await shopPage.text();
  assert.match(html, /Barberia Sole<\/strong>/);
  assert.match(html, /info@sole\.example/);
  assert.match(html, /24 mesi/);
  assert.doesNotMatch(html, /\{\{|<!--if:/);
  assert.equal((await fetch(`${base}/privacy`)).status, 200);
  assert.equal((await fetch(`${base}/s/non-esiste/privacy`)).status, 404);

  const { Booking } = require('../src/models');
  const { anonymizeOldBookings } = require('../src/services/privacyService');
  const { addDays, nowInTimezone } = time();
  const oldDate = addDays(nowInTimezone('Europe/Rome').date, -800);
  const old = await owner2('POST', '/admin/api/bookings', { serviceId: service.id, date: oldDate, time: '10:00', customer: { name: 'Vecchio Cliente', phone: '3331112222', email: 'vecchio@example.com' }, notes: 'nota' });
  assert.equal(old.status, 201);
  assert.ok((await anonymizeOldBookings(24)) >= 1);
  const doc = await Booking.findById(old.data.id).lean();
  assert.equal(doc.customer.name, 'Cliente');
  assert.equal(doc.customer.email, '');
  assert.equal(doc.notes, '');
  assert.equal(doc.manageToken, undefined);
  assert.ok(doc.anonymizedAt);
  // Le prenotazioni recenti restano intatte
  assert.ok(await Booking.exists({ 'customer.name': 'Pino Grigi' }));
});

test('health: risponde 200 se il database è collegato', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
