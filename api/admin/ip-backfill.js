import { isIP } from 'node:net';
import { authenticated, configured, daysBack, privateHeaders, retentionDays, sameOrigin } from '../_lib/visitor-store.js';
import { classifyIpInfo } from '../_lib/ip-classification.js';

const FIELDS = 'status,query,isp,org,as,asname,hosting,proxy,mobile,country,city';
const LIMIT = 100;
const TTL = 30 * 86400000;
const clean = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,160);

export default async function handler(req,res) {
  privateHeaders(res);
  if (req.method !== 'POST') return res.status(405).end();
  if (!configured() || !req.auditDb) return res.status(503).json({error:'后台数据库尚未连接'});
  if (!authenticated(req)) return res.status(401).json({error:'请先登录'});
  if (!sameOrigin(req)) return res.status(403).json({error:'请求来源不受允许'});
  if (process.env.PYY_IP_API_BACKFILL_ENABLED !== '1')
    return res.status(403).json({error:'历史 IP 回填未启用；请先确认 ip-api 使用许可'});
  const day = String(req.body?.day || daysBack(retentionDays()).at(-1).toISOString().slice(0,10));
  const afterIp = String(req.body?.afterIp || '');
  const today = new Date().toISOString().slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < daysBack(retentionDays()).at(-1).toISOString().slice(0,10)
      || day > today || (afterIp && !isIP(afterIp)))
    return res.status(400).json({error:'回填游标无效'});
  try {
    // Existing PRIMARY KEY(day,domain,ip) gives a bounded, resumable index range.
    const page = await req.auditDb.prepare(`SELECT ip FROM visit_daily_ip
      WHERE day=? AND domain='all' AND ip>? ORDER BY ip LIMIT ?`)
      .bind(day,afterIp,LIMIT).all();
    const ips = (page.results || []).map(row=>row.ip);
    const lastIp = ips.at(-1) || afterIp;
    const nextDay = ips.length < LIMIT && day < today
      ? new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0,10) : day;
    const nextAfterIp = nextDay === day ? lastIp : '';
    let cached = new Map();
    if (ips.length) {
      const rows = await req.auditDb.prepare(`SELECT ip,updated_at FROM ip_info
        WHERE ip IN (${ips.map(()=>'?').join(',')})`).bind(...ips).all();
      cached = new Map((rows.results || []).map(row=>[row.ip,Number(row.updated_at)]));
    }
    const now = Date.now();
    const stale = ips.filter(ip => !cached.has(ip) || cached.get(ip) < now-TTL);
    let written = 0;
    if (stale.length) {
      const response = await fetch(`http://ip-api.com/batch?fields=${FIELDS}`, {
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(stale),
      });
      if (!response.ok) return res.status(502).json({error:response.status===429
        ? `ip-api 已限流，请在 ${response.headers.get('X-Ttl') || '稍后'} 秒后重试` : 'ip-api 批量查询失败'});
      const data = await response.json();
      if (!Array.isArray(data) || data.length !== stale.length ||
          data.some((row,index)=>row?.query !== stale[index]))
        return res.status(502).json({error:'ip-api 返回结果不完整，未写入缓存'});
      const writes=[];
      for (const row of data) {
        if (row.status !== 'success') continue;
        const asn = Number(String(row.as || '').match(/\bAS(\d+)\b/i)?.[1]) || null;
        const original = clean(row.org);
        const info = classifyIpInfo({asn,org:original,isp:row.isp,asname:row.asname,
          as:row.as,hosting:row.hosting});
        writes.push(req.auditDb.prepare(`INSERT INTO ip_info
          (ip,asn,org,isp,asname,hosting,provider,is_datacenter,source,updated_at)
          VALUES(?,?,?,?,?,?,?,?,'ip-api',?) ON CONFLICT(ip) DO UPDATE SET
          asn=excluded.asn,org=excluded.org,isp=excluded.isp,asname=excluded.asname,
          hosting=excluded.hosting,provider=excluded.provider,is_datacenter=excluded.is_datacenter,
          source='ip-api',updated_at=excluded.updated_at WHERE ip_info.updated_at < ?`)
          .bind(row.query,asn,original,clean(row.isp),clean(row.asname),row.hosting===true?1:0,
            info.provider,info.isDatacenter,now,now-TTL));
      }
      if (writes.length) { await req.auditDb.batch(writes); written = writes.length; }
    }
    return res.status(200).json({day,nextDay,afterIp:nextAfterIp,scanned:ips.length,
      queried:stale.length,written,done:day===today && ips.length<LIMIT});
  } catch (error) {
    console.error('IP backfill failed:',error?.message);
    return res.status(503).json({error:'IP 回填失败，请稍后重试'});
  }
}
