export async function archiveRecentVisits(db, now = new Date()) {
  if (!db) throw new Error('Visit database is not bound');
  const date = now.toISOString().slice(0,10);
  const result = await db.prepare(`INSERT INTO visit_archive_daily(day,domain,visits)
    SELECT day,domain,SUM(visits) FROM visit_daily_ip WHERE day < ? GROUP BY day,domain
    ON CONFLICT(day,domain) DO UPDATE SET visits=excluded.visits`).bind(date).run();
  return { through: new Date(Date.parse(`${date}T00:00:00Z`)-86400000).toISOString().slice(0,10),
    rowsWritten: result.meta?.changes || 0 };
}
