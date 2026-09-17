import * as cheerio from 'cheerio';
import {parseAmount as n} from './isp-economics.js';

const clean=v=>String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
function document(html){
  const $=cheerio.load(html);
  $('script,style,noscript,svg,header,footer,nav').remove();
  $('br').replaceWith(' ');$('td,th,li,p,h1,h2,h3,h4,h5,h6').append(' ');
  return $;
}
function base(source,row){
  return {source_slug:source.slug,provider:source.provider,brand:source.provider,
    ownership_group:source.ownership_group,company_ids:source.company_ids,source_url:source.url,product_url:source.url,
    technology:source.technology,product_family:'fixed',market_segment:source.market_segment||'residential',
    speed_down_mbps:null,speed_up_mbps:null,unlimited:null,data_limit_gb:null,
    duration_months:null,install_fee_try:null,features:[],...row};
}
// Read JSON literals only. Never execute JavaScript supplied by a monitored site.
export function jsonLiteral(text,start){
  let depth=0,quote=false,escape=false;
  for(let i=start;i<text.length;i++){
    const ch=text[i];
    if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')quote=false;continue}
    if(ch==='"'){quote=true;continue}
    if(ch==='{'||ch==='[')depth++;
    if(ch==='}'||ch===']'){depth--;if(!depth)return JSON.parse(text.slice(start,i+1))}
  }
  throw new Error('Eksik paket JSON verisi');
}
export function parseNetonline(html,source){
  const datasets=[];
  for(const m of html.matchAll(/(?:const|let|var)\s+(?:o_services|a_all_services|a_wdsl_hizmet|a_adsl_hizmet|a_vdsl_hizmet)\s*=\s*/g)){
    const at=m.index+m[0].length,tail=html.slice(at);
    if(tail.startsWith('JSON.parse(')){
      const literal=tail.match(/^JSON\.parse\('((?:\\.|[^'\\])*)'\)/);
      if(literal)datasets.push(JSON.parse(literal[1].replace(/\\'/g,"'")));
    }else if(/^[{[]/.test(tail))datasets.push(jsonLiteral(html,at));
  }
  const out=[],seen=new Set();
  function walk(value,parent={},type='',depth=0){
    if(depth>8||!value||typeof value!=='object')return;
    if(Array.isArray(value)){for(const x of value)walk(x,parent,type,depth+1);return}
    if(value.a_packages){for(const x of value.a_packages)walk(x,value,value.s_service_type_ask?.[0]||type,depth+1);return}
    if(value.i_internet_service_id!=null&&value.i_internet_service_price!=null){
      const id=String(value.i_internet_service_id);if(seen.has(id))return;seen.add(id);
      const name=clean(value.srvname||value.s_internet_service_name||parent.s_cat_desc||value.s_cat_desc);
      const tech=String(value.s_type_service||type||source.technology).replace(/_/g,' ').toUpperCase();
      const day=Number(value.i_rms_day_type)===1||/Gün/i.test(value.s_time_without_campaign||value.s_month_without_campaign||'');
      const duration=n(value.i_time_without_campaign??value.i_month_without_campaign);
      const bonus=n(value.i_time_without_campaign_diff??value.i_month_without_campaign_diff)||0;
      const description=parent.j_desc?.o_data?.map(x=>x.s_text).join(' ')||parent.s_desc||'';
      const raw=clean([name,value.s_radio_label,value.s_internet_service_price_description,value.s_label_notice_for_application_dropdown,description].join(' '));
      const install=raw.match(/kurulum\s*(?:bedeli|ücreti)?\s*:\s*([\d.,]+)/i);
      const displayed=clean(value.a_special_options?.s_speed_desc||value.s_speed_desc||'');
      const internalSpeed=n(value.i_speed??parent.i_speed);
      const speed=n(displayed.match(/(\d+(?:[.,]\d+)?)\s*(?:Mbps|Mbit)/i)?.[1])||internalSpeed;
      const options=Array.isArray(value.a_service_options)?value.a_service_options.filter(x=>typeof x==='string'):[];
      if(!name||!(n(value.i_internet_service_price)>0)||!(duration>0))return;
      out.push(base(source,{name,technology:tech,speed_down_mbps:speed,unlimited:options.some(x=>/Sınırsız|Limitsiz|Kotasız/i.test(x))?true:null,
        speed_up_mbps:n((raw.match(/upload\s*h[ıi]z[ıi]\s*(\d+(?:[.,]\d+)?)/i)||[])[1]),
        duration_months:day?null:duration,duration_days:day?duration:null,bonus_months:day?0:bonus,bonus_days:day?bonus:0,
        total_price_try:n(value.i_internet_service_price),install_fee_try:install?n(install[1]):null,
        features:[...options,clean(value.s_internet_service_price_description),displayed,internalSpeed!==speed?'Kaynak hız açıklaması esas alındı':null,day?'Gün bazlı paket; aylık eşdeğer 30 gün üzerinden hesaplanır':null].filter(Boolean),
        raw_text:raw,product_key:source.slug+'|'+id}));
      return;
    }
    for(const [k,v] of Object.entries(value))if(v&&typeof v==='object')walk(v,parent,/^(?:wdsl|adsl|vdsl|fiber|wdsl_plus)$/.test(k)?k:type,depth+1);
  }
  datasets.forEach(d=>walk(d));return out;
}
function haypem(html,source){
  const $=document(html),out=[];
  $('.card').each((_,card)=>{
    const h=clean($(card).find('h3').first().text()),section=clean($(card).closest('section').find('h2').first().text());
    const speed=n((h.match(/(\d+)\s*(?:Mbps|$)/i)||[])[1]);if(!speed)return;
    const technology=/fiber/i.test(section)?'Fiber':/vdsl/i.test(section)?'VDSL':/adsl/i.test(section)?'ADSL':/apartman/i.test(section)?'Apartman WDSL':/plus/i.test(section)?'WDSL Plus':'WDSL';
    const name=technology+' '+h,raw=clean($(card).text()),rows=[];
    for(const m of raw.matchAll(/(\d+)\s*(?:\+\s*(\d+))?\s*Ay\s*[–—-]\s*([\d.,]+)\s*₺/gi))
      rows.push(base(source,{name,technology,speed_down_mbps:speed,duration_months:Number(m[1]),bonus_months:Number(m[2]||0),total_price_try:n(m[3]),raw_text:raw,unlimited:true,features:['KDV dahil','Kablo/modem koşulları kaynakta belirtilir']}));
    if(!rows.length&&/iletişime|Teklif al/i.test(raw))rows.push(base(source,{name,technology,speed_down_mbps:speed,price_status:'quote',raw_text:raw}));
    out.push(...rows);
  });return out;
}
function tables(html,source){
  const $=document(html),out=[];
  $('table').each((ti,table)=>{
    const headers=$(table).find('tr').first().find('td,th').map((_,x)=>clean($(x).text())).get();
    const terms=headers.map(t=>{const m=t.match(/(\d+)\s*(?:\+\s*(\d+)\s*)?(?:ay|month)/i);return m?{d:Number(m[1]),b:Number(m[2]||0)}:null});
    let tech=source.technology;
    if(source.slug==='enson-adsl'||source.parser==='analiz')tech=ti===0?'ADSL':'VDSL';
    $(table).find('tr').each((_,tr)=>{
      const cells=$(tr).find('td').map((__,td)=>clean($(td).text())).get();
      const speed=n((cells[0]?.match(/(\d+(?:[.,]\d+)?)\s*(?:Mbit|Mbps|Mb)/i)||[])[1]);
      if(!speed)return;
      for(let i=1;i<cells.length;i++){
        const t=terms[i],price=n(cells[i]);if(!t||!(price>0))continue;
        out.push(base(source,{name:tech+' '+speed+' Mbps',technology:tech,speed_down_mbps:speed,
          duration_months:t.d,bonus_months:t.b,total_price_try:price,raw_text:cells.join(' | '),
          features:source.parser==='enson'?['Adil kullanım ve aktivasyon koşullarını kontrol edin']:[]}));
      }
    });
  });return out;
}
function surface(html,source){
  const $=document(html),out=[];
  $('table tr').each((_,tr)=>{
    const cells=$(tr).find('td').map((__,td)=>clean($(td).text())).get();
    const speed=n(($(tr).attr('onclick')||'').match(/'(\d+)mbps'/i)?.[1]);
    const term=cells[0]?.match(/(\d+)\s*months?(?:\s*\+\s*(\d+))?/i),price=n(cells[1]);
    if(!speed||!term||!(price>0))return;
    out.push(base(source,{name:'WDSL '+speed+' Mbps',technology:'WDSL',speed_down_mbps:speed,
      duration_months:Number(term[1]),bonus_months:Number(term[2]||0),total_price_try:price,raw_text:cells.join(' | ')}));
  });return out;
}
function primenet(html,source){
  const $=document(html),out=[];
  $('.w-pricing-item').each((_,el)=>{
    const raw=clean($(el).text()),title=clean($(el).find('.w-pricing-item-title').text()),speed=n(raw.match(/(\d+)\s*MBit/i)?.[1]);
    if(!speed)return;const tech=/ADSL/i.test(title)?'ADSL':'WDSL',name=tech==='ADSL'?'ADSL '+speed+' Mbps':title;
    for(const m of raw.matchAll(/([\d.,]+)\s*₺\s*\/\s*(\d+)\s*Aylık(?:\s*\+\s*(\d+)\s*Ay Hediye)?/gi))
      out.push(base(source,{name,technology:tech,speed_down_mbps:speed,speed_up_mbps:n(raw.match(/(\d+)\s*MBIT UPLOAD/i)?.[1]),
        duration_months:Number(m[2]),bonus_months:Number(m[3]||0),total_price_try:n(m[1]),install_fee_try:/Ücretsiz Kurulum/i.test(raw)?0:null,unlimited:/Kotasız/.test(raw)?true:null,raw_text:raw}));
  });return out;
}
function royalnet(html,source){
  const $=document(html),text=clean($.root().text()),out=[];
  const re=/(\d+)\s*Mbit\s+((?:[\d.,]+\s*₺\s*\d+\s*(?:\+\s*\d+\s*)?AY\s*)+)\s*\d+\s*Mbit\s*İnd[İi]rme\s*(\d+)\s*Mbit/gi;
  for(const m of text.matchAll(re))for(const p of m[2].matchAll(/([\d.,]+)\s*₺\s*(\d+)\s*(?:\+\s*(\d+)\s*)?AY/gi))
    out.push(base(source,{name:'WDSL '+m[1]+' Mbps',technology:'WDSL',speed_down_mbps:Number(m[1]),speed_up_mbps:Number(m[3]),unlimited:true,
      duration_months:Number(p[2]),bonus_months:Number(p[3]||0),total_price_try:n(p[1]),raw_text:m[0]}));
  return out;
}
function goldsurf(html,source){
  const $=document(html),text=clean($.root().text()),out=[];
  for(const name of ['Premium','Gold']){
    const start=text.indexOf(name+' 12 Ay'),end=text.indexOf('Kapat',start);
    if(start<0||end<start)continue;const raw=text.slice(start,end);
    const annual=raw.match(/12 Ay\s*\+\s*(\d+)\s*Ay[\s\S]*?₺\s*([\d.,]+)/i);
    if(annual)out.push(base(source,{name,technology:'WDSL',duration_months:12,bonus_months:Number(annual[1]),total_price_try:n(annual[2]),raw_text:raw}));
    for(const p of raw.matchAll(/(\d+)\s*Aylık\s+([\d.,]+)\s*TL/gi))out.push(base(source,{name,technology:'WDSL',duration_months:Number(p[1]),total_price_try:n(p[2]),raw_text:raw}));
  }
  for(const m of text.matchAll(/(\d+)\s*Mbit\s+12 Ay\s*₺\s*([\d.,]+)/gi))out.push(base(source,{name:'ADSL '+m[1]+' Mbps',technology:'ADSL',speed_down_mbps:Number(m[1]),duration_months:12,total_price_try:n(m[2]),raw_text:m[0]}));
  return out;
}
export function parseServices(html,source){
  const $=document(html),out=[],seen=new Set();
  $('h1,h2,h3,h4').each((_,h)=>{
    const name=clean($(h).text());
    if(name.length>75||!/^(?:WDSL|ADSL|VDSL|Fiber(?:NET)?|Apartman|Kurumsal|İnternet Hizmetleri|VPN|Network|Uzak Mesafe)/i.test(name)||/Neden|Fiyat|Paketlerimiz/i.test(name)||seen.has(name))return;
    seen.add(name);const raw=clean($(h).parent().text()).slice(0,900);
    out.push(base(source,{name,technology:(name.match(/WDSL|ADSL|VDSL|Fiber/i)||[])[0]||source.technology,
      price_status:/teklif|iletişim|bilgi al/i.test(raw)?'quote':'not_published',raw_text:raw,features:['Fiyat yayımlanmıyor; kaynaktan teyit gerekli']}));
  });
  return out;
}
export function parseISP(html,source){
  const parser={netonline:parseNetonline,haypem,surface,primenet,royalnet,goldsurf,enson:tables,analiz:tables,'isp-table':tables,services:parseServices};
  const rows=(parser[source.parser]||(()=>[]))(html,source);
  return [...new Map(rows.map(r=>[r.product_key||[r.source_slug,r.technology,r.name,r.duration_months,r.duration_days,r.bonus_months,r.bonus_days].join('|'),r])).values()];
}
export function socialLinks(html,url){
  const $=cheerio.load(html),out=[];
  $('a[href]').each((_,a)=>{
    try{const u=new URL($(a).attr('href'),url),host=u.hostname.replace(/^www\.|^m\./g,'');
      const platform=host==='facebook.com'?'facebook':host==='instagram.com'?'instagram':null;
      if(platform&&!/\/(?:sharer|share|login|dialog|ads|p\/?$)/i.test(u.pathname)&&u.pathname.length>1&&!out.some(x=>x.url===u.href))
        out.push({platform,url:u.href});
    }catch{}
  });return out.slice(0,12);
}
