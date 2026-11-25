import { authenticated, configured, privateHeaders } from '../_lib/visitor-store.js';

export default function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'GET') return res.status(405).end();
  if (!configured()) return res.status(503).end();
  return authenticated(req) ? res.status(204).end() : res.status(401).end();
}
