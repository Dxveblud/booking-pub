/**
 * Collaboratori con agende separate: disponibilità, assegnazione automatica,
 * richieste simultanee, blocchi e orari propri, prenotazioni non assegnate,
 * migrazione dei lucchetti delle installazioni precedenti.
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

function nextWeekday(weekday, skipWeeks = 0) {
  const { nowInTimezone, addDays, weekdayOf } = require('../src/utils/time');
  let d = addDays(nowInTimezone('Europe/Rome').date, 2 + skipWeeks * 7);
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}

async function waitForMails(n, ms = 2000) {
  const end = Date.now() + ms;
  while (sent.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.CONFIG_PATH = path.join(__dirname, 'fixtures', 'config.json');
  process.env.MONGODB_URI = mongo.getUri('booking-staff');
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_USERNAME = SUPER.username;
  process.env.ADMIN_PASSWORD = SUPER.password;
  process.env.BOOKING_RATE_LIMIT = '1000';
  process.env.SESSION_SECRET = 'test-secret';
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
const SHOP = 'barberia-due';
let services; // [Taglio, Taglio + barba, Regolazione barba, Taglio bambino]
let marco;
let luca;
const TUE = nextWeekday(2);
const customer = (n) => ({ name: `Cliente ${n}`, phone: `+39 333 000 ${String(n).padStart(4, '0')}` });
const book = (body) => anon('POST', `/api/bookings?shop=${SHOP}`, body);
const slotsOf = async (serviceId, date, staffId) => (await anon('GET', `/api/availability?shop=${SHOP}&serviceId=${serviceId}&date=${date}${staffId ? `&staffId=${staffId}` : ''}`)).data.slots;

test('migrazione: i lucchetti delle installazioni precedenti passano all\'agenda unica', async () => {
  const { SlotLock } = require('../src/models');
  const { migrateLocks } = require('../src/services/slotLocks');
  const col = SlotLock.collection;
  // Ricrea la situazione di prima: vecchio indice e lucchetti senza staffKey
  await col.dropIndex('agenda_unique');
  await col.createIndex({ businessId: 1, date: 1, minute: 1 }, { unique: true });
  const mongoose = require('mongoose');
  await col.insertOne({ businessId: 'vecchio', date: '2026-01-01', minute: 600, bookingId: new mongoose.Types.ObjectId() });

  await migrateLocks();
  const names = (await col.indexes()).map((i) => i.name);
  assert.ok(names.includes('agenda_unique'));
  assert.ok(!names.includes('businessId_1_date_1_minute_1'));
  assert.equal((await col.findOne({ businessId: 'vecchio' })).staffKey, '');
  await col.deleteMany({ businessId: 'vecchio' });
});

test('preparazione: negozio con due collaboratori', async () => {
  await superAdmin('POST', '/admin/api/login', SUPER);
  const shop = (await superAdmin('POST', '/admin/api/platform/shops', { name: 'Barberia Due', slug: SHOP, type: 'barbiere' })).data;
  assert.equal((await owner('POST', '/admin/api/login', { username: shop.owner.username, password: shop.owner.password })).status, 200);
  await owner('PUT', '/admin/api/business', { notifyEmail: 'due@example.com' });
  services = (await anon('GET', `/api/services?shop=${SHOP}`)).data;

  // Senza collaboratori: elenco vuoto, il widget salta il passo
  assert.deepEqual((await anon('GET', `/api/staff?shop=${SHOP}&serviceId=${services[0].id}`)).data, []);

  marco = (await owner('POST', '/admin/api/staff', { name: 'Marco' })).data;
  luca = (await owner('POST', '/admin/api/staff', { name: 'Luca', serviceIds: [services[0].id, services[3].id] })).data;
  assert.equal(marco.name, 'Marco');
  assert.deepEqual(luca.serviceIds, [services[0].id, services[3].id]);
  assert.equal((await owner('POST', '/admin/api/staff', { name: '' })).status, 400);
  assert.equal((await owner('POST', '/admin/api/staff', { name: 'X', serviceIds: ['000000000000000000000000'] })).status, 400);

  const forTaglio = (await anon('GET', `/api/staff?shop=${SHOP}&serviceId=${services[0].id}`)).data;
  assert.deepEqual(forTaglio.map((s) => s.name), ['Marco', 'Luca']);
  const forBarba = (await anon('GET', `/api/staff?shop=${SHOP}&serviceId=${services[1].id}`)).data;
  assert.deepEqual(forBarba.map((s) => s.name), ['Marco']);
});

test('"chiunque" con richieste simultanee: passano tante prenotazioni quanti i collaboratori liberi', async () => {
  const requests = Array.from({ length: 6 }, (_, i) => book({ serviceId: services[0].id, date: TUE, time: '10:00', customer: customer(i + 1) }));
  const results = await Promise.all(requests);
  const ok = results.filter((r) => r.status === 201);
  assert.equal(ok.length, 2, 'una per Marco e una per Luca');
  assert.deepEqual(ok.map((r) => r.data.staffName).sort(), ['Luca', 'Marco']);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409));
  assert.ok(!(await slotsOf(services[0].id, TUE)).includes('10:00'), 'entrambi occupati');
});

test('stesso collaboratore con richieste simultanee: ne passa una sola', async () => {
  const requests = Array.from({ length: 5 }, (_, i) => book({ serviceId: services[0].id, date: TUE, time: '11:00', staffId: marco.id, customer: customer(i + 20) }));
  const results = await Promise.all(requests);
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  // Luca alle 11 è ancora libero
  assert.ok((await slotsOf(services[0].id, TUE)).includes('11:00'));
  assert.ok(!(await slotsOf(services[0].id, TUE, marco.id)).includes('11:00'));
  assert.ok((await slotsOf(services[0].id, TUE, luca.id)).includes('11:00'));
});

test('servizi che non sa fare, ferie del singolo e orari propri', async () => {
  // Luca non fa "Taglio + barba": chiederlo a lui non dà orari
  assert.deepEqual(await slotsOf(services[1].id, TUE, luca.id), []);
  const barba = await book({ serviceId: services[1].id, date: TUE, time: '15:00', staffId: luca.id, customer: customer(40) });
  assert.equal(barba.status, 409);

  // Ferie di Marco il martedì dopo: restano gli orari di Luca
  const tue2 = nextWeekday(2, 1);
  const block = await owner('POST', '/admin/api/blocks', { fromDate: tue2, allDay: true, reason: 'Ferie Marco', staffId: marco.id });
  assert.equal(block.status, 201);
  assert.equal(block.data.blocks[0].staffId, marco.id);
  assert.deepEqual(await slotsOf(services[0].id, tue2, marco.id), []);
  assert.ok((await slotsOf(services[0].id, tue2)).length > 0);
  assert.deepEqual(await slotsOf(services[1].id, tue2), [], '"Taglio + barba" lo fa solo Marco');

  // Luca il mercoledì lavora solo la mattina
  const hours = { 0: [], 1: [], 2: [{ start: '09:00', end: '12:30' }, { start: '14:30', end: '19:30' }], 3: [{ start: '09:00', end: '12:00' }], 4: [], 5: [], 6: [] };
  assert.equal((await owner('PUT', `/admin/api/staff/${luca.id}`, { customHours: true, openingHours: hours })).status, 200);
  const wed = nextWeekday(3);
  const lucaWed = await slotsOf(services[0].id, wed, luca.id);
  assert.ok(lucaWed.includes('09:00'));
  assert.ok(!lucaWed.some((t) => t >= '12:00'));
  assert.deepEqual(await slotsOf(services[0].id, nextWeekday(4), luca.id), [], 'il giovedì non lavora');
  assert.ok((await slotsOf(services[0].id, wed)).includes('15:00'), 'Marco sì');
});

test('"chiunque" sceglie il collega con meno appuntamenti quel giorno', async () => {
  // Il martedì lavorano entrambi; Marco ha già più appuntamenti di Luca
  await book({ serviceId: services[0].id, date: TUE, time: '09:00', staffId: marco.id, customer: customer(50) });
  await book({ serviceId: services[0].id, date: TUE, time: '09:30', staffId: marco.id, customer: customer(51) });
  const any = await book({ serviceId: services[0].id, date: TUE, time: '12:00', customer: customer(52) });
  assert.equal(any.status, 201);
  assert.equal(any.data.staffName, 'Luca');
});

test('pannello: collaboratore obbligatorio, sovrapposizioni solo nella stessa agenda', async () => {
  const thu = nextWeekday(4);
  const base = { serviceId: services[0].id, date: thu, time: '16:00', customer: customer(60) };
  assert.equal((await owner('POST', '/admin/api/bookings', base)).status, 400);
  const a = await owner('POST', '/admin/api/bookings', { ...base, staffId: marco.id });
  assert.equal(a.status, 201);
  assert.equal(a.data.staffName, 'Marco');
  assert.equal((await owner('POST', '/admin/api/bookings', { ...base, staffId: marco.id, customer: customer(61) })).status, 409);
  // Luca il giovedì non lavora, ma dal pannello si può comunque fissare (come fuori orario)
  assert.equal((await owner('POST', '/admin/api/bookings', { ...base, staffId: luca.id, customer: customer(62) })).status, 201);

  // Spostare l'appuntamento da Marco a Luca: Luca a quell'ora è occupato
  assert.equal((await owner('PUT', `/admin/api/bookings/${a.data.id}`, { staffId: luca.id })).status, 409);
  const moved = await owner('PUT', `/admin/api/bookings/${a.data.id}`, { staffId: luca.id, time: '17:00' });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.staffName, 'Luca');
  // Marco alle 16 è di nuovo libero
  assert.equal((await owner('POST', '/admin/api/bookings', { ...base, staffId: marco.id, customer: customer(63) })).status, 201);
});

test('email: il collaboratore compare nell\'avviso al titolare', async () => {
  const before = sent.length;
  const r = await book({ serviceId: services[0].id, date: TUE, time: '15:00', staffId: luca.id, customer: customer(70) });
  assert.equal(r.status, 201);
  await waitForMails(before + 1);
  const mail = sent.slice(before).find((m) => m.to === 'due@example.com');
  assert.ok(mail);
  assert.match(mail.text, /Con: Luca/);
});

test('rinomina, eliminazione e disattivazione', async () => {
  const renamed = await owner('PUT', `/admin/api/staff/${luca.id}`, { name: 'Luca B.' });
  assert.equal(renamed.data.name, 'Luca B.');
  const list = (await owner('GET', `/admin/api/bookings?from=${TUE}&to=${TUE}`)).data;
  assert.ok(list.filter((b) => b.staffId === luca.id).every((b) => b.staffName === 'Luca B.'));

  assert.equal((await owner('DELETE', `/admin/api/staff/${luca.id}`)).status, 409, 'ha appuntamenti futuri');
  const temp = (await owner('POST', '/admin/api/staff', { name: 'Prova' })).data;
  assert.equal((await owner('DELETE', `/admin/api/staff/${temp.id}`)).status, 200);

  // Disattivato: non compare più nel widget
  await owner('PUT', `/admin/api/staff/${luca.id}`, { active: false });
  const names = (await anon('GET', `/api/staff?shop=${SHOP}&serviceId=${services[0].id}`)).data.map((s) => s.name);
  assert.deepEqual(names, ['Marco']);
  await owner('PUT', `/admin/api/staff/${luca.id}`, { active: true });
});

test('prenotazioni fatte prima dei collaboratori: occupano tutti finché non si assegnano', async () => {
  const shop = (await superAdmin('POST', '/admin/api/platform/shops', { name: 'Barberia Tre', slug: 'barberia-tre', type: 'barbiere' })).data;
  const own3 = client();
  await own3('POST', '/admin/api/login', { username: shop.owner.username, password: shop.owner.password });
  const svc = (await anon('GET', '/api/services?shop=barberia-tre')).data[0];
  const old = await anon('POST', '/api/bookings?shop=barberia-tre', { serviceId: svc.id, date: TUE, time: '16:00', customer: customer(80) });
  assert.equal(old.status, 201);
  assert.equal(old.data.staffName, '');

  const anna = (await own3('POST', '/admin/api/staff', { name: 'Anna' })).data;
  const sara = (await own3('POST', '/admin/api/staff', { name: 'Sara' })).data;
  const slots = async () => (await anon('GET', `/api/availability?shop=barberia-tre&serviceId=${svc.id}&date=${TUE}`)).data.slots;
  assert.ok(!(await slots()).includes('16:00'), 'la prenotazione non assegnata occupa tutti');
  assert.equal((await own3('POST', '/admin/api/bookings', { serviceId: svc.id, date: TUE, time: '16:00', staffId: anna.id, customer: customer(81) })).status, 409);

  const [legacy] = (await own3('GET', `/admin/api/bookings?from=${TUE}&to=${TUE}`)).data;
  assert.equal(legacy.staffId, null);
  assert.equal((await own3('PUT', `/admin/api/bookings/${legacy.id}`, { staffId: anna.id })).status, 200);
  assert.ok((await slots()).includes('16:00'), 'ora Sara alle 16 è libera');
  const r = await anon('POST', '/api/bookings?shop=barberia-tre', { serviceId: svc.id, date: TUE, time: '16:00', customer: customer(82) });
  assert.equal(r.status, 201);
  assert.equal(r.data.staffName, 'Sara');
  assert.ok(sara);
});
