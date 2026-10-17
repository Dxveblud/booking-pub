const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSlots, earliestBookable } = require('../src/services/availability');

const morning = [{ start: 540, end: 720 }]; // 09:00–12:00

test('genera gli orari nel rispetto della durata', () => {
  const slots = computeSlots({ duration: 60, intervals: morning, busy: [], step: 30 });
  assert.deepEqual(slots, [540, 570, 600, 630, 660]); // l'ultimo finisce alle 12:00
});

test('esclude gli orari che si sovrappongono a prenotazioni o blocchi', () => {
  const busy = [{ start: 600, end: 630 }]; // 10:00–10:30 occupato
  const slots = computeSlots({ duration: 30, intervals: morning, busy, step: 30 });
  assert.deepEqual(slots, [540, 570, 630, 660, 690]);
  // con un servizio da 60 min anche 9:30 (finirebbe alle 10:30) non è disponibile
  const long = computeSlots({ duration: 60, intervals: morning, busy, step: 30 });
  assert.deepEqual(long, [540, 630, 660]);
});

test('rispetta il preavviso minimo', () => {
  const slots = computeSlots({ duration: 30, intervals: morning, busy: [], step: 30, earliestStart: 615 });
  assert.deepEqual(slots, [630, 660, 690]);
});

test('preavviso che scavalca la mezzanotte', () => {
  assert.deepEqual(earliestBookable({ date: '2026-10-17', minutes: 23 * 60 }, 120), { date: '2026-10-18', minutes: 60 });
  assert.deepEqual(earliestBookable({ date: '2026-10-17', minutes: 600 }, 2 * 1440), { date: '2026-10-19', minutes: 600 });
});

test('giorno chiuso = nessun orario', () => {
  assert.deepEqual(computeSlots({ duration: 30, intervals: [], busy: [], step: 15 }), []);
});
