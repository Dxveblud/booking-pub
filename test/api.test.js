/**
 * Test di integrazione: avvia l'app con un MongoDB in memoria e verifica
 * il flusso completo, in particolare l'assenza di doppie prenotazioni.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;
let server;
let base;
let cookie = '';

const ADMIN = { username: 'admin', password: 'password-di-test' };

async function call(method, path, body, { auth = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = res.headers.get('set-cookie');
  if (auth && setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/** Prossimo martedì (aperto 9–13, 15–19:30 in config.json) ad almeno 2 giorni da oggi. */
function nextTuesday(offsetWeeks = 0) {
  const { nowInTimezone, addDays, weekdayOf } = require('../src/utils/time');
  let d = addDays(nowInTimezone('Europe/Rome').date, 2);
  while (weekdayOf(d) !== 2) d = addDays(d, 1);
  return addDays(d, offsetWeeks * 7);
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('booking-test');
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_USERNAME = ADMIN.username;
  process.env.ADMIN_PASSWORD = ADMIN.password;
  process.env.BOOKING_RATE_LIMIT = '1000';
  process.env.SESSION_SECRET = 'test-secret';

  const { connectDb } = require('../src/db');
  const { bootstrap } = require('../src/services/bootstrap');
  const { createApp } = require('../src/app');
  await connectDb();
  await bootstrap();
  await new Promise((resolve) => {
    server = createApp().listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await require('mongoose').connection.close();
  await mongo.stop();
});

let services;
const customer = { name: 'Mario Rossi', phone: '+39 333 1234567' };

test('API pubbliche: attività, servizi, disponibilità', async () => {
  const biz = await call('GET', '/api/business');
  assert.equal(biz.status, 200);
  assert.equal(biz.data.name, 'Barberia Demo');
  assert.equal(biz.data.id, undefined);

  const res = await call('GET', '/api/services');
  services = res.data;
  assert.equal(services.length, 3);

  const date = nextTuesday();
  const av = await call('GET', `/api/availability?serviceId=${services[0].id}&date=${date}`);
  assert.equal(av.status, 200);
  assert.equal(av.data.slots[0], '09:00');

  const days = await call('GET', `/api/availability/days?serviceId=${services[0].id}`);
  const monday = days.data.days.find((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === 1);
  assert.equal(monday.available, 0); // lunedì chiuso
});

test('richieste simultanee sullo stesso orario: ne passa solo una', async () => {
  const date = nextTuesday();
  const body = { serviceId: services[0].id, date, time: '10:00', customer };
  const results = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/api/bookings', body)));
  const ok = results.filter((r) => r.status === 201);
  const ko = results.filter((r) => r.status === 409);
  assert.equal(ok.length, 1);
  assert.equal(ko.length, 7);
});

test('un servizio più lungo non può sovrapporsi a una prenotazione esistente', async () => {
  const date = nextTuesday();
  const long = services.find((s) => s.durationMinutes === 45);
  // 09:30 + 45 min = 10:15 → si sovrappone alla prenotazione delle 10:00
  const res = await call('POST', '/api/bookings', { serviceId: long.id, date, time: '09:30', customer });
  assert.equal(res.status, 409);
  const av = await call('GET', `/api/availability?serviceId=${long.id}&date=${date}`);
  assert.ok(!av.data.slots.includes('09:30'));
  assert.ok(av.data.slots.includes('09:15')); // 09:15–10:00 è libero
});

test('non si può prenotare fuori orario o in un giorno chiuso', async () => {
  const date = nextTuesday();
  const closed = await call('POST', '/api/bookings', { serviceId: services[0].id, date, time: '13:30', customer });
  assert.equal(closed.status, 409);
  const bad = await call('POST', '/api/bookings', { serviceId: services[0].id, date, time: '11:00', customer: { name: 'X', phone: 'abc' } });
  assert.equal(bad.status, 400);
});

test('admin: login obbligatorio', async () => {
  const anon = await call('GET', '/admin/api/me');
  assert.equal(anon.status, 401);
  const wrong = await call('POST', '/admin/api/login', { username: 'admin', password: 'sbagliata' }, { auth: true });
  assert.equal(wrong.status, 401);
  const ok = await call('POST', '/admin/api/login', ADMIN, { auth: true });
  assert.equal(ok.status, 200);
  const me = await call('GET', '/admin/api/me', undefined, { auth: true });
  assert.equal(me.data.username, 'admin');
});

test('admin: richiede JSON per le modifiche (protezione CSRF)', async () => {
  const res = await fetch(`${base}/admin/api/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: 'name=x',
  });
  assert.equal(res.status, 415);
});

test('admin: prenotazione manuale, modifica, cancellazione', async () => {
  const date = nextTuesday();
  // Fuori orario è consentito all'admin…
  const outside = await call('POST', '/admin/api/bookings', { serviceId: services[0].id, date, time: '13:00', customer }, { auth: true });
  assert.equal(outside.status, 201);
  // …ma mai in sovrapposizione
  const overlap = await call('POST', '/admin/api/bookings', { serviceId: services[0].id, date, time: '10:15', customer }, { auth: true });
  assert.equal(overlap.status, 409);

  // Sposta la prenotazione: il vecchio orario si libera
  const moved = await call('PUT', `/admin/api/bookings/${outside.data.id}`, { time: '11:00' }, { auth: true });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.start, '11:00');
  const free = await call('POST', '/admin/api/bookings', { serviceId: services[0].id, date, time: '13:00', customer }, { auth: true });
  assert.equal(free.status, 201);

  // Spostamento parziale su sé stesso (11:00 → 11:15) consentito
  const shift = await call('PUT', `/admin/api/bookings/${outside.data.id}`, { time: '11:15' }, { auth: true });
  assert.equal(shift.status, 200);

  // Cancellazione: l'orario torna prenotabile online
  const del = await call('DELETE', `/admin/api/bookings/${outside.data.id}`, undefined, { auth: true });
  assert.equal(del.data.status, 'cancelled');
  const again = await call('POST', '/api/bookings', { serviceId: services[0].id, date, time: '11:15', customer });
  assert.equal(again.status, 201);

  const list = await call('GET', `/admin/api/bookings?from=${date}&to=${date}`, undefined, { auth: true });
  assert.equal(list.data.length, 3); // 10:00, 13:00, 11:15
});

test('admin: blocco di un giorno rende il giorno non prenotabile', async () => {
  const date = nextTuesday(1);
  const res = await call('POST', '/admin/api/blocks', { fromDate: date, allDay: true, reason: 'Ferie' }, { auth: true });
  assert.equal(res.status, 201);
  const av = await call('GET', `/api/availability?serviceId=${services[0].id}&date=${date}`);
  assert.deepEqual(av.data.slots, []);

  await call('DELETE', `/admin/api/blocks/${res.data.blocks[0].id}`, undefined, { auth: true });
  const av2 = await call('GET', `/api/availability?serviceId=${services[0].id}&date=${date}`);
  assert.ok(av2.data.slots.length > 0);
});

test('admin: servizi e orari', async () => {
  const created = await call('POST', '/admin/api/services', { name: 'Colore', durationMinutes: 90, price: 40 }, { auth: true });
  assert.equal(created.status, 201);
  const badDuration = await call('POST', '/admin/api/services', { name: 'X', durationMinutes: 7, price: 1 }, { auth: true });
  assert.equal(badDuration.status, 400);

  const settings = await call('GET', '/admin/api/settings', undefined, { auth: true });
  const hours = { ...settings.data.openingHours, 1: [{ start: '10:00', end: '12:00' }] };
  const saved = await call('PUT', '/admin/api/settings', { openingHours: hours }, { auth: true });
  assert.deepEqual(saved.data.openingHours[1], [{ start: '10:00', end: '12:00' }]);
  const overlapping = await call('PUT', '/admin/api/settings', { openingHours: { 1: [{ start: '10:00', end: '12:00' }, { start: '11:00', end: '13:00' }] } }, { auth: true });
  assert.equal(overlapping.status, 400);

  const logout = await call('POST', '/admin/api/logout', {}, { auth: true });
  assert.equal(logout.status, 200);
  assert.equal((await call('GET', '/admin/api/me', undefined, { auth: true })).status, 401);
});
