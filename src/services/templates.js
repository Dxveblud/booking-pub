/**
 * Modelli di partenza per i nuovi negozi: servizi e orari tipici per tipo
 * di attività. Dopo la creazione il titolare li modifica dal suo pannello.
 */
const WEEKDAYS_SPLIT = (morning, afternoon) => ({
  0: [], 1: [],
  2: [morning, afternoon], 3: [morning, afternoon], 4: [morning, afternoon], 5: [morning, afternoon],
  6: [{ start: '09:00', end: '18:00' }],
});

const TEMPLATES = {
  barbiere: {
    label: 'Barbiere',
    openingHours: WEEKDAYS_SPLIT({ start: '09:00', end: '12:30' }, { start: '14:30', end: '19:30' }),
    services: [
      { name: 'Taglio', durationMinutes: 30, price: 20, description: 'Shampoo, taglio e styling' },
      { name: 'Taglio + barba', durationMinutes: 45, price: 30, description: 'Il servizio completo' },
      { name: 'Regolazione barba', durationMinutes: 20, price: 12, description: 'Forma e contorni' },
      { name: 'Taglio bambino', durationMinutes: 20, price: 14, description: 'Fino a 12 anni' },
    ],
  },
  parrucchiere: {
    label: 'Parrucchiere',
    openingHours: WEEKDAYS_SPLIT({ start: '09:00', end: '13:00' }, { start: '14:00', end: '19:00' }),
    services: [
      { name: 'Piega', durationMinutes: 45, price: 25, description: 'Shampoo e piega' },
      { name: 'Taglio donna', durationMinutes: 60, price: 40, description: 'Shampoo, taglio e piega' },
      { name: 'Colore', durationMinutes: 90, price: 55, description: 'Colore completo e piega' },
      { name: 'Taglio uomo', durationMinutes: 30, price: 20, description: '' },
    ],
  },
  estetista: {
    label: 'Estetista',
    openingHours: WEEKDAYS_SPLIT({ start: '09:00', end: '13:00' }, { start: '14:00', end: '19:00' }),
    services: [
      { name: 'Manicure', durationMinutes: 45, price: 25, description: '' },
      { name: 'Semipermanente mani', durationMinutes: 60, price: 30, description: '' },
      { name: 'Pulizia viso', durationMinutes: 60, price: 45, description: '' },
      { name: 'Ceretta gambe', durationMinutes: 30, price: 20, description: '' },
    ],
  },
  generico: {
    label: 'Altro',
    openingHours: WEEKDAYS_SPLIT({ start: '09:00', end: '13:00' }, { start: '15:00', end: '19:00' }),
    services: [
      { name: 'Appuntamento', durationMinutes: 30, price: 0, description: '' },
    ],
  },
};

function getTemplate(type) {
  return TEMPLATES[type] || TEMPLATES.generico;
}

function listTemplates() {
  return Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label }));
}

module.exports = { getTemplate, listTemplates };
