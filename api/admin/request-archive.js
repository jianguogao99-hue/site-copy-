import { authenticated, configured, domainFromHost, privateHeaders } from '../_lib/visitor-store.js';

export default async function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'GET') return res.status(405).end();
  if (!configured()) return res.status(503).json({ error: '后台尚未完成配置' });
  if (!authenticated(req)) return res.status(401).json({ error: '请先登录' });
  if (!req.auditDb) return res.status(503).json({ error: '请求日志数据库尚未连接' });
  const requestedDomain = String(req.query.domain || 'all');
  const domain = requestedDomain === 'all' ? 'all' : domainFromHost(requestedDomain);
  const offset = Number(req.query.offset || 0);
  if (!domain || !Number.isSafeInteger(offset) || offset < 0) return res.status(400).json({ error: '查询参数无效' });
  const condition = domain === 'all' ? '' : ' WHERE domain=?';
  const args = domain === 'all' ? [] : [domain];
  try {
    const db = req.auditDb;
    // Legacy chunks are the immutable RDB archive. They are deliberately separate
    // from the live request_events rollup, so both sources remain auditable.
    const legacy = domain === 'all' ? 'SELECT day,0 live_total,0 scan,SUM(count) legacy_total FROM request_legacy_chunks GROUP BY day' :
      'SELECT day,0 live_total,0 scan,0 legacy_total FROM request_daily WHERE 0';
    const merged = `SELECT day,SUM(live_total) live_total,SUM(scan) scan,SUM(legacy_total) legacy_total FROM (
      SELECT day,SUM(total) live_total,SUM(scan) scan,0 legacy_total FROM request_daily${condition} GROUP BY day
      UNION ALL ${legacy}
    ) GROUP BY day`;
    const total = await db.prepare(`SELECT COUNT(*) AS count FROM (${merged})`).bind(...args).first();
    const rows = await db.prepare(`SELECT * FROM (${merged}) ORDER BY day DESC LIMIT 30 OFFSET ?`)
      .bind(...args, offset).all();
    const daily = await Promise.all((rows.results || []).map(async row => {
      const source = await db.prepare(`SELECT source,SUM(count) count FROM request_sources WHERE day=?${domain === 'all' ? '' : ' AND domain=?'} GROUP BY source ORDER BY count DESC LIMIT 3`)
        .bind(row.day, ...args).all();
      const live = Number(row.live_total) || 0;
      const legacy = Number(row.legacy_total) || 0;
      return { date: row.day, total: live + legacy, live, legacy, scan: Number(row.scan) || 0,
        topSources: (source.results || []).map(item => ({ source: item.source, count: Number(item.count) || 0 })) };
    }));
    return res.status(200).json({ domain, totalDays: Number(total?.count) || 0, offset,
      legacyScope: '仅全部域名显示旧库历史，域名筛选只看新日志', daily });
  } catch (error) {
    console.error('Request archive failed:', error?.message);
    return res.status(503).json({ error: '长期汇总暂时无法读取' });
  }
}
