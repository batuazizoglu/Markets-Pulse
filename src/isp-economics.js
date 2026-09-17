export function parseAmount(value) {
  if(value==null||value==='')return null;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  let s=String(value).trim().replace(/[^\d.,-]/g,'');
  if(!/\d/.test(s))return null;
  // Both separators: rightmost is decimal. A single group of three is thousands.
  if(s.includes('.')&&s.includes(',')){
    const decimal=s.lastIndexOf('.')>s.lastIndexOf(',')?'.':',';
    s=s.replace(decimal==='.'?/,/g:/\./g,'').replace(decimal,'.');
  }else if(/^\d{1,3}([.,]\d{3})+$/.test(s)){s=s.replace(/[.,]/g,'')}
  else {s=s.replace(',','.')}
  const n=Number(s);return Number.isFinite(n)?n:null;
}
const positive=x=>x!=null&&Number(x)>0?Number(x):null;
const round=x=>x!=null&&Number.isFinite(x)?Math.round(x*100)/100:null;
export function normalizeOffer(base={}) {
  const duration=positive(base.duration_months),days=positive(base.duration_days);
  const bonus=Math.max(0,Number(base.bonus_months)||0),bonusDays=Math.max(0,Number(base.bonus_days)||0);
  const service=days?(days+bonusDays)/30:duration?duration+bonus:null;
  const paid=days?days/30:duration;
  const stated=positive(base.price_monthly_try);
  const total=positive(base.total_price_try)??(stated&&paid?stated*paid:null);
  const effective=total&&service?total/service:stated;
  const monthly=stated??(total&&paid?total/paid:null);
  const speed=positive(base.speed_down_mbps);
  return {...base,product_family:base.product_family||'fixed',market_segment:base.market_segment||'residential',
    brand:base.brand||base.provider||null,price_status:effective?'published':base.price_status||'not_published',
    duration_months:duration,bonus_months:bonus,duration_days:days,bonus_days:bonusDays,
    service_months:round(service),price_monthly_try:round(monthly),total_price_try:round(total),
    effective_monthly_try:round(effective),first_year_equiv_try:effective?round(effective*12):null,
    mbps_per_100tl:speed&&effective?Math.round(speed/effective*100000)/1000:null,
    product_key:base.product_key||[base.source_slug,base.technology,base.name,days?'d'+days:duration,days?bonusDays:bonus].join('|')
  };
}
