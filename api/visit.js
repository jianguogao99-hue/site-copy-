import { randomUUID } from 'node:crypto';
import { clientIp, configured, geo, privateHeaders, requestDomain, sameOrigin, trackedPage, validViewId } from './_lib/visitor-store.js';
import { writeVisitEvent } from './_lib/visit-db.js';
import { bufferVisitEvent } from './_lib/visit-buffer.js';

export default async function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'POST') return res.status(405).end();
  if (!configured()) return res.status(503).end();
  if (!req.auditDb) return res.status(503).end();
  if (!sameOrigin(req)) return res.status(403).end();
  const ip = clientIp(req);
  if (!ip) return res.status(400).end();
  const domain = requestDomain(req);
  if (!domain) return res.status(400).end();
  const page = String(req.body?.page || '');
  if (!trackedPage(page)) return res.status(400).end();
  const submittedViewId = req.body?.viewId;
  if (submittedViewId != null && !validViewId(submittedViewId)) return res.status(400).end();
  const viewId = submittedViewId || randomUUID();
  const location = geo(req);
  const now = new Date();
  const event = { id: randomUUID(), kind: 'view', time: now.toISOString(), page, viewId, domain, ip, ...location };
  try {
    await writeVisitEvent(req.auditDb, event);
    return res.status(204).end();
  } catch (error) {
    try {
      await bufferVisitEvent(req.visitBuffer, event);
      return res.status(204).end();
    } catch (bufferError) {
      console.error('Visit write and buffer failed:', error?.message, bufferError?.message);
      return res.status(503).end();
    }
  }
}
