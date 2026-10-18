/**
 * Pagina della piattaforma ("/"), pagine dei negozi e avvisi email al titolare.
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

function nextTuesday() {
  const { nowInTimezone, addDays, weekdayOf } = require('../src/utils/time');
  let d = addDays(nowInTimezone('Europe/Rome').date, 2);
  while (weekdayOf(d) !== 2) d = addDays(d, 1);
  return d;
}

/** Gli avvisi partono in modo asincrono: aspetta che arrivino (o che scada il tempo). */
async function waitForMails(n, ms = 2000) {
  const end = Date.now() + ms;
  while (sent.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.CONFIG_PATH = path.join(__dirname, 'fixtures', 'config.json');
  process.env.MONGODB_URI = mongo.getUri('booking-platform');
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_USERNAME = SUPER.username;
  process.env.ADMIN_PASSWORD = SUPER.password;
  process.env.BOOKING_RATE_LIMIT = '1000';
  process.env.SESSION_SECRET = 'test-secret';
  process.env.PUBLIC_URL = 'https://booking.example.com/';
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
let shop;

test('"/" presenta la piattaforma, /s/<codice> il negozio (404 se non esiste)', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<title>[^<]*Prenotazioni online per la tua attività<\/title>/);
  assert.doesNotMatch(html, /\{\{\w+\}\}|<!--if:/, 'nessun segnaposto rimasto');
  assert.match(html, /href="\/admin\/login"/);

  assert.equal((await fetch(base + '/s/demo')).status, 200);
  assert.equal((await fetch(base + '/s/non-esiste')).status, 404);
  assert.equal((await fetch(base + '/robots.txt')).status, 200);
});

test('il titolare imposta l\'email per gli avvisi', async () => {
  await superAdmin('POST', '/admin/api/login', SUPER);
  shop = (await superAdmin('POST', '/admin/api/platform/shops', { name: 'Estetica Luna', type: 'estetista' })).data;
  assert.equal((await owner('POST', '/admin/api/login', { username: shop.owner.username, password: shop.owner.password })).status, 200);

  const me = await owner('GET', '/admin/api/me');
  assert.equal(me.data.features.email, true);
  assert.equal(me.data.business.notifyEmail, '');

  assert.equal((await owner('PUT', '/admin/api/business', { notifyEmail: 'non-una-email' })).status, 400);
  const ok = await owner('PUT', '/admin/api/business', { notifyEmail: 'Luna@Example.com' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.notifyEmail, 'luna@example.com');
  // L'indirizzo degli avvisi non è pubblico
  assert.equal((await anon('GET', '/api/business?shop=estetica-luna')).data.notifyEmail, undefined);
});

test('una prenotazione online manda l\'avviso al titolare, una dal pannello no', async () => {
  const date = nextTuesday();
  const service = (await anon('GET', '/api/services?shop=estetica-luna')).data[0];
  const customer = { name: 'Giulia <b>Rossi</b>', phone: '+39 333 111 2222' };

  const online = await anon('POST', '/api/bookings?shop=estetica-luna', { serviceId: service.id, date, time: '10:00', customer, notes: 'Prima volta' });
  assert.equal(online.status, 201);
  await waitForMails(1);
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.to, 'luna@example.com');
  assert.match(mail.subject, /^Nuova prenotazione: Giulia <b>Rossi<\/b>, .+ alle 10:00$/);
  assert.match(mail.text, /\+39 333 111 2222/);
  assert.match(mail.text, /Note: Prima volta/);
  assert.match(mail.text, /https:\/\/booking\.example\.com\/admin/);
  assert.match(mail.html, /Giulia &lt;b&gt;Rossi&lt;\/b&gt;/, 'HTML con i dati del cliente sempre "escaped"');

  const manual = await owner('POST', '/admin/api/bookings', { serviceId: service.id, date, time: '15:00', customer });
  assert.equal(manual.status, 201);
  await waitForMails(2, 300);
  assert.equal(sent.length, 1);
});

test('senza email impostata nessun avviso', async () => {
  await owner('PUT', '/admin/api/business', { notifyEmail: '' });
  const service = (await anon('GET', '/api/services?shop=estetica-luna')).data[0];
  const res = await anon('POST', '/api/bookings?shop=estetica-luna', {
    serviceId: service.id, date: nextTuesday(), time: '11:30', customer: { name: 'Anna Bianchi', phone: '3331234567' },
  });
  assert.equal(res.status, 201);
  await waitForMails(2, 300);
  assert.equal(sent.length, 1);
});
