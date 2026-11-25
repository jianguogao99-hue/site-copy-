import { classifyIpInfo } from './ip-classification.js';

export async function writeVisitEvent(db, event) {
  if (!db) throw new Error('Visit database is not bound');
  const ts = Date.parse(event.time);
  if (!Number.isFinite(ts)) throw new Error('Invalid visit time');
  await db.prepare(`INSERT OR IGNORE INTO visit_events
    (id,ts,day,domain,ip,country,region,city,kind,page,view_id,link,label,seconds,target_url,click_visible_seconds,asn,as_org)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(event.id, ts, event.time.slice(0,10), event.domain, event.ip,
      event.country || '未知', event.region || '', event.city || '', event.kind,
      event.page || '', event.viewId || '', event.link || '', event.label || '', event.seconds || 0,
      event.targetUrl || '', event.clickVisibleSeconds ?? null,event.asn ?? null,event.asOrg || '').run();
  // A conditional upsert preserves the 30-day cache without writing on every visit.
  if (event.asOrg) {
    const info = classifyIpInfo({ asn: event.asn, org: event.asOrg });
    await db.prepare(`INSERT INTO ip_info(ip,asn,org,provider,is_datacenter,source,updated_at)
      VALUES(?,?,?,?,?,'cf',?) ON CONFLICT(ip) DO UPDATE SET
      asn=excluded.asn,org=excluded.org,provider=excluded.provider,
      is_datacenter=excluded.is_datacenter,source='cf',updated_at=excluded.updated_at
      WHERE (ip_info.source != 'cf' OR ip_info.updated_at < ?) AND NOT
        (excluded.is_datacenter=-1 AND ip_info.is_datacenter!=-1)`)
      .bind(event.ip,event.asn ?? null,event.asOrg,info.provider,info.isDatacenter,ts,
        ts - 30*86400000).run();
  }
}

export async function readVisitStats(db, days, domain, buffered = []) {
  const from = days.at(-1).toISOString().slice(0,10);
  const to = days[0].toISOString().slice(0,10);
  const scope = domain || 'all';
  const rows = await db.prepare(`SELECT day,ip,country,region,city,visits,last_seen FROM visit_daily_ip
    WHERE domain=? AND day BETWEEN ? AND ? ORDER BY day DESC`).bind(scope,from,to).all();
  const ipMap = new Map(), regionMap = new Map(), dayMap = new Map();
  let total = 0;
  const bufferedRows=buffered.filter(event=>event.kind==='view'&&event.time?.slice(0,10)>=from&&
    event.time?.slice(0,10)<=to&&(!domain||event.domain===domain)).map(event=>({
      day:event.time.slice(0,10),ip:event.ip,country:event.country||'未知',region:event.region||'',
      city:event.city||'',visits:1,last_seen:Date.parse(event.time),
    }));
  for (const row of [...(rows.results || []),...bufferedRows]) {
    const visits = Number(row.visits) || 0;
    total += visits;
    dayMap.set(row.day,(dayMap.get(row.day)||0)+visits);
    const old = ipMap.get(row.ip);
    const last = Number(row.last_seen) || 0;
    ipMap.set(row.ip, {
      ip:row.ip,country:row.country,region:row.region,city:row.city,
      visits:(old?.visits||0)+visits,
      lastSeen:last > (old?._last||0) ? row.day : old?.lastSeen || row.day,
      lastVisitAt:last > (old?._last||0) && last ? new Date(last).toISOString() : old?.lastVisitAt || null,
      _last:Math.max(last,old?._last||0),
    });
    const area=`${row.country||'未知'} · ${row.region||'地区未知'}`;
    regionMap.set(area,(regionMap.get(area)||0)+visits);
  }
  const ips=[...ipMap.values()].map(({_last,...row})=>row)
    .sort((a,b)=>Date.parse(b.lastVisitAt||0)-Date.parse(a.lastVisitAt||0)||a.ip.localeCompare(b.ip));
  return {totalVisits:total,uniqueIps:ips.length,ips,
    regions:[...regionMap].map(([name,visits])=>({name,visits})).sort((a,b)=>b.visits-a.visits),
    timeline:[...days].reverse().map(day=>({date:day.toISOString().slice(0,10),visits:dayMap.get(day.toISOString().slice(0,10))||0}))};
}

export async function readVisitArchive(db) {
  const rows=await db.prepare('SELECT day,domain,visits FROM visit_archive_daily ORDER BY day').all();
  const allDaily={},daily={};
  for (const row of rows.results||[]) {
    if (row.domain==='all') allDaily[row.day]=Number(row.visits)||0;
    else (daily[row.domain] ||= {})[row.day]=Number(row.visits)||0;
  }
  return {source:'本站访问记录',from:null,domainFrom:null,allDaily,daily};
}
