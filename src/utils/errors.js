/**
 * Errore HTTP con status e codice leggibile dal frontend.
 * Viene intercettato dal middleware errorHandler.
 */
class HttpError extends Error {
  constructor(status, message, code = 'ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, 'BAD_REQUEST', details);
const notFound = (msg = 'Risorsa non trovata') => new HttpError(404, msg, 'NOT_FOUND');
const conflict = (msg, code = 'CONFLICT') => new HttpError(409, msg, code);

module.exports = { HttpError, badRequest, notFound, conflict };
