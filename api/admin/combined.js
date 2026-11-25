import logout from '../_lib/admin-logout.js';
import session from '../_lib/admin-session.js';
import stats from '../_lib/admin-stats.js';

const handlers = { logout, session, stats };

export default function handler(req, res) {
  const route = req.query?.route;
  const selected = typeof route === 'string' && Object.hasOwn(handlers, route)
    ? handlers[route] : null;
  if (!selected) return res.status(404).end();
  return selected(req, res);
}
