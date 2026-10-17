/**
 * Le richieste POST/PUT/PATCH devono avere Content-Type JSON.
 * Insieme al cookie di sessione SameSite=strict protegge da attacchi CSRF:
 * un form HTML di un altro sito non può inviare application/json.
 * (DELETE non è inviabile da un form HTML, quindi è già protetto.)
 */
function requireJson(req, res, next) {
  // Unica eccezione: il caricamento delle immagini (corpo binario)
  if (req.path === '/uploads' && req.is('image/*')) return next();
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Usa Content-Type: application/json' } });
  }
  return next();
}

module.exports = requireJson;
