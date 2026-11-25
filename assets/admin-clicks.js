(() => {
  const $ = selector => document.querySelector(selector);
  const names = window.PyyAdminNames;
  const fmt = new Intl.NumberFormat('zh-CN');
  const node = (tag, name, value) => { const element = document.createElement(tag);
    element.className = name; element.textContent = value; return element; };
  let offset = 0;
  let contactOffset = 0;
  let controller;
  let loadSeq = 0;
  const pageSize = () => Number($('#click-page-size').value);
  const contactPageSize = () => Number($('#contact-page-size').value);
  const contactNames = {'contact:wechat':'微信','contact:tg':'TG 联系卡片','contact:twitter':'推特',
    'contact:tg-channel':'TG 频道','contact:tg-direct':'TG 私信'};
  async function load() {
    const seq = ++loadSeq;
    controller?.abort(); controller = new AbortController();
    $('#click-status').textContent = '正在读取点击记录…';
    $('#click-total').textContent = '…';
    $('#click-ips').textContent = '…';
    $('#no-click-ips').textContent = '…';
    $('#contact-wechat-clicks').textContent = '…';
    $('#contact-tg-clicks').textContent = '…';
    $('#contact-twitter-clicks').textContent = '…';
    try {
      const params = new URLSearchParams({days:$('#range').value,domain:$('#domain').value,offset:String(offset),
        limit:String(pageSize()),contactOffset:String(contactOffset),contactLimit:String(contactPageSize()),
        hideTests:$('#click-hide-tests').checked ? '1' : '0'});
      const response = await fetch(`/api/admin/clicks?${params}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      const data = await response.json();
      if (seq !== loadSeq) return;
      if (!response.ok) throw new Error(data.error || '点击记录读取失败');
      if (data.total > 0 && offset >= data.total) { offset = Math.floor((data.total-1)/pageSize())*pageSize(); return void load(); }
      if (data.contactTotal > 0 && contactOffset >= data.contactTotal) {
        contactOffset = Math.floor((data.contactTotal-1)/contactPageSize())*contactPageSize(); return void load();
      }
      $('#click-total').textContent = fmt.format(data.total);
      $('#click-ips').textContent = fmt.format(data.clickedIps);
      $('#no-click-ips').textContent = fmt.format(data.noClickIps);
      $('#contact-wechat-clicks').textContent = fmt.format(data.contactClicks.wechat);
      $('#contact-tg-clicks').textContent = fmt.format(data.contactClicks.tg);
      $('#contact-twitter-clicks').textContent = fmt.format(data.contactClicks.twitter);
      const contactList = $('#contact-rows'); contactList.replaceChildren();
      for (const item of data.contactRecords || []) {
        const row = node('li','click-row','');
        const summary = node('div','click-row-main','');
        const contact = node('strong','',contactNames[item.link] || item.label || item.link);
        if (item.isTest) contact.append(node('span','click-test-badge','测试点击'));
        summary.append(node('time','',names.beijingTime(item.time)),contact,
          node('code','click-ip',item.ip || 'IP 未记录'),node('span','click-visible-time',names.locationName(item)),
          node('span','click-signal signal-unknown',item.domain || '未知域名'));
        const detail = document.createElement('details');
        detail.append(node('summary','','查看来源页和地区依据'));
        const body = node('div','click-detail','');
        body.append(node('p','',`站内来源页：${item.page || '未知'}`),
          node('p','',`站点域名：${item.domain || '未知'}`),
          node('p','',`估计地区：${names.locationName(item)}`),
          node('p','',`地区依据：${item.geoSource || '无可用地区'}`));
        detail.append(body); row.append(summary,detail); contactList.append(row);
      }
      if (!contactList.children.length) contactList.append(node('li','request-empty','所选时间内暂无已保存的联系方式点击。'));
      const contactFirst = data.contactTotal ? contactOffset + 1 : 0;
      const contactLast = contactOffset + (data.contactRecords || []).length;
      $('#contact-page-status').textContent = `${fmt.format(contactFirst)}–${fmt.format(contactLast)} / ${fmt.format(data.contactTotal)}`;
      $('#contact-jump').value = String(Math.floor(contactOffset/contactPageSize())+1);
      $('#contact-jump').max = String(Math.max(1,Math.ceil(data.contactTotal/contactPageSize())));
      $('#contact-previous').disabled = contactOffset === 0;
      $('#contact-next').disabled = contactLast >= data.contactTotal;
      $('#click-status').textContent = `所选 ${data.days} 天 · ${fmt.format(data.visitorIps)} 个访问 IP；${data.hideTests ? '已排除确认的测试点击' : '含已标记的测试点击'}。旧记录可能没有目标链接。`;
      const exchangeStats = $('#exchange-click-stats'); exchangeStats.replaceChildren();
      for (const item of data.ranking) {
        if (item.clicks <= 0) continue;
        const card = node('div','stat card','');
        card.append(node('span','',names.exchangeName(item.exchange,item.link)),
          node('strong','',fmt.format(item.clicks)),node('small','','所选日期、域名内的点击次数'));
        exchangeStats.append(card);
      }
      if (!exchangeStats.children.length) exchangeStats.append(node('p','request-empty','所选时间内暂无返佣卡片点击。'));
      const ranking = $('#click-ranking'); ranking.replaceChildren();
      for (const item of data.ranking) {
        const row = node('li','click-rank','');
        row.append(node('span','',names.exchangeName(item.exchange,item.link)),node('strong','',`${fmt.format(item.clicks)} 次`));
        ranking.append(row);
      }
      if (!ranking.children.length) ranking.append(node('li','request-empty','所选时间内暂无返佣卡片点击。'));
      const domains = $('#click-domain-rows'); domains.replaceChildren();
      for (const item of data.byDomain || []) {
        const row = document.createElement('tr');
        row.append(node('td','',item.domain),node('td','',fmt.format(item.clicks)),
          node('td','',fmt.format(item.clickedIps)));
        domains.append(row);
      }
      if (!domains.children.length) {
        const row = document.createElement('tr'); const cell = node('td','','所选日期暂无点击。');
        cell.colSpan=3; row.append(cell); domains.append(row);
      }
      const list = $('#click-rows'); list.replaceChildren();
      for (const item of data.clicks) {
        const row = node('li','click-row','');
        const summary = node('div','click-row-main','');
        const exchange = node('strong','',names.exchangeName(item.exchange,item.link));
        if (item.isTest) exchange.append(node('span','click-test-badge','测试点击'));
        const visibleTime = item.visibleSeconds == null
          ? '停留未记录' : `点击前可见约 ${fmt.format(item.visibleSeconds)} 秒`;
        const signal = item.signal?.label || '未分类';
        summary.append(node('time','',names.beijingTime(item.time)),exchange,
          node('code','click-ip',names.ipLocation(item.ip,item)),
          node('span','click-visible-time',visibleTime),
          node('span',`click-signal ${signal==='疑似自动化'?'signal-alert':signal==='疑似真人'?'signal-human':'signal-unknown'}`,signal));
        const detail = document.createElement('details');
        detail.append(node('summary','','查看来源页与目标链接'));
        const body = node('div','click-detail','');
        body.append(node('p','',`站内来源页：${item.page || '未知'}`),
          node('p','',`站点域名：${item.domain || '未知'}`),
          node('p','',`估计地区：${names.locationName(item)}`),
          node('p','',`地区依据：${item.geoSource || '无可用地区'}`),
          node('p','',`判断线索：${item.signal?.reason || '现有记录不足以判断'}`),
          node('p','',`目标链接：${item.targetUrl || '历史点击未采集，无法补回'}`));
        detail.append(body); row.append(summary,detail); list.append(row);
      }
      if (!list.children.length) list.append(node('li','request-empty','所选时间内暂无返佣卡片点击。'));
      const first = data.total ? offset + 1 : 0;
      const last = offset + data.clicks.length;
      $('#click-page-status').textContent = `${fmt.format(first)}–${fmt.format(last)} / ${fmt.format(data.total)}`;
      $('#click-jump').value = String(Math.floor(offset/pageSize())+1);
      $('#click-jump').max = String(Math.max(1,Math.ceil(data.total/pageSize())));
      $('#click-previous').disabled = offset === 0;
      $('#click-next').disabled = last >= data.total;
    } catch(error) {
      if (seq === loadSeq && error.name !== 'AbortError') $('#click-status').textContent = error.message || '点击记录暂时无法读取。';
    }
  }
  $('#click-previous').addEventListener('click',()=>{offset=Math.max(0,offset-pageSize());void load();});
  $('#click-next').addEventListener('click',()=>{offset+=pageSize();void load();});
  $('#click-page-size').addEventListener('change',()=>{offset=0;void load();});
  $('#click-jump-go').addEventListener('click',()=>{
    const page=Number($('#click-jump').value),max=Number($('#click-jump').max);
    if(!Number.isSafeInteger(page)||page<1||page>max){$('#click-status').textContent=`请输入 1 到 ${max} 的页码。`;return;}
    offset=(page-1)*pageSize();void load();
  });
  $('#click-jump').addEventListener('keydown',event=>{if(event.key==='Enter')$('#click-jump-go').click();});
  $('#contact-previous').addEventListener('click',()=>{contactOffset=Math.max(0,contactOffset-contactPageSize());void load();});
  $('#contact-next').addEventListener('click',()=>{contactOffset+=contactPageSize();void load();});
  $('#contact-page-size').addEventListener('change',()=>{contactOffset=0;void load();});
  $('#contact-jump-go').addEventListener('click',()=>{
    const page=Number($('#contact-jump').value),max=Number($('#contact-jump').max);
    if(!Number.isSafeInteger(page)||page<1||page>max){$('#click-status').textContent=`请输入 1 到 ${max} 的页码。`;return;}
    contactOffset=(page-1)*contactPageSize();void load();
  });
  $('#contact-jump').addEventListener('keydown',event=>{if(event.key==='Enter')$('#contact-jump-go').click();});
  $('#click-hide-tests').addEventListener('change',()=>{offset=0;contactOffset=0;void load();});
  window.PyyAdminClicks = {load,reset(){offset=0;contactOffset=0;loadSeq++;controller?.abort();}};
})();
