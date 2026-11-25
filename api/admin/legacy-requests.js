import { authenticated, configured, domainFromHost, privateHeaders } from '../_lib/visitor-store.js';
import { requestType, suspiciousPath } from '../_lib/request-audit.js';

const DATE=/^\d{4}-\d{2}-\d{2}$/;
export default async function handler(req,res) {
  privateHeaders(res);
  if(req.method!=='GET') return res.status(405).end();
  if(!configured()||!req.auditDb) return res.status(503).json({error:'后台数据库尚未连接'});
  if(!authenticated(req)) return res.status(401).json({error:'请先登录'});
  const domain=String(req.query.domain||'all');
  const ip=String(req.query.ip||'').trim();
  const path=String(req.query.path||'').trim();
  const from=String(req.query.from||'1970-01-01');
  const to=String(req.query.to||new Date().toISOString().slice(0,10));
  const offset=Number(req.query.offset||0);
  const limit=Number(req.query.limit||25);
  if((domain!=='all'&&!domainFromHost(domain))||ip.length>45||path.length>256||
    !DATE.test(from)||!DATE.test(to)||from>to||!Number.isSafeInteger(offset)||offset<0||![25,50,100].includes(limit))
    return res.status(400).json({error:'筛选条件无效'});
  const where=`c.day BETWEEN ? AND ?${domain==='all'?'':' AND json_extract(j.value,\'$.domain\')=?'}${ip?' AND json_extract(j.value,\'$.ip\')=?':''}${path?' AND instr(json_extract(j.value,\'$.path\'),?)>0':''}`;
  const args=[from,to,...(domain==='all'?[]:[domain]),...(ip?[ip]:[]),...(path?[path]:[])];
  try {
    const db=req.auditDb;
    let total,rawEvents;
    if(domain==='all'&&!ip&&!path) {
      const range=[from,to];
      total=Number((await db.prepare('SELECT COALESCE(SUM(count),0) count FROM request_legacy_chunks WHERE day BETWEEN ? AND ?')
        .bind(...range).first())?.count)||0;
      rawEvents=[];
      if(offset<total) {
        const batches=await db.prepare(`SELECT batch_id,count,cumulative FROM (
          SELECT batch_id,count,day,SUM(count) OVER (ORDER BY day DESC,batch_id ASC) cumulative
          FROM request_legacy_chunks WHERE day BETWEEN ? AND ?
        ) WHERE cumulative>? ORDER BY day DESC,batch_id ASC LIMIT ?`).bind(...range,offset,limit).all();
        for(const batch of batches.results||[]) {
          const row=await db.prepare('SELECT payload FROM request_legacy_chunks WHERE batch_id=?').bind(batch.batch_id).first();
          const start=Math.max(0,offset-(Number(batch.cumulative)-Number(batch.count)));
          rawEvents.push(...JSON.parse(row.payload).slice(start,start+limit-rawEvents.length));
          if(rawEvents.length===limit) break;
        }
      }
    } else {
      total=Number((await db.prepare(`SELECT COUNT(*) count FROM request_legacy_chunks c,json_each(c.payload) j WHERE ${where}`)
        .bind(...args).first())?.count)||0;
      const rows=await db.prepare(`SELECT j.value raw FROM request_legacy_chunks c,json_each(c.payload) j WHERE ${where} ORDER BY json_extract(j.value,'$.time') DESC LIMIT ? OFFSET ?`)
        .bind(...args,limit,offset).all();
      rawEvents=(rows.results||[]).map(row=>JSON.parse(row.raw));
    }
    const events=rawEvents.map(x=>{
      return {time:x.time,domain:x.domain,ip:x.ip,method:x.method,path:x.path,status:x.status,
        type:requestType(x.path||'', '', Number(x.status)||0),suspicious:suspiciousPath(x.path||''),
        userAgent:x.userAgent||'',referer:x.referer||'',country:x.country||'',region:x.region||'',
        asn:x.asn||null,asOrganization:x.asOrganization||''};
    });
    return res.status(200).json({from,to,domain,ip,path,total,offset,limit,events});
  } catch(error) {
    console.error('Legacy request query failed:',error?.message);
    return res.status(503).json({error:'历史请求暂时无法读取'});
  }
}
