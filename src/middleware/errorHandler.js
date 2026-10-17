/**
 * Gestione centralizzata degli errori: ogni errore diventa una risposta JSON
 * nel formato { error: { code, message, details? } }.
 */
const { HttpError } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  // Errori di validazione Mongoose → 400
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((e) => e.message).join('; ');
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });
  }
  // JSON malformato nel body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'JSON non valido' } });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Errore interno del server' } });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Risorsa non trovata' } });
}

module.exports = { errorHandler, notFoundHandler };
