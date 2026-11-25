import { isIP } from 'node:net';
import { authenticated, configured, daysBack, domainFromHost, privateHeaders, retentionDays, sameOrigin } from '../_lib/visitor-store.js';

const PAGE_SIZE=30;
export default async function handler(req,res) {
  privateHeaders(res);
  if(req.method!=='POST') return res.status(405).end();
  if(!configured()||!req.auditDb) return res.status(503).json({error:'后台数据库尚未连接'});
  if(!authenticated(req)) return res.status(401).json({error:'请先登录'});
  if(!sameOrigin(req)) return res.status(403).json({error:'请求来源不受允许'});
  const ip=req.body?.ip,requestedDays=Number(req.body?.days??7),requestedPage=Number(req.body?.page??1);
  const requestedDomain=String(req.body?.domain||'all');
  const domain=requestedDomain==='all'?null:domainFromHost(requestedDomain);
  if(typeof ip!=='string'||!isIP(ip)||(requestedDomain!=='all'&&!domain)||
    ![1,7,30,90].includes(requestedDays)||requestedDays>retentionDays()||
    !Number.isSafeInteger(requestedPage)||requestedPage<1)
    return res.status(400).json({error:'查询参数无效'});
  const from=daysBack(requestedDays).at(-1).toISOString().slice(0,10);
  const to=new Date().toISOString().slice(0,10);
  const scope=domain?' AND domain=?':'';
  const args=[ip,from,to,...(domain?[domain]:[])];
  try {
    const db=req.auditDb;
    const [count,summary,links]=await Promise.all([
      db.prepare(`SELECT COUNT(*) count FROM visit_events WHERE ip=? AND day BETWEEN ? AND ?${scope}`).bind(...args).first(),
      db.prepare(`SELECT COALESCE(SUM(seconds),0) seconds FROM visit_events WHERE ip=? AND day BETWEEN ? AND ?${scope}`).bind(...args).first(),
      db.prepare(`SELECT link,MAX(label) label,COUNT(*) clicks FROM visit_events WHERE ip=? AND day BETWEEN ? AND ?${scope} AND kind='click' GROUP BY link ORDER BY clicks DESC`).bind(...args).all(),
    ]);
    const totalEvents=Number(count?.count)||0,totalPages=Math.max(1,Math.ceil(totalEvents/PAGE_SIZE));
    const page=Math.min(requestedPage,totalPages);
    const rows=await db.prepare(`SELECT kind,ts,page,view_id,link,label,seconds FROM visit_events WHERE ip=? AND day BETWEEN ? AND ?${scope} ORDER BY ts DESC LIMIT ? OFFSET ?`)
      .bind(...args,PAGE_SIZE,(page-1)*PAGE_SIZE).all();
    return res.status(200).json({ip,rangeDays:requestedDays,domain:domain||'all',page,pageSize:PAGE_SIZE,
      totalPages,totalEvents,totalSiteSeconds:Number(summary?.seconds)||0,
      linkClicks:(links.results||[]).map(x=>({link:x.link,label:x.label,clicks:Number(x.clicks)||0})),
      events:(rows.results||[]).map(x=>({kind:x.kind,time:new Date(x.ts).toISOString(),page:x.page,viewId:x.view_id,
        ...(x.kind==='click'?{link:x.link,label:x.label}:{}),...(x.kind==='duration'?{seconds:x.seconds}:{})}))});
  } catch(error) {
    console.error('Visit events failed:',error?.message);
    return res.status(503).json({error:'访问明细暂时无法读取，请稍后重试'});
  }
}
