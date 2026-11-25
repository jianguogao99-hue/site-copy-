import { authenticated, configured, privateHeaders, sameOrigin } from '../_lib/visitor-store.js';
import { archiveRecentVisits } from '../_lib/visit-archive.js';

export default async function handler(req, res) {
  privateHeaders(res);
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).end();
  if (!configured() || !req.auditDb) return res.status(503).json({ error: '后台数据库尚未连接' });
  const cronSecret = process.env.CRON_SECRET || '';
  const scheduled = req.method === 'GET' && cronSecret.length >= 16 &&
    req.headers.authorization === `Bearer ${cronSecret}`;
  const manual = req.method === 'POST' && authenticated(req) && sameOrigin(req);
  if (!scheduled && !manual) return res.status(401).end();
  try {
    const result = await archiveRecentVisits(req.auditDb);
    console.info('Daily visit archive completed', result);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Daily visit archive failed', error);
    return res.status(503).json({ error: '归档暂时失败，请稍后重试' });
  }
}
