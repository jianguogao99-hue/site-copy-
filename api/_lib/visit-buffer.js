const keyFor = event => `visit:${event.time.slice(0,10)}:${event.id}`;

export async function bufferVisitEvent(kv,event) {
  if(!kv) throw new Error('Visit buffer is not bound');
  await kv.put(keyFor(event),JSON.stringify(event),{expirationTtl:3*86400});
}

export async function bufferedVisitEvents(kv,max=300) {
  if(!kv) return [];
  const found=[];
  let cursor;
  do {
    const page=await kv.list({prefix:'visit:',limit:Math.min(500,max-found.length),...(cursor?{cursor}:{})});
    for(const key of page.keys) {
      const raw=await kv.get(key.name);
      if(!raw) continue;
      try {found.push(JSON.parse(raw));} catch { /* Preserve malformed entries for inspection. */ }
    }
    cursor=page.list_complete?null:page.cursor;
  } while(cursor&&found.length<max);
  return found;
}

export async function replayBufferedVisits(db,kv,max=500) {
  if(!db||!kv) return {replayed:0,remaining:0};
  const {writeVisitEvent}=await import('./visit-db.js');
  let replayed=0,cursor;
  do {
    const page=await kv.list({prefix:'visit:',limit:Math.min(500,max-replayed),...(cursor?{cursor}:{})});
    for(const key of page.keys) {
      const raw=await kv.get(key.name);
      if(!raw) continue;
      const event=JSON.parse(raw);
      await writeVisitEvent(db,event);
      await kv.delete(key.name);
      replayed++;
      if(replayed>=max) break;
    }
    cursor=page.list_complete?null:page.cursor;
  } while(cursor&&replayed<max);
  return {replayed,moreMayRemain:Boolean(cursor)};
}
