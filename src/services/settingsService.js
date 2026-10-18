/**
 * Lettura/scrittura delle impostazioni di un negozio (orari e regole).
 * Se il documento manca viene creato con i default di config.json.
 */
const { Settings } = require('../models');
const config = require('../config');
const { toMinutes, fromMinutes, isValidTime } = require('../utils/time');
const { badRequest } = require('../utils/errors');

/** Converte gli orari di config.json ({"1": [{start:"09:00", end:"13:00"}]}) nel formato DB. */
function openingHoursFromConfig(hours = {}) {
  const result = [];
  for (let day = 0; day <= 6; day += 1) {
    const intervals = (hours[day] || hours[String(day)] || []).map((i) => ({
      start: toMinutes(i.start),
      end: toMinutes(i.end),
    }));
    result.push({ day, intervals });
  }
  return result;
}

async function getSettings(businessId, openingHours = config.defaults.openingHours) {
  let settings = await Settings.findOne({ businessId });
  if (!settings) {
    settings = await Settings.create({
      businessId,
      openingHours: openingHoursFromConfig(openingHours),
      slotStepMinutes: config.booking.slotStepMinutes,
      minNoticeMinutes: config.booking.minNoticeMinutes,
      maxDaysAhead: config.booking.maxDaysAhead,
    });
  }
  return settings;
}

/** Formato "leggibile" usato dalle API: { "1": [{start:"09:00", end:"13:00"}], … } */
function serializeOpeningHours(settings) {
  const out = {};
  for (let day = 0; day <= 6; day += 1) {
    out[day] = settings.intervalsFor(day).map((i) => ({
      start: fromMinutes(i.start),
      end: fromMinutes(i.end),
    }));
  }
  return out;
}

function serializeSettings(settings) {
  return {
    openingHours: serializeOpeningHours(settings),
    slotStepMinutes: settings.slotStepMinutes,
    minNoticeMinutes: settings.minNoticeMinutes,
    maxDaysAhead: settings.maxDaysAhead,
    cancelNoticeMinutes: settings.cancelNoticeMinutes,
    reminderHours: settings.reminderHours,
  };
}

/** Valida e normalizza gli orari inviati dall'admin. */
function parseOpeningHours(input) {
  if (!input || typeof input !== 'object') throw badRequest('Orari di apertura non validi');
  const result = [];
  for (let day = 0; day <= 6; day += 1) {
    const raw = input[day] || input[String(day)] || [];
    if (!Array.isArray(raw)) throw badRequest('Orari di apertura non validi');
    const intervals = raw.map((i) => {
      if (!isValidTime(i.start) || !isValidTime(i.end)) throw badRequest('Formato orario non valido (usa HH:MM)');
      const start = toMinutes(i.start);
      const end = toMinutes(i.end);
      if (end <= start) throw badRequest(`Intervallo ${i.start}–${i.end}: la fine deve essere dopo l'inizio`);
      return { start, end };
    });
    intervals.sort((a, b) => a.start - b.start);
    for (let k = 1; k < intervals.length; k += 1) {
      if (intervals[k].start < intervals[k - 1].end) throw badRequest('Ci sono intervalli sovrapposti nello stesso giorno');
    }
    result.push({ day, intervals });
  }
  return result;
}

async function updateSettings(businessId, body) {
  const settings = await getSettings(businessId);
  if (body.openingHours !== undefined) settings.openingHours = parseOpeningHours(body.openingHours);
  for (const key of ['slotStepMinutes', 'minNoticeMinutes', 'maxDaysAhead', 'cancelNoticeMinutes', 'reminderHours']) {
    if (body[key] !== undefined) {
      const n = Number(body[key]);
      if (!Number.isInteger(n)) throw badRequest(`Valore non valido per ${key}`);
      settings[key] = n;
    }
  }
  await settings.save();
  return settings;
}

module.exports = {
  getSettings, updateSettings, serializeSettings, serializeOpeningHours, openingHoursFromConfig, parseOpeningHours,
};
