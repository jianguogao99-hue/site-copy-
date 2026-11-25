import { domainFromHost } from './visitor-store.js';
import { requestDaysFromQuery } from './request-audit.js';

const HEADERS = ['时间 (UTC)', '域名', '访客 IP', '国家', '地区', '方法', '路径', '状态', '命中类型', '可疑路径', 'ASN', '网络名称', 'User-Agent 原文', 'Referer 来源页'];

export function exportOptions(query) {
  const requestedDomain = String(query.domain || 'all');
  const domain = requestedDomain === 'all' ? 'all' : domainFromHost(requestedDomain);
  const days = requestDaysFromQuery(query);
  if (!domain || !days || !query.from || !query.to) return null;
  return { domain, days, from: days.at(-1), to: days[0] };
}

function csvField(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
const csvRow = values => `${values.map(csvField).join(',')}\r\n`;

export async function* requestCsv({ domain, days }, db) {
  yield '\uFEFF' + csvRow(HEADERS);
  for (const day of days) {
    let offset = 0;
    for (;;) {
      const rows = await db.prepare(`SELECT ts,domain,ip,country,region,method,path,status,type,suspicious,asn,as_organization,user_agent,referer FROM request_events WHERE day=?${domain === 'all' ? '' : ' AND domain=?'} ORDER BY ts DESC LIMIT 500 OFFSET ?`)
        .bind(day, ...(domain === 'all' ? [] : [domain]), offset).all();
      const batch = rows.results || [];
      if (!batch.length) break;
      let chunk = '';
      for (const item of batch) {
        chunk += csvRow([
          new Date(item.ts).toISOString(), item.domain, item.ip, item.country, item.region,
          item.method, item.path, item.status, item.type, item.suspicious ? '是' : '否',
          item.asn, item.as_organization, item.user_agent, item.referer,
        ]);
      }
      yield chunk;
      offset += batch.length;
      if (batch.length < 500) break;
    }
  }
}
