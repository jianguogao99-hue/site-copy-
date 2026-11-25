export const REQUEST_DOMAINS = ['example.com'];
export const REQUEST_PAGE_SIZE = 25;
export const RAW_DAYS = 90;

const PAGES = new Set(['/', '/index.html', '/markets.html', '/privacy.html', '/admin', '/admin.html']);
const ASSETS = /\.(?:css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|map|txt|xml|pdf)$/i;
const SUSPICIOUS = /(?:^|\/)(?:\.env(?:\.|\/|$)|\.git(?:\/|$)|\.aws(?:\/|$)|\.svn(?:\/|$)|wp-[^/]*|[^/]*\.php(?:\/|$)|admin(?:\/|\.|$)|login(?:\/|\.|$)|config(?:[._/-]|$))/i;

export function requestType(path, contentType = '', status = 0) {
  if (path.startsWith('/api/')) return 'api';
  if (PAGES.has(path)) return 'normal_page';
  if (suspiciousPath(path)) return 'homepage_fallback';
  if (status === 200 && /^text\/html\b/i.test(contentType)) return 'homepage_fallback';
  if (path.startsWith('/assets/') || ASSETS.test(path)) return 'static_asset';
  return 'homepage_fallback';
}

export function suspiciousPath(path) { return SUSPICIOUS.test(path); }

export function statusGroup(status, type) {
  if (status >= 500) return '5xx';
  if (status === 403) return '403';
  if (status === 404) return '404';
  if (type === 'homepage_fallback' && status === 200) return 'homepage_fallback';
  if (status === 200) return '200';
  return 'other';
}

export function refererPage(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.origin}${url.pathname}`.slice(0, 1024);
  } catch { return ''; }
}

export function refererSource(value) {
  if (!value) return '直接访问 / 未提供';
  try { return new URL(value).hostname.toLowerCase() || '其他来源'; }
  catch { return '其他来源'; }
}

export function requestDay(value) { return new Date(value).toISOString().slice(0, 10); }
export function logKey(domain, day, suspicious = false) {
  return `pyy:request-log:v1:${suspicious ? 'suspect:' : ''}${domain}:${day}`;
}
export function dailyKey(domain, day) { return `pyy:request-daily:v1:${domain}:${day}`; }
export function topKey(kind, domain, day) { return `pyy:request-top:v1:${kind}:${domain}:${day}`; }
export function ipFirstKey(domain, day) { return `pyy:request-ip-first:v1:${domain}:${day}`; }
export function ipLastKey(domain, day) { return `pyy:request-ip-last:v1:${domain}:${day}`; }
export function ipPathKey(domain, day, ip) { return `pyy:request-ip-path:v1:${domain}:${day}:${ip}`; }
export function minuteKey(domain, day) { return `pyy:request-minute:v1:${domain}:${day}`; }
export function burstKey(domain, day) { return `pyy:request-burst:v1:${domain}:${day}`; }

export function selectedDays(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      !Number.isFinite(start) || !Number.isFinite(end) ||
      new Date(start).toISOString().slice(0, 10) !== from ||
      new Date(end).toISOString().slice(0, 10) !== to ||
      end < start || end > Date.now() || Date.now() - start >= RAW_DAYS * 86400000 ||
      end - start >= RAW_DAYS * 86400000) return null;
  const days = [];
  for (let time = end; time >= start; time -= 86400000) days.push(new Date(time).toISOString().slice(0, 10));
  return days;
}

export function requestDaysFromQuery(query) {
  if (query.from || query.to) {
    if (typeof query.from !== 'string' || typeof query.to !== 'string') return null;
    return selectedDays(query.from, query.to);
  }
  const count = Number(query.days || 1);
  if (![1, 7, 30, 90].includes(count)) return null;
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.now() - index * 86400000).toISOString().slice(0, 10));
}
