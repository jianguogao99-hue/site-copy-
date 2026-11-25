import { isIP } from 'node:net';
import { authenticated, configured, privateHeaders, sameOrigin } from '../_lib/visitor-store.js';

export default async function handler(req,res) {
  privateHeaders(res);
  if (req.method !== 'POST') return res.status(405).end();
  if (!configured() || !req.auditDb) return res.status(503).json({error:'后台数据库尚未连接'});
  if (!authenticated(req)) return res.status(401).json({error:'请先登录'});
  if (!sameOrigin(req)) return res.status(403).json({error:'请求来源不受允许'});
  const type = String(req.body?.type || '');
  const ips = req.body?.ips;
  if (!['datacenter','broadband','unknown'].includes(type) || !Array.isArray(ips) ||
      ips.length > 5000 || ips.some(ip=>typeof ip !== 'string' || !isIP(ip)) ||
      new Set(ips).size !== ips.length)
    return res.status(400).json({error:'筛选参数无效'});
  try {
    const classes = new Map();
    for (let start=0; start<ips.length; start+=99) {
      const batch=ips.slice(start,start+99);
      const rows=await req.auditDb.prepare(`SELECT ip,is_datacenter FROM ip_info
        WHERE ip IN (${batch.map(()=>'?').join(',')}) AND updated_at>=?`)
        .bind(...batch,Date.now()-30*86400000).all();
      for (const row of rows.results || []) classes.set(row.ip,Number(row.is_datacenter));
      const annotations=await req.auditDb.prepare(`SELECT ip,is_datacenter FROM ip_research
        WHERE ip IN (${batch.map(()=>'?').join(',')})`)
        .bind(...batch).all();
      for (const row of annotations.results || [])
        if (!classes.has(row.ip) || classes.get(row.ip)===-1) classes.set(row.ip,Number(row.is_datacenter));
    }
    const wanted={datacenter:1,broadband:0,unknown:-1}[type];
    return res.status(200).json({type,ips:ips.filter(ip=>(classes.get(ip) ?? -1)===wanted)});
  } catch (error) {
    console.error('IP type filter failed:',error?.message);
    return res.status(503).json({error:'IP 筛选暂时不可用'});
  }
}
