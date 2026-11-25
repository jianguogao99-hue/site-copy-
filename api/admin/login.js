import { clientIp, configured, privateHeaders, sameOrigin, sessionCookie, verifyPassword } from '../_lib/visitor-store.js';
import { createHash } from 'node:crypto';

async function bufferedAttempt(req, ip, now) {
  if (!req.visitBuffer) throw new Error('Login rate-limit buffer is not bound');
  const key = `login:${createHash('sha256').update(ip).digest('hex')}`;
  const [raw, d1Attempts] = await Promise.all([
    req.visitBuffer.get(key),
    req.auditDb.prepare('SELECT count,expires_at FROM admin_login_attempts WHERE ip=?').bind(ip)
      .first().catch(() => null),
  ]);
  const prior = raw ? JSON.parse(raw) : null;
  const buffered = prior?.expiresAt > now ? Number(prior.count) || 0 : 0;
  const persisted = d1Attempts?.expires_at > now ? Number(d1Attempts.count) || 0 : 0;
  const attempts = Math.max(buffered, persisted) + 1;
  await req.visitBuffer.put(key, JSON.stringify({count:attempts,expiresAt:now+900000}),
    {expirationTtl:900});
  return {attempts,key};
}

export default async function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'POST') return res.status(405).end();
  if (!configured()) return res.status(503).json({ error: '后台尚未完成配置' });
  if (!req.auditDb) return res.status(503).json({ error: '后台数据库尚未连接' });
  if (!sameOrigin(req)) return res.status(403).end();
  const ip = clientIp(req);
  if (!ip) return res.status(400).end();
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length > 256) return res.status(400).json({ error: '请输入管理员密码' });
  try {
    const now = Date.now();
    let attempts, bufferedKey;
    try {
      attempts = (await req.auditDb.prepare(`INSERT INTO admin_login_attempts(ip,count,expires_at) VALUES(?,1,?)
          ON CONFLICT(ip) DO UPDATE SET
          count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,
          expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END
          RETURNING count`).bind(ip, now + 900000, now, now).first())?.count;
    } catch {
      ({attempts,key:bufferedKey} = await bufferedAttempt(req, ip, now));
    }
    if (Number(attempts) > 8) return res.status(429).json({ error: '尝试次数过多，请 15 分钟后再试' });
    if (!await verifyPassword(password)) {
      return res.status(401).json({ error: '密码不正确' });
    }
    await req.auditDb.prepare('DELETE FROM admin_login_attempts WHERE ip=?').bind(ip).run().catch(() => {});
    if (bufferedKey) await req.visitBuffer.delete(bufferedKey).catch(() => {});
    res.setHeader('Set-Cookie', sessionCookie());
    return res.status(204).end();
  } catch (error) {
    console.error('Admin login failed:', error?.name, error?.message);
    return res.status(503).json({ error: '服务暂时不可用，请稍后重试' });
  }
}
