import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

const COOKIE = 'pyy_admin_session';
const DAY_MS = 86_400_000;
const SESSION_MS = 12 * 60 * 60 * 1000;
export const DOMAINS = ['example.com'];
export function domainFromHost(value) {
  const host = String(value || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
  return DOMAINS.includes(host) ? host : null;
}
export function requestDomain(req) { return domainFromHost(req.headers.host); }
export function selectedDomain(value) {
  return value === 'all' || value == null || value === '' ? null : domainFromHost(value);
}
const retention = () => Number(process.env.PYY_IP_RETENTION_DAYS);
export function configured() {
  const passwordHash = process.env.PYY_ADMIN_PASSWORD_HASH || '';
  const sessionSecret = process.env.PYY_ADMIN_SESSION_SECRET || '';
  return Boolean(/^[a-f0-9]{32}:[a-f0-9]{64}(?::100000)?$/.test(passwordHash) &&
    Buffer.byteLength(sessionSecret, 'utf8') >= 32 &&
    [7, 30, 90].includes(retention()));
}

export function privateHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
}

export function clientIp(req) {
  // Vercel overwrites X-Forwarded-For at its edge, preventing client-supplied IP spoofing.
  const forwarded = String(req.headers['x-forwarded-for'] || '');
  const candidate = forwarded.split(',')[0].trim();
  return isIP(candidate) ? candidate : null;
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.host === host;
  } catch { return false; }
}

export function dayKey(date, domain = null) {
  return domain ? `pyy:visits:v2:${domain}:${date.toISOString().slice(0, 10)}`
    : `pyy:visits:v1:${date.toISOString().slice(0, 10)}`;
}

function ipDigest(ip) {
  return createHash('sha256').update(ip).digest('hex');
}

export function eventDayKey(date, ip, domain = null) {
  return domain ? `pyy:events:v2:${domain}:${date.toISOString().slice(0, 10)}:${ipDigest(ip)}`
    : `pyy:events:v1:${date.toISOString().slice(0, 10)}:${ipDigest(ip)}`;
}

export function lastViewKey(date, ip, domain = null) {
  return domain ? `pyy:last-view:v2:${domain}:${date.toISOString().slice(0, 10)}:${ipDigest(ip)}`
    : `pyy:last-view:v1:${date.toISOString().slice(0, 10)}:${ipDigest(ip)}`;
}

export function eventSummaryKey(date, ip, domain = null) {
  return domain ? `pyy:event-summary:v2:${domain}:${date.toISOString().slice(0, 10)}:${ipDigest(ip)}`
    : `pyy:event-summary:v1:${date.toISOString().slice(0, 10)}:${ipDigest(ip)}`;
}

export function dayTtlSeconds(now) {
  const nextUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((nextUtcDay - now.getTime()) / 1000) + (retentionDays() - 1) * 86400;
}

export function trackedPage(page) {
  return ['/', '/markets.html', '/privacy.html'].includes(page);
}

export function validViewId(value) {
  return typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
}

export function daysBack(number) {
  const now = Date.now();
  return Array.from({ length: number }, (_, i) => new Date(now - i * DAY_MS));
}

export function geo(req) {
  const clean = (value, size) => String(value || '').slice(0, size).replace(/[|\r\n]/g, '');
  let city = clean(req.headers['x-vercel-ip-city'], 160);
  try { city = decodeURIComponent(city); } catch { /* Retain header text when not URL-encoded. */ }
  return {
    country: clean(req.headers['x-vercel-ip-country'], 2).toUpperCase() || '未知',
    region: clean(req.headers['x-vercel-ip-country-region'], 32),
    city: city.slice(0, 80),
    asn: Number.isSafeInteger(Number(req.cf?.asn)) && Number(req.cf?.asn) > 0 ? Number(req.cf.asn) : null,
    asOrg: String(req.cf?.asOrganization || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160),
  };
}

export async function verifyPassword(value) {
  const [salt, expected, iterationText] = String(process.env.PYY_ADMIN_PASSWORD_HASH || '').split(':');
  if (!salt || !expected || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(expected) ||
      (iterationText && iterationText !== '100000')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(value)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: Buffer.from(salt, 'hex'), iterations: iterationText ? 100000 : 310000, hash: 'SHA-256' }, key, 256);
  return timingSafeEqual(Buffer.from(bits), Buffer.from(expected, 'hex'));
}

function signature(message) {
  return createHmac('sha256', process.env.PYY_ADMIN_SESSION_SECRET).update(message).digest('base64url');
}

export function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MS })).toString('base64url');
  return `${COOKIE}=${payload}.${signature(payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function authenticated(req) {
  const raw = String(req.headers.cookie || '').split(';').map(x => x.trim())
    .find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return false;
  const [payload, given] = raw.split('.');
  if (!payload || !given) return false;
  const expected = signature(payload);
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); }
  catch { return false; }
}

export function retentionDays() { return retention(); }
