/**
 * Protegge le route admin: richiede una sessione autenticata.
 * - API (JSON): risponde 401
 * - pagine HTML: reindirizza al login
 */
function requireAdmin(req, res, next) {
  if (req.session && (req.session.adminId || req.session.demo)) return next();
  if (req.accepts(['html', 'json']) === 'html' && req.method === 'GET') {
    return res.redirect('/admin/login');
  }
  return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Accesso richiesto' } });
}

module.exports = requireAdmin;
