// Add providers here: [case-insensitive organization/ISP keyword, display name].
export const PROVIDERS = [
  [/amazon|\baws\b/i, 'AWS'], [/google cloud|google llc/i, 'Google Cloud'],
  [/microsoft|azure/i, 'Azure'], [/tencent|腾讯云/i, '腾讯云'],
  [/alibaba|aliyun|阿里云/i, '阿里云'], [/huawei cloud|华为云/i, '华为云'],
  [/oracle cloud/i, 'Oracle Cloud'], [/digitalocean/i, 'DigitalOcean'],
  [/linode|akamai connected cloud/i, 'Linode'], [/vultr|choopa/i, 'Vultr'],
  [/\bovh\b/i, 'OVH'], [/hetzner/i, 'Hetzner'], [/contabo/i, 'Contabo'],
  [/leaseweb/i, 'LeaseWeb'], [/\bm247\b/i, 'M247'], [/datacamp/i, 'DataCamp'],
  [/cloudflare/i, 'Cloudflare'], [/kamatera/i, 'Kamatera'], [/upcloud/i, 'UpCloud'],
  [/hostinger/i, 'Hostinger'], [/godaddy/i, 'GoDaddy'], [/namecheap/i, 'Namecheap'],
  [/psychz/i, 'Psychz'], [/colocrossing/i, 'ColoCrossing'], [/racknerd/i, 'RackNerd'],
  [/buyvm|frantech/i, 'BuyVM'], [/g[ -]?core/i, 'G-Core'], [/selectel/i, 'Selectel'],
  [/time4vps/i, 'Time4VPS'], [/worldstream/i, 'WorldStream'], [/interserver/i, 'InterServer'],
  [/a2 hosting/i, 'A2 Hosting'], [/dreamhost/i, 'DreamHost'], [/bluehost/i, 'Bluehost'],
  [/\bionos\b/i, 'IONOS'], [/\bstrato\b/i, 'Strato'], [/scaleway/i, 'Scaleway'],
  [/\bv\.ps\b/i, 'V.PS'], [/misaka/i, 'Misaka'], [/bandwagon|\bit7\b/i, 'Bandwagon'],
  [/\bdmit\b/i, 'DMIT'], [/cloudcone/i, 'CloudCone'], [/akile/i, 'Akile'],
  [/vollcloud/i, 'VollCloud'],
  [/\bkidc\b|\bikuuu\b/i, 'IKUUU'],
];

const CARRIERS = [
  [/chinanet|china telecom|中国电信/i, '中国电信'],
  [/china unicom|中国联通/i, '中国联通'],
  [/china mobile|中国移动/i, '中国移动'],
  [/comcast/i, 'Comcast'], [/at&t|\batt\b/i, 'AT&T'], [/verizon/i, 'Verizon'],
  [/\bbt\b|british telecom/i, 'BT'], [/deutsche telekom/i, 'Deutsche Telekom'],
];
const CARRIER_ASNS = new Map([[4134, '中国电信'], [4837, '中国联通'], [17621, '中国联通'],
  [9808, '中国移动'], [56048, '中国移动']]);
// ASN names in offline datasets can differ from the public cloud brand.
const HOSTING_ASNS = new Map([[31898, 'Oracle Cloud'], [20473, 'Vultr']]);
const HOSTING = /cloud|hosting|host|data[ -]?cent(?:er|re)|vps|server|dedicated|colocation|\bcolo\b|cloud-platform/i;
const ACCESS = /broadband|fiber|fibre|cable|telecom|communications|internet service|residential|mobile|wireless/i;

export function classifyIpInfo({ asn, org, isp, asname, as, hosting } = {}) {
  const name = [org, isp, asname, as].filter(Boolean).join(' ');
  const provider = PROVIDERS.find(([pattern]) => pattern.test(name))?.[1];
  if (provider) return { isDatacenter: 1, provider };
  const number = Number(asn) || Number(String(as || '').match(/\bAS(\d+)\b/i)?.[1]);
  const hostingProvider = HOSTING_ASNS.get(number);
  if (hostingProvider) return { isDatacenter: 1, provider: hostingProvider };
  if (hosting === true || HOSTING.test(name)) {
    const display = String(org || isp || asname || '').trim().slice(0, 40) || '未识别服务商';
    return { isDatacenter: 1, provider: display };
  }
  const carrier = CARRIER_ASNS.get(number) || CARRIERS.find(([pattern]) => pattern.test(name))?.[1];
  if (carrier) return { isDatacenter: 0, provider: carrier };
  // Orange and NTT have both access and cloud networks; without a specific signal, leave them unknown.
  if (/\borange\b|\bntt\b/i.test(name)) return { isDatacenter: -1, provider: '' };
  if (ACCESS.test(name)) return { isDatacenter: 0, provider: String(isp || org || asname).trim().slice(0, 40) };
  return { isDatacenter: -1, provider: '' };
}
