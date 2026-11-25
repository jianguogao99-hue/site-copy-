import { authenticated, configured, daysBack, domainFromHost, privateHeaders, retentionDays } from '../_lib/visitor-store.js';

const PAGE_SIZES = new Set([25, 50, 100]);
function clickSignals(rows, perIp) {
  const byIp = new Map();
  const byPattern = new Map();
  for (const row of rows) {
    if (!byIp.has(row.ip)) byIp.set(row.ip, []);
    byIp.get(row.ip).push(row);
    const pattern = `${row.link}|${row.target_url}|${row.page}`;
    if (!byPattern.has(pattern)) byPattern.set(pattern, []);
    byPattern.get(pattern).push(row);
  }
  return row => {
    const own = byIp.get(row.ip) || [];
    if (own.filter(other => Math.abs(other.ts - row.ts) <= 180000).length >= 3)
      return { label:'疑似自动化', reason:'同一 IP 在 3 分钟内连续点击至少 3 次' };
    const pattern = `${row.link}|${row.target_url}|${row.page}`;
    const peers = (byPattern.get(pattern) || []).filter(other => Math.abs(other.ts - row.ts) <= 120000);
    if (new Set(peers.map(other => other.ip)).size >= 3)
      return { label:'疑似自动化', reason:'2 分钟内至少 3 个 IP 点击同一页面的同一目标' };
    const history = perIp.get(row.ip);
    if (history && Number(history.days) >= 2 && Number(history.days) === Number(history.clicks))
      return { label:'疑似真人', reason:'同一 IP 跨多日分散点击；仍不能据此确认身份' };
    return { label:'未分类', reason:'现有点击记录不足以判断' };
  };
}
export default async function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'GET') return res.status(405).end();
  if (!configured() || !req.auditDb) return res.status(503).json({ error: '后台数据库尚未连接' });
  if (!authenticated(req)) return res.status(401).json({ error: '请先登录' });
  const requestedDomain = String(req.query.domain || 'all');
  const domain = requestedDomain === 'all' ? null : domainFromHost(requestedDomain);
  const days = Number(req.query.days || 7);
  const offset = Number(req.query.offset || 0);
  const limit = Number(req.query.limit || 25);
  const contactOffset = Number(req.query.contactOffset || 0);
  const contactLimit = Number(req.query.contactLimit || 25);
  const hideTests = req.query.hideTests !== '0';
  if ((requestedDomain !== 'all' && !domain) || ![1, 7, 30, 90].includes(days) ||
      days > retentionDays() || !Number.isSafeInteger(offset) || offset < 0 || !PAGE_SIZES.has(limit) ||
      !Number.isSafeInteger(contactOffset) || contactOffset < 0 || !PAGE_SIZES.has(contactLimit))
    return res.status(400).json({ error: '查询参数无效' });
  const from = daysBack(days).at(-1).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const scope = domain ? ' AND domain=?' : '';
  const args = [from, to, ...(domain ? [domain] : [])];
  const db = req.auditDb;
  const where = `day BETWEEN ? AND ?${scope} AND kind='click' AND link LIKE 'exchange:%'${hideTests ? ' AND is_test=0' : ''}`;
  const geoWhere = `v.day BETWEEN ? AND ?${domain ? ' AND v.domain=?' : ''} AND v.kind='click' AND v.link LIKE 'exchange:%'${hideTests ? ' AND v.is_test=0' : ''}`;
  const contactWhere = `day BETWEEN ? AND ?${scope} AND kind='click' AND link IN ('contact:wechat','contact:tg','contact:twitter')${hideTests ? ' AND is_test=0' : ''}`;
  const contactDetailWhere = `v.day BETWEEN ? AND ?${domain ? ' AND v.domain=?' : ''} AND v.kind='click' AND v.link IN ('contact:wechat','contact:tg','contact:twitter','contact:tg-channel','contact:tg-direct')${hideTests ? ' AND v.is_test=0' : ''}`;
  try {
    const [summary, visits, ranking, byDomain, contacts] = await Promise.all([
      db.prepare(`SELECT COUNT(*) clicks,COUNT(DISTINCT ip) clicked_ips FROM visit_events WHERE ${where}`)
        .bind(...args).first(),
      db.prepare(`SELECT COUNT(DISTINCT ip) visitor_ips FROM visit_daily_ip WHERE domain=? AND day BETWEEN ? AND ?`)
        .bind(domain || 'all', from, to).first(),
      db.prepare(`SELECT link,MAX(label) exchange,COUNT(*) clicks FROM visit_events WHERE ${where}
        GROUP BY link ORDER BY clicks DESC,link LIMIT 20`).bind(...args).all(),
      db.prepare(`SELECT domain,COUNT(*) clicks,COUNT(DISTINCT ip) clicked_ips FROM visit_events
        WHERE day BETWEEN ? AND ? AND kind='click' AND link LIKE 'exchange:%'${hideTests ? ' AND is_test=0' : ''}
        GROUP BY domain ORDER BY clicks DESC,domain`).bind(from,to).all(),
      db.prepare(`SELECT link,COUNT(*) clicks FROM visit_events WHERE ${contactWhere} GROUP BY link`)
        .bind(...args).all(),
    ]);
    const noClick = await db.prepare(`SELECT COUNT(*) count FROM (
      SELECT DISTINCT ip FROM visit_daily_ip WHERE domain=? AND day BETWEEN ? AND ?
      EXCEPT SELECT DISTINCT ip FROM visit_events WHERE ${where})`)
      .bind(domain || 'all', from, to, ...args).first();
    const [contactSummary, contactRows] = await Promise.all([
      db.prepare(`SELECT COUNT(*) total FROM visit_events v WHERE ${contactDetailWhere}`).bind(...args).first(),
      db.prepare(`SELECT v.id,v.ts,v.domain,v.ip,v.page,v.link,v.label,v.is_test,
        CASE WHEN v.country IN ('','未知') THEN COALESCE(NULLIF(g.country,''),'未知') ELSE v.country END country,
        COALESCE(NULLIF(v.region,''),g.region,'') region,
        COALESCE(NULLIF(v.city,''),g.city,'') city,
        CASE WHEN v.country NOT IN ('','未知') THEN '点击记录'
          WHEN g.country NOT IN ('','未知') THEN '同日同 IP 访问记录' ELSE '无可用地区' END geo_source
        FROM visit_events v LEFT JOIN visit_daily_ip g ON g.domain='all' AND g.day=v.day AND g.ip=v.ip
        WHERE ${contactDetailWhere} ORDER BY v.ts DESC,v.id DESC LIMIT ? OFFSET ?`)
        .bind(...args,contactLimit,contactOffset).all(),
    ]);
    const rows = await db.prepare(`SELECT v.ts,v.domain,v.ip,
      CASE WHEN v.country IN ('','未知') THEN COALESCE(NULLIF(g.country,''),'未知') ELSE v.country END country,
      COALESCE(NULLIF(v.region,''),g.region,'') region,
      COALESCE(NULLIF(v.city,''),g.city,'') city,
      CASE WHEN v.country NOT IN ('','未知') THEN '点击记录'
        WHEN g.country NOT IN ('','未知') THEN '同日同 IP 访问记录' ELSE '无可用地区' END geo_source,
      v.id,v.page,v.link,v.label,v.target_url,v.is_test,v.click_visible_seconds
      FROM visit_events v LEFT JOIN visit_daily_ip g ON g.domain='all' AND g.day=v.day AND g.ip=v.ip
      WHERE ${geoWhere} ORDER BY v.ts DESC,v.id DESC LIMIT ? OFFSET ?`)
      .bind(...args, limit, offset).all();
    const pageRows = rows.results || [];
    const visibleIps = [...new Set(pageRows.filter(row=>row.is_test!==1).map(row=>row.ip))];
    let signalFor = () => ({ label:'未分类', reason:'现有点击记录不足以判断' });
    if (visibleIps.length) {
      const firstTs = Math.min(...pageRows.map(row=>Number(row.ts)))-180000;
      const lastTs = Math.max(...pageRows.map(row=>Number(row.ts)))+180000;
      const [nearby, histories] = await Promise.all([
        db.prepare(`SELECT ts,day,ip,link,target_url,page FROM visit_events WHERE ${where}
          AND is_test=0 AND ts BETWEEN ? AND ?`).bind(...args,firstTs,lastTs).all(),
        db.prepare(`SELECT ip,COUNT(*) clicks,COUNT(DISTINCT day) days FROM visit_events WHERE ${where}
          AND is_test=0 AND ip IN (${visibleIps.map(()=>'?').join(',')}) GROUP BY ip`)
          .bind(...args,...visibleIps).all(),
      ]);
      signalFor = clickSignals(nearby.results || [],new Map((histories.results||[]).map(row=>[row.ip,row])));
    }
    const contactCounts = Object.fromEntries((contacts.results || []).map(row => [row.link, Number(row.clicks) || 0]));
    return res.status(200).json({ from, to, domain: domain || 'all', days, offset, limit, hideTests,
      contactOffset, contactLimit, contactTotal:Number(contactSummary?.total) || 0,
      contactRecords:(contactRows.results || []).map(row => ({time:new Date(row.ts).toISOString(),
        domain:row.domain,ip:row.ip,page:row.page,link:row.link,label:row.label,
        country:row.country,region:row.region,city:row.city,geoSource:row.geo_source,isTest:row.is_test === 1})),
      contactClicks: { wechat: contactCounts['contact:wechat'] || 0,
        tg: contactCounts['contact:tg'] || 0, twitter: contactCounts['contact:twitter'] || 0 },
      total: Number(summary?.clicks) || 0, clickedIps: Number(summary?.clicked_ips) || 0,
      visitorIps: Number(visits?.visitor_ips) || 0, noClickIps: Number(noClick?.count) || 0,
      ranking: (ranking.results || []).map(row => ({ exchange: row.exchange, link: row.link, clicks: Number(row.clicks) || 0 })),
      byDomain: (byDomain.results || []).map(row => ({ domain:row.domain, clicks:Number(row.clicks)||0,
        clickedIps:Number(row.clicked_ips)||0 })),
      clicks: pageRows.map(row => ({time: new Date(row.ts).toISOString(), domain:row.domain,
        ip:row.ip, country:row.country, region:row.region, city:row.city,
        geoSource:row.geo_source, page:row.page, link:row.link, exchange:row.label,
        targetUrl:row.target_url || null, isTest:row.is_test === 1,
        visibleSeconds: row.click_visible_seconds == null ? null : Number(row.click_visible_seconds),
        signal: row.is_test === 1 ? {label:'测试点击',reason:'管理员已标记'} : signalFor(row),
        historicalTargetMissing:!row.target_url })) });
  } catch (error) {
    console.error('Affiliate clicks failed:', error?.message);
    return res.status(503).json({ error: '点击统计暂时无法读取' });
  }
}
