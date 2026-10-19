/**
 * Test multi-negozio: ogni negozio vede e modifica solo i propri dati.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;
let server;
let base;
const SUPER = { username: 'admin', password: 'password-di-test' };

/** Piccolo client HTTP che tiene il cookie di sessione. */
function client() {
  let cookie = '';
  return async function call(method, url, body, headers = {}) {
    const h = { Accept: 'application/json', ...headers };
    if (body !== undefined && !Buffer.isBuffer(body)) h['Content-Type'] = 'application/json';
    if (cookie) h.Cookie = cookie;
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
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

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.CONFIG_PATH = path.join(__dirname, 'fixtures', 'config-demo.json');
  process.env.MONGODB_URI = mongo.getUri('booking-shops');
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_USERNAME = SUPER.username;
  process.env.ADMIN_PASSWORD = SUPER.password;
  process.env.BOOKING_RATE_LIMIT = '1000';
  process.env.SESSION_SECRET = 'test-secret';
  process.env.UPLOAD_DIR = path.join(require('os').tmpdir(), `bt-uploads-${process.pid}`);
  const { connectDb } = require('../src/db');
  const { bootstrap } = require('../src/services/bootstrap');
  const { createApp } = require('../src/app');
  await connectDb();
  await bootstrap();
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
let mario;

test('il super admin crea un negozio da un modello', async () => {
  assert.equal((await superAdmin('POST', '/admin/api/login', SUPER)).status, 200);
  const me = await superAdmin('GET', '/admin/api/me');
  assert.equal(me.data.role, 'super');

  const res = await superAdmin('POST', '/admin/api/platform/shops', { name: 'Barberia Mario', type: 'barbiere' });
  assert.equal(res.status, 201);
  assert.equal(res.data.business.slug, 'barberia-mario');
  assert.ok(res.data.owner.password.length >= 8);
  mario = res.data;

  const dup = await superAdmin('POST', '/admin/api/platform/shops', { name: 'Barberia Mario' });
  assert.equal(dup.status, 409);
  const reserved = await superAdmin('POST', '/admin/api/platform/shops', { name: 'x', slug: 'admin' });
  assert.equal(reserved.status, 400);

  const list = await superAdmin('GET', '/admin/api/platform/shops');
  assert.deepEqual(list.data.map((s) => s.slug).sort(), ['barberia-mario', 'demo']);
});

test('le API pubbliche rispondono per il negozio indicato', async () => {
  const demo = await anon('GET', '/api/business');
  assert.equal(demo.data.slug, 'demo');
  const biz = await anon('GET', '/api/business?shop=barberia-mario');
  assert.equal(biz.data.name, 'Barberia Mario');
  const services = await anon('GET', '/api/services?shop=barberia-mario');
  assert.equal(services.data.length, 4);
  assert.equal((await anon('GET', '/api/services?shop=non-esiste')).status, 404);
});

test('lo stesso orario si può prenotare in negozi diversi, ma non due volte nello stesso', async () => {
  const date = nextTuesday();
  const sDemo = (await anon('GET', '/api/services')).data[0];
  const sMario = (await anon('GET', '/api/services?shop=barberia-mario')).data[0];
  const customer = { name: 'Luca Neri', phone: '+39 333 000 0000' };
  const a = await anon('POST', '/api/bookings', { serviceId: sDemo.id, date, time: '10:00', customer });
  const b = await anon('POST', '/api/bookings?shop=barberia-mario', { serviceId: sMario.id, date, time: '10:00', customer });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const again = await anon('POST', '/api/bookings?shop=barberia-mario', { serviceId: sMario.id, date, time: '10:00', customer });
  assert.equal(again.status, 409);
  // Un servizio di un altro negozio non è valido
  const cross = await anon('POST', '/api/bookings?shop=barberia-mario', { serviceId: sDemo.id, date, time: '15:00', customer });
  assert.equal(cross.status, 400);
});

test('il titolare vede e modifica solo il suo negozio', async () => {
  const login = await owner('POST', '/admin/api/login', { username: mario.owner.username, password: mario.owner.password });
  assert.equal(login.status, 200);
  const me = await owner('GET', '/admin/api/me');
  assert.equal(me.data.role, 'owner');
  assert.equal(me.data.business.slug, 'barberia-mario');

  const date = nextTuesday();
  const mine = await owner('GET', `/admin/api/bookings?from=${date}&to=${date}`);
  assert.equal(mine.data.length, 1);

  // Le prenotazioni della demo non si vedono e non si toccano
  const demoBookings = await superAdmin('GET', `/admin/api/bookings?from=${date}&to=${date}`);
  const demoId = demoBookings.data[0].id;
  assert.equal((await owner('DELETE', `/admin/api/bookings/${demoId}`)).status, 404);
  assert.equal((await owner('GET', '/admin/api/platform/shops')).status, 403);
  assert.equal((await owner('POST', '/admin/api/platform/shops/demo/enter', {})).status, 403);

  const upd = await owner('PUT', '/admin/api/business', { name: 'Barberia da Mario', accentColor: '#c0392b' });
  assert.equal(upd.data.name, 'Barberia da Mario');
  assert.equal((await owner('PUT', '/admin/api/business', { accentColor: 'rosso' })).status, 400);
  assert.equal((await anon('GET', '/api/business?shop=barberia-mario')).data.name, 'Barberia da Mario');
});

test('caricamento immagini: solo formati sicuri', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
  const ok = await owner('POST', '/admin/api/uploads', png, { 'Content-Type': 'image/png' });
  assert.equal(ok.status, 201);
  assert.match(ok.data.url, /^\/uploads\/barberia-mario\/[a-f0-9]+\.png$/);
  const svg = await owner('POST', '/admin/api/uploads', Buffer.from('<svg onload="alert(1)"/>'), { 'Content-Type': 'image/svg+xml' });
  assert.equal(svg.status, 400);
  const fake = await owner('POST', '/admin/api/uploads', Buffer.from('non sono un png'), { 'Content-Type': 'image/png' });
  assert.equal(fake.status, 400);
});

test('il super admin entra nei negozi e li può disattivare', async () => {
  const enter = await superAdmin('POST', '/admin/api/platform/shops/barberia-mario/enter', {});
  assert.equal(enter.status, 200);
  assert.equal((await superAdmin('GET', '/admin/api/me')).data.business.slug, 'barberia-mario');

  const reset = await superAdmin('POST', '/admin/api/platform/shops/barberia-mario/reset-password', {});
  assert.equal(reset.data.username, mario.owner.username);
  assert.notEqual(reset.data.password, mario.owner.password);

  await superAdmin('PUT', '/admin/api/platform/shops/barberia-mario', { active: false });
  assert.equal((await anon('GET', '/api/business?shop=barberia-mario')).status, 404);
  await superAdmin('PUT', '/admin/api/platform/shops/barberia-mario', { active: true });
  assert.equal((await anon('GET', '/api/business?shop=barberia-mario')).status, 200);
});

test('pannello demo: si entra senza password, solo prenotazioni e ferie modificabili', async () => {
  // /admin/demo apre la sessione e reindirizza al pannello
  const res = await fetch(`${base}/admin/demo`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = (method, url, body) => fetch(base + url, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

  const me = await call('GET', '/admin/api/me');
  assert.equal(me.data.role, 'demo');
  assert.equal(me.data.business.slug, 'demo');

  const date = nextTuesday();
  const service = (await anon('GET', '/api/services')).data[0];
  const created = await call('POST', '/admin/api/bookings', { serviceId: service.id, date, time: '16:00', customer: { name: 'Prova Demo', phone: '3330000000' } });
  assert.equal(created.status, 201);
  assert.equal((await call('DELETE', `/admin/api/bookings/${created.data.id}`)).status, 200);

  assert.equal((await call('PUT', '/admin/api/business', { name: 'Hackerato' })).status, 403);
  assert.equal((await call('POST', '/admin/api/services', { name: 'x', durationMinutes: 30, price: 1 })).status, 403);
  assert.equal((await call('PUT', '/admin/api/settings', { slotStepMinutes: 5 })).status, 403);
  assert.equal((await call('PUT', '/admin/api/password', { current: 'x', password: 'yyyyyyyy' })).status, 403);
  assert.equal((await call('GET', '/admin/api/platform/shops')).status, 403);
  assert.equal((await anon('GET', '/api/business')).data.name, 'Barberia Demo');
});
