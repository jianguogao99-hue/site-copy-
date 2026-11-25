import { RAW_DAYS, requestType, suspiciousPath } from './request-audit.js';

const EVENT_SQL = `INSERT OR IGNORE INTO request_events (id,ts,day,hour,minute,domain,ip,method,path,status,type,suspicious,user_agent,referer,referer_source,country,region,asn,as_organization) VALUES (${Array(19).fill('?').join(',')})`;

export function normalizeRequestEvent(item) {
  const type = item.type || requestType(item.path || '');
  return { ...item, type, suspicious: Boolean(item.suspicious ?? suspiciousPath(item.path || '')) };
}

export async function recordAuditEvent(db, raw) {
  const item = normalizeRequestEvent(raw);
  const ts = Date.parse(item.time);
  if (!Number.isFinite(ts)) throw new Error('Invalid request timestamp');
  const day = item.time.slice(0, 10);
  const hour = item.time.slice(11, 13);
  const minute = item.time.slice(0, 16);
  await db.prepare(EVENT_SQL).bind(item.id, ts, day, hour, minute, item.domain, item.ip,
      item.method || 'GET', item.path || '/', Number(item.status) || 0, item.type,
      Number(item.suspicious), item.userAgent || '', item.referer || '', item.refererSource || '直接访问 / 未提供',
      item.country || '', item.region || '', item.asn || null, item.asOrganization || '').run();
}

export async function cleanExpiredRequestEvents(db, now = Date.now()) {
  const normalCutoff = now - 14 * 86400000;
  const suspiciousCutoff = now - RAW_DAYS * 86400000;
  let eventsDeleted = 0;
  // Bound deletion so a single large day cannot consume the free write budget.
  // The next scheduled run resumes from the oldest eligible rows.
  let batches = 2;
  while (batches-- > 0) {
    const result = await db.prepare(`DELETE FROM request_events WHERE id IN (
      SELECT id FROM request_events WHERE (suspicious=0 AND ts < ?) OR (suspicious=1 AND ts < ?)
      ORDER BY ts LIMIT 1000)`)
      .bind(normalCutoff, suspiciousCutoff).run();
    const changed = result.meta?.changes || 0;
    eventsDeleted += changed;
    if (changed < 1000) break;
  }
  let minutesDeleted = 0;
  const minuteCutoff = new Date(normalCutoff).toISOString().slice(0, 16);
  let minuteBatches = 2;
  while (minuteBatches-- > 0) {
    const result = await db.prepare('DELETE FROM request_minute WHERE (ip,minute) IN (SELECT ip,minute FROM request_minute WHERE minute < ? LIMIT 1000)')
      .bind(minuteCutoff).run();
    const changed = result.meta?.changes || 0;
    minutesDeleted += changed;
    if (changed < 1000) break;
  }
  return { eventsDeleted, minutesDeleted, moreMayRemain: batches < 0 || minuteBatches < 0 };
}
