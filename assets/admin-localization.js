// Display-only names. Unknown codes stay unknown instead of being guessed.
(() => {
  const countries = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
  const countryOverrides = { CN:'中国', HK:'中国香港', MO:'中国澳门', TW:'中国台湾' };
  const cityNames = {
    'shijiazhuang':'石家庄','council bluffs':'康瑟尔布拉夫斯',
    'tokyo':'东京','zhangjiakou':'张家口','boardman':'博德曼',
    'charlotte':'夏洛特','santa clara':'圣克拉拉','zhengzhou':'郑州',
    'ashburn':'阿什本','taiyuan':'太原','new york city':'纽约',
    'beijing':'北京','frankfurt':'法兰克福','frankfurt am main':'法兰克福',
    'ipswich':'伊普斯维奇','dallas':'达拉斯','guangzhou':'广州',
    'hong kong':'香港','san jose':'圣何塞','the dalles':'达尔斯',
    'groningen':'格罗宁根',
    'omaha':'奥马哈','newark':'纽瓦克','taipei':'台北',
    'los angeles':'洛杉矶','buffalo':'布法罗','hillsboro':'希尔斯伯勒',
    'jiaxing':'嘉兴','madrid':'马德里','lille':'里尔',
    'bengaluru':'班加罗尔','anyang-si':'安养','singapore':'新加坡',
    'sydney':'悉尼','shenzhen':'深圳','lanzhou':'兰州',
    'xinyang':'信阳','wuhan':'武汉','nanjing':'南京',
    'qingdao':'青岛','shanghai':'上海','berlin':'柏林',
    'helsinki':'赫尔辛基','strasbourg':'斯特拉斯堡','roubaix':'鲁贝',
    'san tin':'新田','tung chung':'东涌','palermo':'巴勒莫',
    'sanmu':'山武','warsaw':'华沙','bucharest':'布加勒斯特',
    'moscow':'莫斯科','phoenix':'菲尼克斯','san francisco':'旧金山',
    'wilmington':'威尔明顿','chicago':'芝加哥','dayton':'代顿',
    'merritt island':'梅里特岛','lauderdale lakes':'劳德代尔湖',
    'hapeville':'黑普维尔',
    'oklahoma city':'俄克拉荷马城',
    'moncks corner':'蒙克斯科纳','raleigh':'罗利',
    'nanning':'南宁','liuzhou':'柳州','wujiaqu':'五家渠',
    'london':'伦敦','hangzhou':'杭州','paris':'巴黎',
    'east los angeles':'东洛杉矶','johannesburg':'约翰内斯堡',
    'fuzhou':'福州','hohhot':'呼和浩特','xining':'西宁',
    'jinan':'济南','xi’an':'西安','urumqi':'乌鲁木齐',
    'kunming':'昆明','dunkirk':'敦刻尔克',
    'budapest':'布达佩斯','narita':'成田','nagawa':'长和町',
    'seoul':'首尔','kaunas':'考纳斯','amsterdam':'阿姆斯特丹',
    'manila':'马尼拉','gdynia':'格丁尼亚','belgrade':'贝尔格莱德',
    'istanbul':'伊斯坦布尔','sacramento':'萨克拉门托',
    'cape coral':'珊瑚角','marietta':'玛丽埃塔',
    'baltimore':'巴尔的摩','north bergen':'北卑尔根',
    'boydton':'博伊顿','seattle':'西雅图','appleton':'阿普尔顿',
  };
  const regionNames = {
    'JP-13':'东京都','JP-12':'千叶县','CN-HE':'河北省','CN-HA':'河南省',
    'CN-SX':'山西省','CN-BJ':'北京市','CN-GD':'广东省','CN-ZJ':'浙江省',
    'CN-GS':'甘肃省','CN-HB':'湖北省','CN-JS':'江苏省','CN-SD':'山东省',
    'CN-SH':'上海市','US-WA':'华盛顿州','US-VA':'弗吉尼亚州',
    'CN-GX':'广西壮族自治区','CN-FJ':'福建省','CN-NM':'内蒙古自治区',
    'CN-QH':'青海省','CN-SN':'陕西省','CN-XJ':'新疆维吾尔自治区',
    'CN-YN':'云南省',
    'US-GA':'佐治亚州','US-NC':'北卡罗来纳州','US-CA':'加利福尼亚州',
    'US-CO':'科罗拉多州','US-IA':'艾奥瓦州','US-TX':'得克萨斯州',
    'US-NY':'纽约州','US-OR':'俄勒冈州','US-FL':'佛罗里达州',
    'US-OH':'俄亥俄州','US-NJ':'新泽西州','US-IL':'伊利诺伊州',
    'US-AZ':'亚利桑那州','US-MA':'马萨诸塞州','US-OK':'俄克拉荷马州',
    'US-NE':'内布拉斯加州','US-SC':'南卡罗来纳州','US-DE':'特拉华州',
    'BR-SP':'圣保罗州','BR-MG':'米纳斯吉拉斯州','BR-RJ':'里约热内卢州',
    'BR-RS':'南里奥格兰德州','BR-PR':'巴拉那州','BR-BA':'巴伊亚州',
    'BR-SC':'圣卡塔琳娜州','BR-GO':'戈亚斯州','BR-CE':'塞阿拉州',
    'BR-PE':'伯南布哥州','BR-ES':'圣埃斯皮里图州',
    'AR-B':'布宜诺斯艾利斯省','CL-RM':'圣地亚哥首都大区',
    'PK-PB':'旁遮普省','PK-SD':'信德省','CO-DC':'波哥大首都区',
    'CO-ANT':'安蒂奥基亚省','GB-ENG':'英格兰','ZA-GP':'豪登省',
    'ZA-WC':'西开普省','MX-CMX':'墨西哥城','MX-MEX':'墨西哥州',
    'EC-P':'皮钦查省','EC-G':'瓜亚斯省','AE-DU':'迪拜',
    'BE-BRU':'布鲁塞尔首都大区','DE-HE':'黑森州','DE-BE':'柏林',
    'ES-MD':'马德里自治区','FR-HDF':'上法兰西大区',
    'FR-GES':'大东部大区','NL-GR':'格罗宁根省',
    'IN-KA':'卡纳塔克邦','KR-41':'京畿道','AU-NSW':'新南威尔士州',
    'RU-MOW':'莫斯科','RO-B':'布加勒斯特',
  };
  const exchanges = {
    binance:'Binance',bitget:'Bitget',okx:'OKX',gate:'Gate',
    bybit:'Bybit',deepcoin:'DeepCoin',weex:'WEEX',ibit:'iBit',
  };
  const clean = value => String(value || '').trim();
  const latinKey = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function countryName(value) {
    const raw = clean(value);
    if (!raw || raw === '未知') return '未知地区';
    if (/[\u3400-\u9fff]/.test(raw)) return raw;
    const code = raw.toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return '未知地区';
    const name = countryOverrides[code] || countries.of(code);
    return name && name !== code ? name : '未知地区';
  }
  function regionName(country, region) {
    const raw = clean(region);
    if (!raw || raw === '未知' || raw === '地区未知') return '';
    if (/[\u3400-\u9fff]/.test(raw)) return raw;
    return regionNames[`${clean(country).toUpperCase()}-${raw.toUpperCase()}`] || '';
  }
  function locationName({ country, region, city } = {}) {
    const nation = countryName(country);
    if (nation === '未知地区') return nation;
    const originalCity = clean(city);
    const cityName = /[\u3400-\u9fff]/.test(originalCity) ? originalCity : cityNames[latinKey(originalCity)];
    // Cloudflare can supply a real city that our Chinese-name table has not seen yet.
    // Keep that city visible in its original spelling instead of discarding it.
    return `${nation} · ${cityName || originalCity || regionName(country, region) || '未知地区'}`;
  }
  function ipLocation(ip, geo) { return `${clean(ip) || 'IP 未知'}（${locationName(geo)}）`; }
  function regionSummary(value) {
    const [country, region] = clean(value).split(/\s*·\s*/,2);
    return locationName({country,region});
  }
  function exchangeName(label, link) {
    const key = clean(link).replace(/^exchange:/,'').replace(/-$/,'').toLowerCase() ||
      latinKey(label).split(/[^a-z]/,1)[0];
    const name = exchanges[key];
    if (name) return name;
    const raw = clean(label);
    return raw.match(/^[A-Za-z][A-Za-z0-9.+-]*/)?.[0] || '未知交易所';
  }
  const beijingClock = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',
    day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  function beijingTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '时间未知' : beijingClock.format(date);
  }
  window.PyyAdminNames = { countryName, regionName, locationName, ipLocation, regionSummary, exchangeName, beijingTime };
})();
