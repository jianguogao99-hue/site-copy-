import { authenticated, configured, domainFromHost, privateHeaders } from '../_lib/visitor-store.js';
import { requestDaysFromQuery } from '../_lib/request-audit.js';

export default async function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'GET') return res.status(405).end();
  if (!configured()) return res.status(503).json({ error: '后台尚未完成配置' });
  if (!authenticated(req)) return res.status(401).json({ error: '请先登录' });
  if (!req.auditDb) return res.status(503).json({ error: '请求日志数据库尚未连接' });
  const requestedDomain = String(req.query.domain || 'all');
  const domain = requestedDomain === 'all' ? 'all' : domainFromHost(requestedDomain);
  const days = requestDaysFromQuery(req.query);
  const filter = String(req.query.filter || 'all');
  const status = String(req.query.status || 'all');
  const offset = Number(req.query.offset || 0);
  const limit = Number(req.query.limit || 25);
  if (!domain || !days || !['all', 'suspicious'].includes(filter) ||
      !['all','404','200','5xx'].includes(status) || ![25,50,100].includes(limit) ||
      !Number.isSafeInteger(offset) || offset < 0) {
    return res.status(400).json({ error: '查询参数无效' });
  }
  const where = `day BETWEEN ? AND ?${domain === 'all' ? '' : ' AND domain=?'}${filter === 'suspicious' ? ' AND suspicious=1' : ''}${status === 'all' ? '' : status === '5xx' ? ' AND status BETWEEN 500 AND 599' : ' AND status=?'}`;
  const args = [days.at(-1), days[0], ...(domain === 'all' ? [] : [domain])];
  if (status !== 'all' && status !== '5xx') args.push(Number(status));
  try {
    const db = req.auditDb;
    const count = await db.prepare(`SELECT COUNT(*) AS total FROM request_events WHERE ${where}`).bind(...args).first();
    const rows = await db.prepare(`SELECT ts,domain,ip,method,path,status,type,suspicious,user_agent,referer,country,region,asn,as_organization FROM request_events WHERE ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`)
      .bind(...args, limit, offset).all();
    const events = (rows.results || []).map(item => ({
      time: new Date(item.ts).toISOString(), domain: item.domain, ip: item.ip,
      method: item.method, path: item.path, status: item.status, type: item.type,
      suspicious: Boolean(item.suspicious), userAgent: item.user_agent, referer: item.referer,
      country: item.country, region: item.region, asn: item.asn, asOrganization: item.as_organization,
    }));
    return res.status(200).json({
      rangeDays: days.length, domain, filter, status, from: days.at(-1), to: days[0],
      total: Number(count?.total) || 0, offset, limit, events, refreshedAt:new Date().toISOString(),
    });
  } catch (error) {
    console.error('Request audit read failed:', error?.message);
    return res.status(503).json({ error: '请求记录暂时无法读取' });
  }
}
