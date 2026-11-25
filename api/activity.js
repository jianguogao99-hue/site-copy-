import { randomUUID } from 'node:crypto';
import { clientIp, configured, geo, privateHeaders, requestDomain, sameOrigin, trackedPage, validViewId } from './_lib/visitor-store.js';
import { writeVisitEvent } from './_lib/visit-db.js';
import { bufferVisitEvent } from './_lib/visit-buffer.js';

const LINK_ID = /^(?:exchange|market|contact|site|external):[a-z0-9_.:-]{1,55}$/i;

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

  const { kind, page, viewId } = req.body || {};
  if (!trackedPage(page) || !validViewId(viewId)) return res.status(400).end();
  if (kind !== 'click' && kind !== 'duration') return res.status(400).end();

  const event = { id: randomUUID(), kind, time: new Date().toISOString(), page, viewId, domain, ip, ...geo(req) };
  if (kind === 'click') {
    const link = req.body?.link;
    const label = req.body?.label;
    if (typeof link !== 'string' || link.length > 64 || !LINK_ID.test(link) ||
      typeof label !== 'string' || !label.trim() || label.length > 80 ||
      /[\u0000-\u001f\u007f<>?#]|:\/\/|www\./i.test(label)) return res.status(400).end();
    event.link = link;
    event.label = label.trim();
    if (link.startsWith('exchange:')) {
      const visibleSeconds = req.body?.visibleSeconds;
      if (visibleSeconds !== undefined) {
        if (!Number.isSafeInteger(visibleSeconds) || visibleSeconds < 0 || visibleSeconds > 86_400)
          return res.status(400).end();
        event.clickVisibleSeconds = visibleSeconds;
      }
      try {
        const target = new URL(String(req.body?.targetUrl || ''));
        if (target.protocol !== 'https:' || target.username || target.password ||
            target.href.length > 1024) return res.status(400).end();
        event.targetUrl = target.href;
      } catch { return res.status(400).end(); }
    }
  } else {
    const seconds = req.body?.seconds;
    if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 300) return res.status(400).end();
    event.seconds = seconds;
  }

  try {
    if (kind === 'click' && event.link.startsWith('exchange:')) {
      const previous = await req.auditDb.prepare(`SELECT id FROM visit_events
        WHERE ip=? AND ts>=? AND kind='click' AND link=? LIMIT 1`)
        .bind(ip, Date.now() - 1500, event.link).first();
      if (previous) return res.status(204).end();
    }
    await writeVisitEvent(req.auditDb, event);
    return res.status(204).end();
  } catch (error) {
    try {
      await bufferVisitEvent(req.visitBuffer, event);
      return res.status(204).end();
    } catch (bufferError) {
      console.error('Activity write and buffer failed:', error?.message, bufferError?.message);
      return res.status(503).end();
    }
  }
}
