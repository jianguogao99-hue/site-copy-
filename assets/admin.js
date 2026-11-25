const $ = selector => document.querySelector(selector);
const names = window.PyyAdminNames;
const OWNER_IPS = new Set();
const loginView = $('#login-view');
const dashboard = $('#dashboard');
const logoutButton = $('#logout');
const themeButton = $('#theme-toggle');
function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeButton.textContent = dark ? '浅色模式' : '深色模式';
  themeButton.setAttribute('aria-pressed',String(dark));
  try { localStorage.setItem('pyy-admin-theme',dark?'dark':'light'); } catch {}
}
try { setTheme(localStorage.getItem('pyy-admin-theme')==='dark'); } catch { setTheme(false); }
themeButton.addEventListener('click',()=>setTheme(document.documentElement.dataset.theme!=='dark'));
const status = $('#data-status');
const range = $('#range');
const domain = $('#domain');
const search = $('#ip-search');
const detailPanel = $('#ip-detail');
const formatter = new Intl.NumberFormat('zh-CN');
const pageSize = () => Number($('#ip-page-size').value);
let snapshot = null;
let visibleIps = [];
let ipType = 'all';
let filterId = 0;
let backfillCursor = null;
try { backfillCursor = JSON.parse(localStorage.getItem('pyy-ip-backfill-cursor') || 'null'); } catch {}
let page = 1;
let requestId = 0;
let statsController = null;
let detailIp = null;
let detailPage = 1;
let detailRequestedPage = 1;
let detailRequestId = 0;
let detailController = null;
let activeView = 'overview';
let visitChart = null;

function selectView(view) {
  activeView = view;
  for (const button of document.querySelectorAll('.admin-nav [data-view]')) {
    const selected = button.dataset.view === view;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const section of document.querySelectorAll('[data-admin-page]'))
    section.classList.toggle('admin-page-hidden', section.dataset.adminPage !== view);
  const names = { overview: '访问总览', clicks: '点击统计', ips: 'IP 访问明细', requests: '请求与探测记录', archive: '历史归档' };
  $('#dashboard-title').textContent = names[view];
  $('.dashboard-head p:last-child').textContent = view === 'overview'
    ? '按公开 IP 汇总页面访问；同一网络下多人可能共用一个 IP。'
    : view === 'clicks' ? '区分页面访问与交易所返佣链接点击跳出。'
    : view === 'ips' ? '最近访问的 IP 排在前面。'
    : view === 'requests' ? '查看新请求及其每日汇总。'
    : '按时间查找从旧库迁入的原始请求。';
  if (view === 'clicks') window.PyyAdminClicks?.load();
  if (view === 'requests') window.PyyRequestAudit?.load();
  if (view === 'archive') window.PyyRequestAudit?.loadLegacy();
  if (view === 'overview') requestAnimationFrame(() => visitChart?.resize());
}

function pageName(path) {
  if (path === '/') return '首页';
  if (path === '/markets.html') return '热门行情';
  if (path === '/privacy.html') return '访问数据说明';
  return path || '页面';
}

function formatTime(value) {
  return names.beijingTime(value);
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = seconds % 60;
  return `${hours ? `${hours} 小时 ` : ''}${minutes ? `${minutes} 分 ` : ''}${rest || (!hours && !minutes) ? `${rest} 秒` : ''}`.trim();
}

function closeDetail(restoreFocus = false) {
  const previousIp = detailIp;
  detailRequestId += 1;
  detailController?.abort();
  detailController = null;
  detailIp = null;
  detailPage = 1;
  detailRequestedPage = 1;
  detailPanel.hidden = true;
  $('#detail-content').hidden = true;
  $('#detail-retry').hidden = true;
  $('#detail-status').textContent = '';
  for (const button of document.querySelectorAll('.detail-trigger')) {
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', `查看 ${button.dataset.location || button.dataset.ip} 的逐次记录`);
    button.textContent = '查看记录';
  }
  if (restoreFocus && previousIp) {
    const trigger = [...document.querySelectorAll('.detail-trigger')].find(button => button.dataset.ip === previousIp);
    trigger?.focus();
  }
}

function showDashboard(visible) {
  loginView.hidden = visible;
  dashboard.hidden = !visible;
  logoutButton.hidden = !visible;
  if (!visible) {
    closeDetail();
    $('#password').focus();
  }
}

function cell(row, value) {
  const element = document.createElement('td');
  element.textContent = value;
  row.append(element);
}

function renderDetail(data) {
  $('#detail-duration').textContent = `约 ${formatDuration(data.totalSiteSeconds)}`;
  $('#detail-total').textContent = `${formatter.format(data.totalEvents || 0)} 条`;
  const links = $('#detail-links');
  links.replaceChildren();
  if (!data.linkClicks?.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '该 IP 在所选时间内暂无链接点击记录。';
    links.append(empty);
  } else {
    for (const item of data.linkClicks) {
      const row = document.createElement('div');
      row.className = 'link-item';
      const label = document.createElement('span');
      label.textContent = item.link?.startsWith('exchange:')
        ? names.exchangeName(item.label,item.link) : item.label || item.link || '未命名链接';
      const count = document.createElement('b');
      count.textContent = `${formatter.format(item.clicks || 0)} 次`;
      row.append(label, count);
      links.append(row);
    }
  }

  const events = $('#detail-events');
  events.replaceChildren();
  if (!data.events?.length) {
    const empty = document.createElement('li');
    empty.className = 'event-empty';
    empty.textContent = '暂无精确记录。访问明细从本站部署后开始记录。';
    events.append(empty);
  } else {
    for (const item of data.events) {
      const row = document.createElement('li');
      row.className = 'event-item';
      const time = document.createElement('time');
      time.dateTime = item.time || '';
      time.textContent = formatTime(item.time);
      const body = document.createElement('div');
      const action = document.createElement('strong');
      const context = document.createElement('span');
      if (item.kind === 'view') {
        action.textContent = `访问${pageName(item.page)}`;
        context.textContent = '页面载入';
      } else if (item.kind === 'click') {
        action.textContent = `点击${item.link?.startsWith('exchange:')
          ? names.exchangeName(item.label,item.link) : item.label || item.link || '链接'}`;
        context.textContent = `来自${pageName(item.page)} · 仅记录点击，不含外站停留`;
      } else if (item.kind === 'duration') {
        action.textContent = `本站停留约 ${formatDuration(item.seconds)}`;
        context.textContent = `${pageName(item.page)} · 只计页面在前台显示的时间`;
      } else {
        action.textContent = '活动记录';
        context.textContent = pageName(item.page);
      }
      body.append(action, context);
      row.append(time, body);
      events.append(row);
    }
  }
  detailPage = data.page || 1;
  const totalPages = Math.max(1, data.totalPages || 1);
  $('#detail-page-status').textContent = `第 ${detailPage} / ${totalPages} 页 · 共 ${formatter.format(data.totalEvents || 0)} 条`;
  $('#detail-previous').disabled = detailPage <= 1;
  $('#detail-next').disabled = detailPage >= totalPages;
  $('#detail-content').hidden = false;
}

async function loadDetail(targetPage = 1, focusEvents = false) {
  if (!detailIp) return;
  detailRequestedPage = targetPage;
  const selectedIp = detailIp;
  const current = ++detailRequestId;
  const showingPreviousPage = !$('#detail-content').hidden;
  const previousPage = detailPage;
  detailController?.abort();
  detailController = new AbortController();
  const detailStatus = $('#detail-status');
  detailStatus.className = 'data-status detail-status';
  detailStatus.setAttribute('role', 'status');
  detailStatus.textContent = showingPreviousPage
    ? `正在读取第 ${targetPage} 页，当前仍显示第 ${previousPage} 页…`
    : '正在读取此 IP 的记录…';
  if (showingPreviousPage) $('#detail-page-status').textContent = `正在读取第 ${targetPage} 页 · 当前仍显示第 ${previousPage} 页`;
  $('#detail-retry').hidden = true;
  $('#detail-previous').disabled = true;
  $('#detail-next').disabled = true;
  try {
    const response = await fetch('/api/admin/events', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: selectedIp, days: Number(range.value), page: targetPage, domain: domain.value }),
      signal: detailController.signal,
    });
    if (current !== detailRequestId || detailIp !== selectedIp) return;
    if (response.status === 401) {
      snapshot = null;
      showDashboard(false);
      $('#login-error').textContent = '登录已过期，请重新输入密码。';
      return;
    }
    if (!response.ok) throw new Error('读取记录失败');
    const data = await response.json();
    if (current !== detailRequestId || detailIp !== selectedIp) return;
    renderDetail(data);
    detailStatus.textContent = data.totalEvents ? '已读取此 IP 的逐次记录。' : '暂无逐次记录。';
    if (focusEvents) $('#detail-events-title').focus();
  } catch (error) {
    if (current !== detailRequestId || error.name === 'AbortError') return;
    detailStatus.className = 'data-status detail-status error';
    detailStatus.setAttribute('role', 'alert');
    detailStatus.textContent = showingPreviousPage
      ? `第 ${targetPage} 页读取失败，当前仍显示第 ${previousPage} 页。请重试。`
      : '此 IP 的记录读取失败，请重试。';
    if (showingPreviousPage) $('#detail-page-status').textContent = `第 ${targetPage} 页读取失败 · 当前仍显示第 ${previousPage} 页`;
    $('#detail-retry').hidden = false;
    $('#detail-previous').disabled = true;
    $('#detail-next').disabled = true;
    $('#detail-retry').focus();
  }
}

function openDetail(item) {
  if (detailIp === item.ip && !detailPanel.hidden) {
    closeDetail(true);
    return;
  }
  closeDetail();
  detailIp = item.ip;
  $('#detail-ip').textContent = names.ipLocation(item.ip,item);
  const info = item.ipInfo;
  const research = (!info || Number(info.is_datacenter) === -1) ? item.ipResearch : null;
  $('#detail-ip-info').textContent = research
    ? `网络复核：${research.network_kind} · ${research.provider} · ${research.evidence} · 更新：${formatTime(new Date(Number(research.checked_at)).toISOString())}`
    : info
    ? `网络依据：ASN ${info.asn || '未知'} · org：${info.org || '未提供'} · ISP：${info.isp || '未提供'} · AS 名称：${info.asname || '未提供'} · hosting：${info.hosting == null ? '未提供' : info.hosting ? '是' : '否'} · 来源：${info.source} · 更新：${formatTime(new Date(Number(info.updated_at)).toISOString())}`
    : '网络依据：暂无缓存；可手动回填历史 IP。';
  detailPanel.hidden = false;
  for (const button of document.querySelectorAll('.detail-trigger')) {
    const expanded = button.dataset.ip === item.ip;
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', `${expanded ? '收起' : '查看'} ${button.dataset.location || button.dataset.ip} 的逐次记录`);
    button.textContent = expanded ? '收起记录' : '查看记录';
  }
  $('#detail-title').focus({ preventScroll: true });
  detailPanel.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  loadDetail(1);
}

function renderRows() {
  if (!snapshot) return;
  const query = search.value.trim().toLowerCase();
  const matching = visibleIps.filter(item =>
    `${item.ip} ${item.country} ${item.region} ${item.city} ${names.locationName(item)}`.toLowerCase().includes(query));
  const pages = Math.max(1, Math.ceil(matching.length / pageSize()));
  page = Math.min(page, pages);
  const from = (page - 1) * pageSize();
  const body = $('#ip-rows');
  body.replaceChildren();
  for (const item of matching.slice(from, from + pageSize())) {
    const row = document.createElement('tr');
    cell(row, names.ipLocation(item.ip,item));
    if (OWNER_IPS.has(item.ip)) {
      const owner = document.createElement('span');
      owner.className = 'ip-owner-badge';
      owner.textContent = '站长本人';
      row.lastElementChild.append(' ', owner);
    }
    const badgeCell = document.createElement('td');
    const badge = document.createElement('span');
    const rawKind = item.ipInfo?.is_datacenter;
    const kind = rawKind == null || Number(rawKind) === -1
      ? Number(item.ipResearch?.is_datacenter ?? -1) : Number(rawKind);
    badge.className = `ip-type-badge ${kind === -1 ? 'ip-unknown' : kind === 1 ? 'ip-datacenter' : 'ip-broadband'}`;
    const research = (!item.ipInfo || Number(item.ipInfo.is_datacenter) === -1) ? item.ipResearch : null;
    badge.textContent = research
      ? `${research.network_kind} · ${research.provider}`
      : !item.ipInfo || kind === -1 ? '未知'
      : `${kind === 1 ? '机房' : '宽带'} · ${item.ipInfo.provider || '未识别服务商'}`;
    badge.title = research
      ? `${research.evidence}；更新：${formatTime(new Date(Number(research.checked_at)).toISOString())}`
      : item.ipInfo
      ? `ASN ${item.ipInfo.asn || '未知'}；org：${item.ipInfo.org || '未提供'}；来源：${item.ipInfo.source}；更新：${formatTime(new Date(Number(item.ipInfo.updated_at)).toISOString())}`
      : '暂无网络信息缓存';
    badgeCell.append(badge);
    row.append(badgeCell);
    cell(row, formatter.format(item.visits));
    cell(row, item.lastVisitAt ? formatTime(item.lastVisitAt) : `${item.lastSeen} · 时间未记录`);
    const actionCell = document.createElement('td');
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'detail-trigger';
    action.dataset.ip = item.ip;
    action.dataset.location = names.ipLocation(item.ip,item);
    action.setAttribute('aria-controls', 'ip-detail');
    action.setAttribute('aria-expanded', String(detailIp === item.ip && !detailPanel.hidden));
    action.setAttribute('aria-label', `查看 ${names.ipLocation(item.ip,item)} 的逐次记录`);
    action.textContent = '查看记录';
    action.addEventListener('click', () => openDetail(item));
    actionCell.append(action);
    row.append(actionCell);
    body.append(row);
  }
  if (!matching.length) {
    const row = document.createElement('tr');
    const empty = document.createElement('td');
    empty.colSpan = 5;
    empty.textContent = query ? '没有匹配的 IP 或地区，请清除搜索条件。' : '该时间范围尚无访问记录。';
    row.append(empty);
    body.append(row);
  }
  $('#ip-count').textContent = query ? `匹配 ${formatter.format(matching.length)} 个 IP` : `共 ${formatter.format(matching.length)} 个 IP`;
  $('#page-status').textContent = `第 ${page} / ${pages} 页`;
  $('#ip-jump').value = String(page);
  $('#ip-jump').max = String(pages);
  $('#previous').disabled = page === 1;
  $('#next').disabled = page === pages;
}

function render() {
  $('#total-visits').textContent = formatter.format(snapshot.totalVisits);
  $('#unique-ips').textContent = formatter.format(snapshot.uniqueIps);
  $('#datacenter-ips').textContent = snapshot.ipInfoAvailable === false ? '不可用' : formatter.format(snapshot.datacenterIps || 0);
  $('#datacenter-share').textContent = snapshot.ipInfoAvailable === false ? '缓存读取失败，请稍后刷新'
    : `占不同 IP 的 ${snapshot.uniqueIps ? (100*(snapshot.datacenterIps || 0)/snapshot.uniqueIps).toFixed(1) : '0.0'}%`;
  $('#top-region').textContent = snapshot.regions[0] ? names.regionSummary(snapshot.regions[0].name) : '暂无记录';
  $('#layer-human').textContent = formatter.format(snapshot.layers?.ips?.human || 0);
  $('#layer-bot').textContent = formatter.format(snapshot.layers?.ips?.automation || 0);
  $('#layer-unknown').textContent = formatter.format(snapshot.layers?.ips?.unknown ?? snapshot.uniqueIps);
  const historyCounts = $('#history-counts');
  historyCounts.replaceChildren();
  const historical = snapshot.history?.pageviews || {};
  const entries = domain.value === 'all' ? Object.entries(historical) : [[domain.value, historical[domain.value] || 0]];
  for (const [host, count] of entries) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const name = document.createElement('span');
    name.textContent = host;
    const value = document.createElement('strong');
    value.textContent = `${formatter.format(count)} 次浏览`;
    row.append(name, value);
    historyCounts.append(row);
  }
  const archiveDaily = snapshot.archive?.daily || {};
  const allDaily = snapshot.archive?.allDaily || {};
  const archiveEntries = domain.value === 'all'
    ? Object.entries(archiveDaily).sort(([a],[b])=>a.localeCompare(b))
    : [[domain.value, archiveDaily[domain.value] || {}]];
  const archiveCounts = $('#archive-counts');
  archiveCounts.replaceChildren();
  const monthly = new Map();
  for (const [host, dates] of archiveEntries) {
    const total = Object.values(dates).reduce((sum, count) => sum + (Number(count) || 0), 0);
    const row = document.createElement('tr');
    const name = document.createElement('th'); name.scope='row';
    name.textContent = host;
    const value = document.createElement('td');
    value.textContent = formatter.format(total);
    row.append(name, value);
    archiveCounts.append(row);
  }
  const archiveEnd = Object.keys(allDaily).sort().at(-1);
  const archiveAll = Object.values(allDaily).reduce((sum,value)=>sum+(Number(value)||0),0);
  const namedTotal = Object.values(archiveDaily).reduce((sum,dates)=>
    sum+Object.values(dates).reduce((part,value)=>part+(Number(value)||0),0),0);
  const gap = archiveAll - namedTotal;
  if(domain.value==='all') {
    const parts = gap > 0 ? [['未归属域名的历史访问',gap]] : [];
    for(const [label,value] of [...parts,['全站合计（以上各项之和）',archiveAll]]) {
      const row=document.createElement('tr');
      const name=document.createElement('th');name.scope='row';name.textContent=label;
      const count=document.createElement('td');count.textContent=formatter.format(value);
      if(label.startsWith('全站合计'))row.className='archive-total-row';
      row.append(name,count);archiveCounts.append(row);
    }
  }
  const newer = (snapshot.timeline || []).filter(day => day.date > (archiveEnd || ''))
    .reduce((sum,day)=>sum+(Number(day.visits)||0),0);
  $('#archive-reconcile').textContent = domain.value === 'all'
    ? `已归档至 ${archiveEnd || '暂无'} UTC：全站 ${formatter.format(archiveAll)} 次；已分域名 ${formatter.format(namedTotal)} 次；未归属域名 ${formatter.format(Math.max(0,gap))} 次。${snapshot.rangeDays===90?`近 90 天另含归档日期之后 ${formatter.format(newer)} 次页面访问。`:''}`
    : `已归档至 ${archiveEnd || '暂无'} UTC。`;
  const monthDates = domain.value === 'all' ? allDaily : archiveDaily[domain.value] || {};
  for (const [date, count] of Object.entries(monthDates)) {
    const month = date.slice(0, 7);
    monthly.set(month, (monthly.get(month) || 0) + (Number(count) || 0));
  }
  const archiveMonths = $('#archive-months');
  archiveMonths.replaceChildren();
  const months = [...monthly].sort(([a], [b]) => b.localeCompare(a));
  for (const [month, count] of months) {
    const row = document.createElement('div');
    row.className = 'archive-month';
    const name = document.createElement('span');
    name.textContent = month;
    const value = document.createElement('strong');
    value.textContent = `${formatter.format(count)} 次访问`;
    row.append(name, value);
    archiveMonths.append(row);
  }
  if (!months.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '暂无已结束日期的归档记录。';
    archiveMonths.append(empty);
  }
  const timeline = $('#timeline');
  for (const button of document.querySelectorAll('#chart-range [data-days]')) {
    const selected = button.dataset.days === range.value;
    button.classList.toggle('btn-primary', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  if (window.echarts) {
    visitChart ||= echarts.init(timeline);
    const days = snapshot.timeline || [];
    const peak = days.reduce((best,day)=>Number(day.visits)>Number(best?.visits||-1)?day:best,null);
    const peakParts = snapshot.layers?.daily?.find(day=>day.date===peak?.date);
    $('#chart-peak-note').textContent = peak
      ? `峰值：${peak.date}（UTC）${formatter.format(peak.visits)} 次页面访问；疑似真人 ${formatter.format(peakParts?.human||0)}、机器人与扫描 ${formatter.format(peakParts?.automation||0)}、未分类 ${formatter.format(peakParts?.unknown??peak.visits)}。`
      : '暂无访问数据。';
    const step = Math.max(1, Math.ceil(days.length / 7));
    visitChart.setOption({
      animation: false,
      grid: { left: 52, right: 18, top: 18, bottom: 40 },
      tooltip: { trigger: 'axis', formatter: params => {
        const point = params[0]; const part = snapshot.layers?.daily?.find(day=>day.date===point.axisValue);
        return `${point.axisValue} UTC<br>页面访问 ${formatter.format(point.value)} 次<br>疑似真人 ${formatter.format(part?.human||0)} · 机器人与扫描 ${formatter.format(part?.automation||0)} · 未分类 ${formatter.format(part?.unknown??point.value)}`;
      } },
      xAxis: { type: 'category', boundaryGap: false, data: days.map(day => day.date),
        axisLabel: { interval: (index) => index === 0 || index === days.length - 1 || index % step === 0,
          formatter: value => value.replaceAll('-', '.'), color: '#66758c' },
        axisLine: { lineStyle: { color: '#d9e1ec' } }, axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#66758c' }, splitLine: { lineStyle: { color: '#edf1f7' } } },
      series: [{ name: '页面访问', type: 'line', data: days.map(day => day.visits),
        symbol: days.length <= 7 ? 'circle' : 'none', smooth: .18,
        lineStyle: { width: 3, color: '#206bc4' }, areaStyle: { color: 'rgba(32,107,196,.13)' },
        itemStyle: { color: '#206bc4' },
        markPoint: peak ? { symbolSize: 38, data:[{coord:[peak.date,peak.visits],value:peak.visits}],
          label:{formatter:`${formatter.format(peak.visits)} 次`,position:'top',color:'#17283e',fontWeight:700} } : undefined }],
    }, true);
    requestAnimationFrame(() => visitChart?.resize());
  } else {
    timeline.textContent = '图表资源暂时无法加载。每日数字可在访问明细中查看。';
    $('#chart-peak-note').textContent = '';
  }
  const regions = $('#regions');
  regions.replaceChildren();
  if (!snapshot.regions.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '当前没有地区数据。';
    regions.append(empty);
  }
  for (const item of snapshot.regions.slice(0, 6)) {
    const row = document.createElement('div');
    row.className = 'region';
    const name = document.createElement('span');
    name.textContent = names.regionSummary(item.name);
    const number = document.createElement('b');
    number.textContent = formatter.format(item.visits);
    const line = document.createElement('i');
    line.style.setProperty('--width', `${item.visits / snapshot.regions[0].visits * 100}%`);
    row.append(name, number, line);
    regions.append(row);
  }
  renderRows();
}

async function load() {
  if (location.protocol === 'file:') {
    $('#login-error').textContent = '这是本地页面预览。登录和真实统计需在配置数据库并上线后使用。';
    return;
  }
  const current = ++requestId;
  statsController?.abort();
  statsController = new AbortController();
  status.className = 'data-status';
  status.textContent = snapshot ? '正在刷新数据…' : '正在读取访问记录…';
  $('#refresh').disabled = true;
  try {
    const response = await fetch(`/api/admin/stats?days=${range.value}&domain=${encodeURIComponent(domain.value)}`, {
      credentials: 'same-origin', cache: 'no-store', signal: statsController.signal,
    });
    if (current !== requestId) return;
    if (response.status === 401) {
      snapshot = null;
      showDashboard(false);
      $('#login-error').textContent = '登录已过期，请重新输入密码。';
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取失败');
    snapshot = data;
    visibleIps = data.ips;
    $('#ip-backfill').disabled = !data.ipApiBackfillEnabled;
    if (!data.ipApiBackfillEnabled) $('#ip-backfill-status').textContent = '历史回填未启用；Cloudflare 实时标注可正常使用。';
    for (const option of range.options) option.disabled = Number(option.value) > data.retentionDays;
    showDashboard(true);
    render();
    if (ipType !== 'all') void applyIpFilter();
    if (activeView === 'requests') window.PyyRequestAudit?.load();
    if (activeView === 'archive') window.PyyRequestAudit?.loadLegacy();
    status.textContent = `已更新 · ${domain.selectedOptions[0].textContent} · ${snapshot.rangeDays === 1 ? '本 UTC 日' : `近 ${snapshot.rangeDays} 天`} · 刷新于 ${formatTime(snapshot.refreshedAt)} · 记录最多保留 ${snapshot.retentionDays} 天`;
  } catch (error) {
    if (current !== requestId || error.name === 'AbortError') return;
    const session = await fetch('/api/admin/session', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
    if (current !== requestId) return;
    if (session?.status === 204) {
      showDashboard(true);
      if (activeView === 'requests') window.PyyRequestAudit?.load();
      if (activeView === 'archive') window.PyyRequestAudit?.loadLegacy();
    } else if (!loginView.hidden) {
      $('#login-error').textContent = error.message || '后台暂时不可用。';
    }
    status.className = 'data-status error';
    status.textContent = session?.status === 204
      ? '访问统计暂时不可用；下方请求审计仍可查看。'
      : (error.message || '读取失败，请重试。');
  } finally {
    if (current === requestId) $('#refresh').disabled = false;
  }
}

async function applyIpFilter() {
  const current = ++filterId;
  const data = snapshot;
  if (!data) return;
  if (ipType === 'all') { visibleIps = data.ips; renderRows(); return; }
  visibleIps = [];
  $('#ip-rows').replaceChildren();
  $('#ip-count').textContent = '正在筛选缓存中的 IP…';
  try {
    const response = await fetch('/api/admin/ip-filter',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:ipType,ips:data.ips.map(row=>row.ip)}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '筛选失败');
    if (current !== filterId || snapshot !== data) return;
    const selected = new Set(result.ips);
    visibleIps = data.ips.filter(row=>selected.has(row.ip));
    renderRows();
  } catch(error) {
    if (current === filterId) $('#ip-count').textContent = error.message || '筛选失败，请重试。';
  }
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#password');
  const error = $('#login-error');
  const button = $('#login-submit');
  error.textContent = '';
  if (!input.value) {
    error.textContent = '请输入管理员密码。';
    input.focus();
    return;
  }
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input.value }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || '登录失败，请重试。');
    }
    input.value = '';
    showDashboard(true);
    await load();
  } catch (failure) {
    error.textContent = failure.message || '登录失败，请重试。';
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
});

$('#reveal').addEventListener('click', () => {
  const input = $('#password');
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  $('#reveal').textContent = visible ? '隐藏' : '显示';
  $('#reveal').setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
  input.focus();
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    const response = await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('退出失败');
    snapshot = null;
    requestId += 1;
    statsController?.abort();
    window.PyyRequestAudit?.reset();
    window.PyyAdminClicks?.reset();
    showDashboard(false);
  } catch {
    status.className = 'data-status error';
    status.textContent = '退出失败，请重试。';
  } finally { logoutButton.disabled = false; }
});

range.addEventListener('change', () => { closeDetail(); page = 1; if(activeView==='clicks'){window.PyyAdminClicks?.reset();window.PyyAdminClicks?.load();} load(); });
domain.addEventListener('change', () => { closeDetail(); page = 1; search.value = ''; $('#search-clear').hidden = true; if(activeView==='clicks'){window.PyyAdminClicks?.reset();window.PyyAdminClicks?.load();} load(); });
$('#refresh').addEventListener('click', () => { closeDetail(); if(activeView==='clicks')window.PyyAdminClicks?.load(); load(); });
for (const button of document.querySelectorAll('[data-ip-type]')) button.addEventListener('click', () => {
  if (ipType === button.dataset.ipType) return;
  ipType = button.dataset.ipType;
  for (const chip of document.querySelectorAll('[data-ip-type]'))
    chip.setAttribute('aria-pressed',String(chip === button));
  closeDetail(); page = 1; void applyIpFilter();
});
$('#ip-backfill').addEventListener('click', async () => {
  const button = $('#ip-backfill');
  const progress = $('#ip-backfill-status');
  button.disabled = true;
  progress.textContent = '正在查询下一批 IP…';
  try {
    const response = await fetch('/api/admin/ip-backfill', {
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(backfillCursor || {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '回填失败');
    backfillCursor = result.done ? null : {day:result.nextDay,afterIp:result.afterIp};
    try {
      if (backfillCursor) localStorage.setItem('pyy-ip-backfill-cursor',JSON.stringify(backfillCursor));
      else localStorage.removeItem('pyy-ip-backfill-cursor');
    } catch {}
    progress.textContent = `${result.day}：扫描 ${result.scanned} 个去重 IP，查询 ${result.queried} 个，写入 ${result.written} 个。${result.done ? '已完成。' : '可点击继续下一批。'}`;
    if (result.written) load();
  } catch (error) { progress.textContent = error.message || '回填失败，请重试。'; }
  finally { button.disabled = false; }
});
search.addEventListener('input', () => {
  closeDetail();
  $('#search-clear').hidden = !search.value;
  page = 1;
  renderRows();
});
$('#search-clear').addEventListener('click', () => {
  search.value = '';
  $('#search-clear').hidden = true;
  closeDetail();
  page = 1;
  renderRows();
  search.focus();
});
$('#previous').addEventListener('click', () => { closeDetail(); page -= 1; renderRows(); });
$('#next').addEventListener('click', () => { closeDetail(); page += 1; renderRows(); });
$('#ip-page-size').addEventListener('change',()=>{closeDetail();page=1;renderRows();});
$('#ip-jump-go').addEventListener('click',()=>{
  const target=Number($('#ip-jump').value),max=Number($('#ip-jump').max);
  if(!Number.isSafeInteger(target)||target<1||target>max){$('#ip-count').textContent=`请输入 1 到 ${max} 的页码。`;return;}
  closeDetail();page=target;renderRows();
});
$('#ip-jump').addEventListener('keydown',event=>{if(event.key==='Enter')$('#ip-jump-go').click();});
$('#detail-close').addEventListener('click', () => closeDetail(true));
$('#detail-retry').addEventListener('click', () => loadDetail(detailRequestedPage));
$('#detail-previous').addEventListener('click', () => loadDetail(detailPage - 1, true));
$('#detail-next').addEventListener('click', () => loadDetail(detailPage + 1, true));
for (const button of document.querySelectorAll('.admin-nav [data-view]'))
  button.addEventListener('click', () => selectView(button.dataset.view));
for (const button of document.querySelectorAll('#chart-range [data-days]'))
  button.addEventListener('click', () => { range.value = button.dataset.days; range.dispatchEvent(new Event('change')); });
window.addEventListener('resize', () => visitChart?.resize());
selectView('overview');
load();
