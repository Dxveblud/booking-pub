/**
 * Punto unico in cui si registrano le integrazioni esterne.
 */
const { registerNotificationListeners } = require('../notifications');
const { registerGoogleCalendarSync } = require('./googleCalendar');

function registerIntegrations() {
  registerNotificationListeners();
  registerGoogleCalendarSync();
}

module.exports = { registerIntegrations };
