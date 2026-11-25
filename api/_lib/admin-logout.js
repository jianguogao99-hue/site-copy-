import { clearSessionCookie, privateHeaders, sameOrigin } from '../_lib/visitor-store.js';

export default function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'POST') return res.status(405).end();
  if (!sameOrigin(req)) return res.status(403).end();
  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.status(204).end();
}
