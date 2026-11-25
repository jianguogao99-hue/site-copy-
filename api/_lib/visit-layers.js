function category(signal) {
  if (signal?.scan || signal?.bot) return 'automation';
  if (signal?.click && signal?.browser) return 'human';
  return 'unknown';
}

export async function readVisitLayers(db, days, domain, buffered = []) {
  const from = days.at(-1).toISOString().slice(0,10);
  const to = days[0].toISOString().slice(0,10);
  const scope = domain || 'all';
  const [views,requests,clicks] = await Promise.all([
    db.prepare(`SELECT day,ip,visits FROM visit_daily_ip WHERE domain=? AND day BETWEEN ? AND ?`)
      .bind(scope,from,to).all(),
    db.prepare(`SELECT r.day,r.ip,MAX(r.suspicious) scan,
      MAX(CASE WHEN lower(r.user_agent) LIKE '%bot%' OR lower(r.user_agent) LIKE '%crawler%'
        OR lower(r.user_agent) LIKE '%spider%' OR lower(r.user_agent) LIKE '%semrush%'
        OR lower(r.user_agent) LIKE '%facebookexternalhit%' OR lower(r.user_agent) LIKE '%meta-externalagent%'
        OR lower(r.user_agent) LIKE '%python-requests%' OR lower(r.user_agent) LIKE '%go-http-client%'
        OR lower(r.user_agent) LIKE '%curl/%' OR lower(r.user_agent) LIKE '%wget/%' THEN 1 ELSE 0 END) bot,
      MAX(CASE WHEN lower(r.user_agent) LIKE '%mozilla/5.0%' OR lower(r.user_agent) LIKE '%chrome/%'
        OR lower(r.user_agent) LIKE '%safari/%' OR lower(r.user_agent) LIKE '%firefox/%'
        OR lower(r.user_agent) LIKE '%edg/%' THEN 1 ELSE 0 END) browser
      FROM request_events r JOIN visit_daily_ip v ON v.day=r.day AND v.ip=r.ip AND v.domain=?
      WHERE r.day BETWEEN ? AND ?${domain ? ' AND r.domain=?' : ''}
      GROUP BY r.day,r.ip`).bind(scope,from,to,...(domain?[domain]:[])).all(),
    db.prepare(`SELECT DISTINCT day,ip FROM visit_events WHERE day BETWEEN ? AND ?
      ${domain ? 'AND domain=?' : ''} AND kind='click' AND link LIKE 'exchange:%' AND is_test=0`)
      .bind(from,to,...(domain?[domain]:[])).all(),
  ]);
  const signals = new Map();
  const signalFor = (day,ip) => {
    const key = `${day}|${ip}`;
    if (!signals.has(key)) signals.set(key,{day,ip,scan:false,bot:false,browser:false,click:false});
    return signals.get(key);
  };
  for (const row of requests.results || []) {
    const signal = signalFor(row.day,row.ip);
    signal.scan = Number(row.scan) > 0;
    signal.bot = Number(row.bot) > 0;
    signal.browser = Number(row.browser) > 0;
  }
  for (const row of clicks.results || []) signalFor(row.day,row.ip).click = true;
  const daily = new Map(), byIp = new Map();
  const addView = row => {
    const count = Number(row.visits) || 0;
    if (!daily.has(row.day)) daily.set(row.day,{date:row.day,human:0,automation:0,unknown:0});
    const signal = signalFor(row.day,row.ip);
    daily.get(row.day)[category(signal)] += count;
    const current = byIp.get(row.ip) || {scan:false,bot:false,browser:false,click:false};
    current.scan ||= signal.scan;
    current.bot ||= signal.bot;
    current.browser ||= signal.browser;
    current.click ||= signal.click;
    byIp.set(row.ip,current);
  };
  for (const row of views.results || []) addView(row);
  for (const event of buffered) {
    if (event.kind !== 'view' || event.time?.slice(0,10) < from || event.time?.slice(0,10) > to ||
        (domain && event.domain !== domain)) continue;
    addView({day:event.time.slice(0,10),ip:event.ip,visits:1});
  }
  const ips = {human:0,automation:0,unknown:0};
  for (const signal of byIp.values()) ips[category(signal)] += 1;
  return {ips,daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)),
    explanation:'IP 分层：可疑路径或明确爬虫标识优先归机器人与扫描；有返佣点击和浏览器请求且未见探测归疑似真人；其余未分类。'};
}
