import { authenticated, configured, privateHeaders } from '../_lib/visitor-store.js';
import { exportOptions, requestCsv } from '../_lib/request-export.js';

export default async function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'GET') return res.status(405).end();
  if (!configured()) return res.status(503).json({ error: '后台尚未完成配置' });
  if (!authenticated(req)) return res.status(401).json({ error: '请先登录' });
  if (!req.auditDb) return res.status(503).json({ error: '请求日志数据库尚未连接' });
  const options = exportOptions(req.query);
  if (!options) return res.status(400).json({ error: '请选择最近 90 天内的起止日期' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pyy-requests-${options.from}-${options.to}.csv"`);
  try {
    for await (const chunk of requestCsv(options, req.auditDb)) res.write(chunk);
    return res.end();
  } catch (error) {
    console.error('Request CSV export failed:', error?.message);
    return res.end();
  }
}
