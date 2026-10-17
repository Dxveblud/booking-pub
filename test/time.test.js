const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/utils/time');

test('conversione minuti <-> HH:MM', () => {
  assert.equal(t.toMinutes('09:30'), 570);
  assert.equal(t.toMinutes('24:00'), 1440);
  assert.ok(Number.isNaN(t.toMinutes('9:30')));
  assert.equal(t.fromMinutes(570), '09:30');
  assert.equal(t.fromMinutes(0), '00:00');
});

test('validazione date', () => {
  assert.ok(t.isValidDate('2026-02-28'));
  assert.ok(!t.isValidDate('2026-02-30'));
  assert.ok(!t.isValidDate('2026-2-3'));
  assert.ok(!t.isValidDate(undefined));
});

test('giorni della settimana e somma di giorni', () => {
  assert.equal(t.weekdayOf('2026-10-19'), 1); // lunedì
  assert.equal(t.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(t.diffDays('2026-10-01', '2026-10-31'), 30);
});

test('ora corrente nel fuso dell\'attività', () => {
  // 2026-07-01 22:30 UTC = 2026-07-02 00:30 a Roma (ora legale)
  const now = t.nowInTimezone('Europe/Rome', new Date('2026-07-01T22:30:00Z'));
  assert.deepEqual(now, { date: '2026-07-02', minutes: 30 });
});

test('sovrapposizione intervalli', () => {
  assert.ok(t.overlaps(540, 570, 560, 600));
  assert.ok(!t.overlaps(540, 570, 570, 600)); // adiacenti non si sovrappongono
});
