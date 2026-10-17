/**
 * Utility per date e orari.
 *
 * Convenzione usata in tutta l'app per evitare problemi di fuso orario:
 * - una data è una stringa "YYYY-MM-DD" nel fuso orario dell'attività;
 * - un orario è un numero di minuti dalla mezzanotte (es. 9:30 → 570).
 * In questo modo il server può girare in UTC (come su Render) senza sorprese.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "09:30" → 570 */
function toMinutes(hhmm) {
  if (hhmm === '24:00') return 1440;
  const m = TIME_RE.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 570 → "09:30" */
function fromMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isValidTime(hhmm) {
  return typeof hhmm === 'string' && (TIME_RE.test(hhmm) || hhmm === '24:00');
}

/** Verifica che la stringa sia una data reale (no 2024-02-31). */
function isValidDate(str) {
  if (typeof str !== 'string' || !DATE_RE.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

/** Giorno della settimana: 0 = domenica … 6 = sabato. */
function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** Aggiunge n giorni a una data "YYYY-MM-DD". */
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Numero di giorni tra due date (b - a). */
function diffDays(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * Data e ora correnti nel fuso orario indicato.
 * @returns {{ date: string, minutes: number }}
 */
function nowInTimezone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** True se gli intervalli [aStart, aEnd) e [bStart, bEnd) si sovrappongono. */
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

module.exports = {
  toMinutes,
  fromMinutes,
  isValidTime,
  isValidDate,
  weekdayOf,
  addDays,
  diffDays,
  nowInTimezone,
  overlaps,
};
