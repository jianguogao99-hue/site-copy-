import { authenticated, configured, daysBack, domainFromHost, privateHeaders, retentionDays } from '../_lib/visitor-store.js';
import { domainHistory } from '../_lib/domain-history.js';
import { readVisitArchive, readVisitStats } from '../_lib/visit-db.js';
import { bufferedVisitEvents } from '../_lib/visit-buffer.js';
import { readVisitLayers } from '../_lib/visit-layers.js';

export default async function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'GET') return res.status(405).end();
  if (!configured() || !req.auditDb) return res.status(503).json({ error: '后台数据库尚未连接' });
  if (!authenticated(req)) return res.status(401).json({ error: '请先登录' });
  const requestedDomain = String(req.query.domain || 'all');
  const domain = requestedDomain === 'all' ? null : domainFromHost(requestedDomain);
  if (requestedDomain !== 'all' && !domain) return res.status(400).json({ error: '域名无效' });
  const requested = Number(req.query.days || 7);
  if (![1,7,30,90].includes(requested) || requested > retentionDays())
    return res.status(400).json({ error: '查询天数超出保留范围' });
  try {
    const [buffered,archive] = await Promise.all([
      bufferedVisitEvents(req.visitBuffer, 900), readVisitArchive(req.auditDb)]);
    const days = daysBack(requested);
    const [stats,layers] = await Promise.all([
      readVisitStats(req.auditDb,days,domain,buffered),
      readVisitLayers(req.auditDb,days,domain,buffered),
    ]);
    const info = new Map();
    const research = new Map();
    let ipInfoAvailable = true;
    try {
      // D1 permits 100 bindings per query; reserve one for the cache cutoff.
      // One indexed lookup per batch, never one query per IP or visit.
      for (let start = 0; start < stats.ips.length; start += 99) {
        const batch = stats.ips.slice(start,start+99).map(row=>row.ip);
        const rows = await req.auditDb.prepare(`SELECT ip,asn,org,isp,asname,hosting,provider,is_datacenter,source,updated_at
          FROM ip_info WHERE ip IN (${batch.map(()=>'?').join(',')}) AND updated_at>=?`)
          .bind(...batch,Date.now()-30*86400000).all();
        for (const row of rows.results || []) info.set(row.ip,row);
        const annotations = await req.auditDb.prepare(`SELECT ip,network_kind,provider,evidence,is_datacenter,checked_at
          FROM ip_research WHERE ip IN (${batch.map(()=>'?').join(',')})`)
          .bind(...batch).all();
        for (const row of annotations.results || []) research.set(row.ip,row);
      }
    } catch (error) {
      console.error('IP cache stats failed:',error?.message);
      info.clear();
      ipInfoAvailable = false;
    }
    const allIps = stats.ips.map(row=>({ ...row,ipInfo:info.get(row.ip) || null,
      ipResearch:research.get(row.ip) || null }));
    const datacenterIps = ipInfoAvailable
      ? allIps.filter(row=>Number(row.ipInfo?.is_datacenter)===1 ||
        (Number(row.ipInfo?.is_datacenter ?? -1)===-1 && Number(row.ipResearch?.is_datacenter)===1)).length : null;
    stats.ips = allIps;
    return res.status(200).json({rangeDays:requested,domain:domain||'all',history:domainHistory,
      archive,retentionDays:retentionDays(),bufferedEvents:buffered.length,layers,...stats,
      datacenterIps,ipInfoAvailable,ipApiBackfillEnabled:process.env.PYY_IP_API_BACKFILL_ENABLED==='1',
      refreshedAt:new Date().toISOString()});
  } catch (error) {
    console.error('Visit stats failed:',error?.message);
    return res.status(503).json({ error: '统计暂时无法读取，请稍后重试' });
  }
}
