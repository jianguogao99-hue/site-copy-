import { authenticated, configured, domainFromHost, privateHeaders } from '../_lib/visitor-store.js';
import { requestDaysFromQuery } from '../_lib/request-audit.js';

const number = value => Number(value) || 0;

export default async function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'GET') return res.status(405).end();
  if (!configured()) return res.status(503).json({ error: '后台尚未完成配置' });
  if (!authenticated(req)) return res.status(401).json({ error: '请先登录' });
  if (!req.auditDb) return res.status(503).json({ error: '请求日志数据库尚未连接' });
  const requestedDomain = String(req.query.domain || 'all');
  const domain = requestedDomain === 'all' ? 'all' : domainFromHost(requestedDomain);
  const days = requestDaysFromQuery(req.query);
  if (!domain || !days) return res.status(400).json({ error: '查询日期或域名无效' });
  const [from, to] = [days.at(-1), days[0]];
  const inDomain = domain === 'all' ? '' : ' AND domain=?';
  const args = [from, to, ...(domain === 'all' ? [] : [domain])];
  const db = req.auditDb;
  const all = (sql, values = args) => db.prepare(sql).bind(...values).all().then(result => result.results || []);
  const eventWhere = `day BETWEEN ? AND ?${inDomain}`;
  const top = (field, extra = '') => all(`SELECT ${field} AS value,COUNT(*) AS count FROM request_events WHERE ${eventWhere}${extra} GROUP BY ${field} ORDER BY count DESC,value LIMIT 20`);
  try {
    const [dayRows, hourRows, topPaths, topIps, topAsns, topCountries, topUserAgents,
      topSources, suspiciousPaths, suspiciousIps, bursts] = await Promise.all([
      all(`SELECT day,SUM(total) total,SUM(scan) scan,SUM(status_200) status_200,SUM(status_fallback) status_fallback,SUM(status_404) status_404,SUM(status_403) status_403,SUM(status_5xx) status_5xx,SUM(status_other) status_other,SUM(type_page) type_page,SUM(type_static) type_static,SUM(type_api) type_api,SUM(type_fallback) type_fallback FROM request_daily WHERE day BETWEEN ? AND ?${inDomain} GROUP BY day ORDER BY day`),
      all(`SELECT day,hour,SUM(count) count FROM request_hourly WHERE day BETWEEN ? AND ?${inDomain} GROUP BY day,hour`),
      top('path'),
      all(`SELECT ip,COUNT(*) count,MIN(ts) first_seen,MAX(ts) last_seen,COUNT(DISTINCT path) path_count FROM request_events WHERE ${eventWhere} GROUP BY ip ORDER BY count DESC,ip LIMIT 20`),
      top("COALESCE(CAST(asn AS TEXT),'未知')"),
      top("COALESCE(NULLIF(country,''),'未知')"),
      top("COALESCE(NULLIF(user_agent,''),'未提供')"),
      all(`SELECT source AS value,SUM(count) AS count FROM request_sources WHERE day BETWEEN ? AND ?${inDomain} GROUP BY source ORDER BY count DESC,value LIMIT 20`),
      top('path', ' AND suspicious=1'),
      top('ip', ' AND suspicious=1'),
      domain === 'all'
        ? all('SELECT ip,minute,count FROM request_minute WHERE minute BETWEEN ? AND ? AND count>30 ORDER BY minute DESC LIMIT 50', [`${from}T00:00`, `${to}T23:59`])
        : all(`SELECT ip,minute,COUNT(*) count FROM request_events WHERE ${eventWhere} GROUP BY ip,minute HAVING count>30 ORDER BY minute DESC LIMIT 50`),
    ]);
    const byDay = new Map(dayRows.map(row => [row.day, row]));
    const hours = new Map();
    for (const row of hourRows) hours.set(`${row.day}:${row.hour}`, number(row.count));
    const daily = [...days].reverse().map(date => {
      const row = byDay.get(date) || {};
      return {
        date, total: number(row.total), scan: number(row.scan),
        hours: Array.from({ length: 24 }, (_, hour) => hours.get(`${date}:${String(hour).padStart(2, '0')}`) || 0),
        statuses: {
          '200': number(row.status_200), homepage_fallback: number(row.status_fallback),
          '404': number(row.status_404), '403': number(row.status_403), '5xx': number(row.status_5xx), other: number(row.status_other),
        },
        types: {
          normal_page: number(row.type_page), static_asset: number(row.type_static),
          api: number(row.type_api), homepage_fallback: number(row.type_fallback),
        },
      };
    });
    const sum = key => Object.fromEntries(Object.keys(daily[0][key]).map(name => [name,
      daily.reduce((total, row) => total + row[key][name], 0)]));
    // Read existing location fields for visible IP rankings; this changes no counts or stored events.
    const visibleIps = [...new Set([...topIps.map(row => row.ip),
      ...suspiciousIps.map(row => row.value), ...bursts.map(row => row.ip)])];
    const geoRows = visibleIps.length ? await all(`SELECT ip,country,region FROM (
      SELECT ip,country,region,ROW_NUMBER() OVER (PARTITION BY ip ORDER BY ts DESC) geo_rank
      FROM request_events WHERE ${eventWhere} AND ip IN (${visibleIps.map(() => '?').join(',')})
    ) WHERE geo_rank=1`, [...args, ...visibleIps]) : [];
    const geoByIp = new Map(geoRows.map(row => [row.ip,{country:row.country,region:row.region}]));
    const geoFor = ip => geoByIp.get(ip) || {country:'',region:''};
    return res.status(200).json({
      from, to, domain, total: daily.reduce((n, row) => n + row.total, 0),
      scan: daily.reduce((n, row) => n + row.scan, 0), daily,
      statuses: sum('statuses'), types: sum('types'),
      topPaths, topIps: topIps.map(row => ({ ip: row.ip, ...geoFor(row.ip), count: number(row.count),
        firstSeen: new Date(row.first_seen).toISOString(), lastSeen: new Date(row.last_seen).toISOString(),
        pathCount: number(row.path_count) })),
      topAsns, topCountries, topUserAgents, topSources,
      suspiciousPaths, suspiciousIps: suspiciousIps.map(row => ({...row,...geoFor(row.value)})),
      bursts: bursts.map(row => ({...row,...geoFor(row.ip)})),
    });
  } catch (error) {
    console.error('Request analytics failed:', error?.message);
    return res.status(503).json({ error: '请求汇总暂时无法读取' });
  }
}
