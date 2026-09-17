import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import {parseAmount as n, normalizeOffer as offer} from './isp-economics.js';
import {parseISP, socialLinks} from './isp-parsers.js';
import {ISP_SCOPE, ISP_COMPANIES, EXTRA_HOME_SOURCES, LEGACY_COMPANIES, companyCoverage, socialDirectory} from './isp-registry.js';
const PARSER_VERSION='home-isp-2';

const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Safari/537.36';

const LEGACY_SOURCES=[
  {slug:'kktcell-home',provider:'Turkcell Ev İnterneti',name:'Kuzey Kıbrıs Turkcell Ev İnterneti',url:'https://www.kktcell.com/internet-paketleri?type=turkcell-ev-interneti',technology:'Ev İnterneti',ownership_group:'Kuzey Kıbrıs Turkcell',parser:'kktcell'},
  {slug:'kktcell-superbox',provider:'KKTCELL',name:'Kuzey Kıbrıs Turkcell Superbox',url:'https://www.kktcell.com/internet-paketleri?type=superbox',technology:'4.5G FWA',ownership_group:'Kuzey Kıbrıs Turkcell',parser:'kktcell-superbox'},
  {slug:'lifecell-digital-home',provider:'Turkcell Ev İnterneti',name:'Lifecell Digital Ev İnterneti',url:'https://www.lifecelldigital.com/paketler?altyapi=1&cat=other',technology:'WDSL / Fiber / Sabit Genişbant',ownership_group:'Lifecell Digital Ltd.',parser:'lifecell-dynamic'},
  {slug:'lifecell-digital-superbox',provider:'KKTCELL',name:'Lifecell Digital Superbox',url:'https://www.lifecelldigital.com/paketler?altyapi=2',technology:'4.5G FWA',ownership_group:'Lifecell Digital Ltd.',parser:'lifecell-superbox-dynamic'},
  {slug:'extend-wdsl',provider:'Extend',name:'Extend WDSL',url:'https://www.extendbroadband.com/urunler-wdsl.php',technology:'WDSL',ownership_group:'Arınet Security & Internet Consultancy Ltd.',parser:'extend-table'},
  {slug:'extend-fiber',provider:'Extend',name:'Extend FiberNET',url:'https://www.extendbroadband.com/urunler-fibernet.php',technology:'Fiber',ownership_group:'Arınet Security & Internet Consultancy Ltd.',parser:'extend-table'},
  {slug:'telsim-home',provider:'Telsim',name:'Vodafone Evde İnternet',url:'https://www.kktctelsim.com/tr/internet/evde-internet-ve-red-box/vodafone-evde-internet',technology:'WDSL / ADSL',ownership_group:'KKTC Telsim',parser:'telsim-home'},
  {slug:'telsim-redbox',provider:'Telsim',name:'Telsim Red Box',url:'https://www.kktctelsim.com/tr/internet/evde-internet-ve-red-box/red-box',technology:'5G FWA',ownership_group:'KKTC Telsim',parser:'redbox'},
  {slug:'freenet-home',provider:'FreeNet',name:'FreeNet Ev İnterneti',url:'https://freenetcyp.com/',technology:'WDSL',ownership_group:'FreeNet',parser:'freenet'},
  {slug:'fixnet-home',provider:'FixNet',name:'FixNet Broadband',url:'https://www.fixnetbroadband.com/',technology:'WDSL / Fiber',ownership_group:'FixNet Broadband',parser:'fixnet'},
  {slug:'towernet-home',provider:'Towernet',name:'Towernet Ev İnterneti',url:'https://towernet.net/paketler/',technology:'WDSL / ADSL',ownership_group:'Towernet',parser:'towernet'},
  {slug:'nethouse-home',provider:'Nethouse',name:'Nethouse Bireysel',url:'https://nethouse.net/tr/',technology:'WDSL / ADSL / VDSL / Fiber',ownership_group:'Netonline Bilişim Şti. Ltd.',parser:'netonline'},
  {slug:'multimax-home',provider:'Multimax',name:'Multimax Bireysel',url:'https://www.mmcyp.com/hizmetler',fetch_url:'https://www.mmcyp.com/?page=customer&action=hizmetler',technology:'WDSL / Fiber / Apartman',ownership_group:'Netonline Bilişim Şti. Ltd.',parser:'netonline'}
];

export const HOME_INTERNET_SOURCES=[
  ...LEGACY_SOURCES.map(s=>({...s,company_ids:LEGACY_COMPANIES[s.slug]||[]})),
  ...EXTRA_HOME_SOURCES
];

const TRACK_FIELDS=[
  ['speed_down_mbps','Download Hızı','high'],
  ['speed_up_mbps','Upload Hızı','high'],
  ['effective_monthly_try','Efektif Aylık Ücret','high'],
  ['price_monthly_try','Aylık Ücret','high'],
  ['total_price_try','Toplam Ücret','high'],
  ['duration_months','Taahhüt / Ödeme Süresi','medium'],
  ['bonus_months','Hediye Ay','medium'],
  ['duration_days','Ödeme Süresi (gün)','medium'],
  ['bonus_days','Hediye Gün','medium'],
  ['price_status','Fiyat Durumu','medium'],
  ['install_fee_try','Kurulum Ücreti','medium'],
  ['unlimited','Limitsiz','high'],
  ['data_limit_gb','Kota','high'],
  ['technology','Teknoloji','medium']
];

function clean(v){return String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim()}
function keyPart(v){return clean(v).toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü]+/gi,'-').replace(/^-|-$/g,'')}
function round(v,d=2){if(v==null||!Number.isFinite(Number(v)))return null;const p=10**d;return Math.round(Number(v)*p)/p}

function parseKktcell(html,source){
  const $=cheerio.load(html);$('script,style,noscript,svg').remove();
  const superboxOnly=source.parser==='kktcell-superbox';
  const out=[],seen=new Set();
  $('a').each((_,el)=>{
    const raw=clean($(el).text());
    if(!raw||raw.length<12||raw.length>1200)return;
    if(superboxOnly){if(!/Superbox/i.test(raw))return}else if(!/Life(?: Extra)?\b|Dedike WiFi|Ev İnterneti|WiFi|GNÇ|Kıdemli|Oyuncu|Premium/i.test(raw)||/Superbox/i.test(raw))return;
    const priceM=raw.match(/(\d[\d.]*(?:,\d+)?)\s*TL\s*\/\s*AY/i)||raw.match(/(\d[\d.]*(?:,\d+)?)\s*TL\b/i);
    if(!priceM)return;
    let name=raw.split(/(?=\d+(?:[.,]\d+)?\s*(?:MBPS|GB|INTERNET))/i)[0].trim();
    name=name.replace(/^(Yeni|Popüler)\s+/i,'').replace(/\s+Faturalı$/i,'').trim();
    if(!name||name.length>140)return;
    const speedM=raw.match(/(\d+(?:[.,]\d+)?)\s*MBPS\b/i);
    if(!/Superbox/i.test(raw)&&!speedM)return;
    const dataM=!speedM?raw.match(/(\d+(?:[.,]\d+)?)\s*GB\b/i):null;
    const durM=raw.match(/(\d+)\s*Aylık Abonelik/i);
    const annual=/YILLIK ABONELİK/i.test(raw);
    const isSuperbox=superboxOnly||/Superbox/i.test(raw);
    const technology=isSuperbox?'4.5G FWA':(/Dedike WiFi|Life|WiFi|GNÇ|Kıdemli|Oyuncu|Premium/i.test(raw)?'Sabit Genişbant':'Ev İnterneti');
    const row=offer({
      source_slug:source.slug,provider:isSuperbox?'KKTCELL':'Turkcell Ev İnterneti',brand:isSuperbox?'Superbox':'Turkcell Ev İnterneti',product_family:isSuperbox?'fwa':'fixed',ownership_group:source.ownership_group,source_url:source.url,
      product_url:$(el).attr('href')||null,name,technology,
      speed_down_mbps:speedM?n(speedM[1]):null,speed_up_mbps:null,
      data_limit_gb:dataM?n(dataM[1]):null,unlimited:/Sınırsız/i.test(raw),
      duration_months:durM?Number(durM[1]):annual?12:1,bonus_months:0,
      price_monthly_try:n(priceM[1]),install_fee_try:null,
      features:[/TV\+ HEDİYE/i.test(raw)?'TV+ Hediye':null,/kurulum beklemeden/i.test(raw)?'Kurulumsuz hızlı başlangıç':null].filter(Boolean),
      raw_text:raw
    });
    const k=row.product_key;if(!seen.has(k)){seen.add(k);out.push(row)}
  });
  return out;
}

function parseExtendTable(html,source){
  const $=cheerio.load(html);const out=[];
  $('table tr').each((_,tr)=>{
    const cells=$(tr).find('td').map((__,td)=>clean($(td).text())).get();
    if(cells.length<3)return;
    const sm=cells[0].match(/(\d+(?:[.,]\d+)?)\s*(?:Mbit|Mb)/i);if(!sm)return;
    const speed=n(sm[1]);
    const technology=/fiber/i.test(source.slug)?'Fiber':'WDSL';
    const name=clean(cells[0]).replace(/\s*[-–]?\s*Unlimited/i,'')||technology+' '+speed+' Mbps';
    const terms=/fiber/i.test(source.slug)
      ? [{d:1,b:0,i:1},{d:3,b:0,i:2},{d:6,b:0,i:3},{d:12,b:2,i:4}]
      : [{d:1,b:0,i:1},{d:3,b:0,i:2},{d:6,b:1,i:3},{d:12,b:3,i:4}];
    for(const t of terms){
      if(cells[t.i]==null)continue;const total=n(cells[t.i]);if(total==null)continue;
      out.push(offer({
        source_slug:source.slug,provider:source.provider,brand:source.provider,product_family:'fixed',ownership_group:source.ownership_group,source_url:source.url,
        name:(technology==='Fiber'?'FiberNET ':'WDSL ')+speed+' Mbps',technology,
        speed_down_mbps:speed,speed_up_mbps:null,data_limit_gb:null,unlimited:true,
        duration_months:t.d,bonus_months:t.b,total_price_try:total,
        install_fee_try:(technology==='WDSL'&&t.d<=3)?790:0,
        features:technology==='WDSL'?['AKK yok','Ücretsiz aktivasyon','Statik IP']:['Limitsiz','KDV dahil'],
        raw_text:cells.join(' | '),
        product_key:[source.slug,speed,t.d,t.b].join('|')
      }));
    }
  });
  return out;
}

function parseLifecellDigital(html,source){
  const $=cheerio.load(html);$('script,style,noscript,svg').remove();const text=clean($.root().text());
  const out=[],re=/(GNÇ'lilere Özel 20|Merkezi 10|Merkezi 20|Merkezi 30|Standart Paket 10|Aile Paketi 20|Pro Paket 30|Oyuncu Paketi 10)\s+(\d+)Mbps'e kadar\s+([\s\S]{0,100}?)(?=(?:GNÇ'lilere Özel 20|Merkezi 10|Merkezi 20|Merkezi 30|Standart Paket 10|Aile Paketi 20|Pro Paket 30|Oyuncu Paketi 10|Paket Türü|ÜCRETSİZ KURULUM|$))/ig;
  for(const m of text.matchAll(re)){
    const name=clean(m[1]),speed=n(m[2]),seg=clean(m[3]);
    const pairs=[...seg.matchAll(/(1|4|12|14)\s*Ay\s+([\d.,]+)\s*TL(?:\/Ay)?/ig)];
    if(pairs.length){
      for(const p of pairs){const duration=Number(p[1]),price=n(p[2]);out.push(offer({
        source_slug:source.slug,provider:source.provider,ownership_group:source.ownership_group,source_url:source.url,
        name,technology:'WDSL / Sabit Genişbant',speed_down_mbps:speed,speed_up_mbps:null,data_limit_gb:null,unlimited:true,
        duration_months:duration,bonus_months:0,total_price_try:/TL\/Ay/i.test(p[0])?null:price,price_monthly_try:/TL\/Ay/i.test(p[0])?price:null,
        install_fee_try:duration===12?0:null,features:[duration===12?'12 ay kontratta ücretsiz kurulum':null].filter(Boolean),
        raw_text:(name+' '+speed+'Mbps '+seg).slice(0,700),product_key:[source.slug,keyPart(name),speed,duration].join('|')
      }))}
    }else{
      const d=seg.match(/(12)\s*Ay/i),p=seg.match(/([\d.,]+)\s*TL\/Ay/i);
      if(d&&p)out.push(offer({
        source_slug:source.slug,provider:source.provider,ownership_group:source.ownership_group,source_url:source.url,
        name,technology:'WDSL / Sabit Genişbant',speed_down_mbps:speed,speed_up_mbps:null,data_limit_gb:null,unlimited:true,
        duration_months:Number(d[1]),bonus_months:0,price_monthly_try:n(p[1]),install_fee_try:0,
        features:['12 ay kontratta ücretsiz kurulum'],raw_text:(name+' '+speed+'Mbps '+seg).slice(0,700),
        product_key:[source.slug,keyPart(name),speed,12].join('|')
      }));
    }
  }
  const uniq=new Map();for(const x of out)if(!uniq.has(x.product_key))uniq.set(x.product_key,x);return [...uniq.values()];
}

function parseTelsimHome(html,source){
  const $=cheerio.load(html);$('script,style,noscript,svg').remove();
  const text=clean($.root().text());
  const hits=[...text.matchAll(/Evde\s+(\d+)\b/ig)];
  const out=[];
  for(let i=0;i<hits.length;i++){
    const start=hits[i].index||0,end=i+1<hits.length?(hits[i+1].index||text.length):text.length;
    const seg=text.slice(Math.max(0,start-90),Math.min(text.length,end));
    const speed=n(hits[i][1]);if(!speed)continue;
    const type=/Tarifeye Ek/i.test(seg)?'Tarifeye Ek':/Peşin/i.test(seg)?'Peşin':'Evde İnternet';
    const dm=seg.match(/(1|3|6|12)\s*Ay\s*(?:Peşin|Sözünüze|Paket)?/i)||seg.match(/(1|3|6|12)\s*Ay/i);
    const duration=dm?Number(dm[1]):1;
    const bm=seg.match(/\+\s*(\d+)\s*Ay\s*Hediye/i);const bonus=bm?Number(bm[1]):0;
    const pm=seg.match(/₺\s*(\d[\d.]*)\s*\/\s*ay/i);
    const tm=!pm?seg.match(/₺\s*(\d[\d.]*)/i):null;
    const price=pm?n(pm[1]):null,total=tm?n(tm[1]):null;
    if(price==null&&total==null)continue;
    const tech=/ADSL/i.test(seg)?'ADSL':'WDSL';
    out.push(offer({
      source_slug:source.slug,provider:source.provider,brand:source.provider,product_family:'fixed',ownership_group:source.ownership_group,source_url:source.url,
      name:type+' Evde '+speed,technology:tech,speed_down_mbps:speed,speed_up_mbps:null,data_limit_gb:null,unlimited:true,
      duration_months:duration,bonus_months:bonus,price_monthly_try:price,total_price_try:total,
      install_fee_try:/Kurulum Ücretsiz/i.test(seg)?0:null,
      features:[type,/Kurulum Ücretsiz/i.test(seg)?'Kurulum ücretsiz':null,bonus?bonus+' ay hediye':null].filter(Boolean),
      raw_text:seg.slice(0,700),product_key:[source.slug,type,speed,duration,bonus].join('|')
    }));
  }
  const uniq=new Map();for(const x of out)if(!uniq.has(x.product_key))uniq.set(x.product_key,x);return [...uniq.values()];
}

function parseRedBox(html,source){
  const $=cheerio.load(html);$('script,style,noscript,svg').remove();const text=clean($.root().text());
  const out=[];
  const blocks=[...text.matchAll(/Red Box\s*(?:5G)?[\s\S]{0,650}?(?=(?:Red Box\s*(?:5G)?|Detayları Göster|Hemen Başvur|$))/ig)];
  const list=blocks.length?blocks.map(x=>x[0]):[text];
  for(const raw0 of list){
    const raw=clean(raw0);
    if(!/Red Box/i.test(raw))continue;
    const durationM=raw.match(/(12|24)\s*Ay/i);const duration=durationM?Number(durationM[1]):24;
    const first=raw.match(/₺?\s*(\d[\d.]*)\s*\/\s*ilk\s*12\s*ay/i);
    const second=raw.match(/son\s*12\s*ay\s*(\d[\d.]*)\s*TL/i);
    const simple=raw.match(/₺?\s*(\d[\d.]*)\s*\/\s*ay/i);
    let total=null,monthly=null;
    if(first&&second){total=n(first[1])*12+n(second[1])*12}
    else if(simple)monthly=n(simple[1]);
    if(total==null&&monthly==null)continue;
    out.push(offer({
      source_slug:source.slug,provider:'Telsim',brand:'Red Box',product_family:'fwa',ownership_group:source.ownership_group,source_url:source.url,
      name:/5G/i.test(raw)?'Red Box 5G':'Red Box',technology:/5G/i.test(raw)?'5G FWA':'FWA',
      speed_down_mbps:null,speed_up_mbps:null,data_limit_gb:null,unlimited:/sabit internet|limitsiz|sınırsız/i.test(raw),
      duration_months:duration,bonus_months:0,total_price_try:total,price_monthly_try:monthly,install_fee_try:null,
      features:[/sim kart girişlidir/i.test(raw)?'SIM kartlı':null,/sabit internet/i.test(raw)?'Sabit internet':null,first&&second?('İlk 12 ay '+first[1]+' TL • Son 12 ay '+second[1]+' TL'):null].filter(Boolean),
      raw_text:raw.slice(0,900),product_key:[source.slug,/5G/i.test(raw)?'5g':'std',duration].join('|')
    }));
  }
  const uniq=new Map();for(const x of out)if(!uniq.has(x.product_key))uniq.set(x.product_key,x);return [...uniq.values()];
}

function parseFreeNet(html,source){
  const $=cheerio.load(html);$('script,style,noscript,svg').remove();const text=clean($.root().text());
  const defs=[
    {label:'Freenet Lite',speed:5},{label:'Freenet Standart',speed:10},{label:'Freenet Platinum',speed:15},
    {label:'Freenet Premium Plus 20',speed:20},{label:'Freenet Premium Plus 30',speed:30}
  ];
  const out=[];
  for(let i=0;i<defs.length;i++){
    const d=defs[i],start=text.indexOf(d.label);if(start<0)continue;
    const next=defs.slice(i+1).map(x=>text.indexOf(x.label,start+1)).filter(x=>x>start).sort((a,b)=>a-b)[0]||Math.min(text.length,start+1200);
    const seg=text.slice(start,next);
    const terms=[
      {d:1,b:0,re:/([\d.,]+)₺\s*1\s*Aylık/i},
      {d:3,b:0,re:/([\d.,]+)₺\s*3\s*Aylık/i},
      {d:6,b:/6\s*Aylık\s*\+1\s*Ay\s*Hediye/i.test(seg)?1:0,re:/([\d.,]+)₺\s*6\s*Aylık/i},
      {d:12,b:/12\s*Aylık\s*\+2\s*Ay\s*Hediye/i.test(seg)?2:0,re:/([\d.,]+)₺\s*12\s*Aylık/i}
    ];
    for(const t of terms){const m=seg.match(t.re);if(!m)continue;out.push(offer({
      source_slug:source.slug,provider:source.provider,brand:source.provider,product_family:'fixed',ownership_group:source.ownership_group,source_url:source.url,
      name:d.label,technology:'WDSL',speed_down_mbps:d.speed,speed_up_mbps:null,data_limit_gb:null,unlimited:true,
      duration_months:t.d,bonus_months:t.b,total_price_try:n(m[1]),install_fee_try:null,
      features:['Sınırsız','Statik IP / VPN avantajı'],raw_text:seg.slice(0,600),
      product_key:[source.slug,keyPart(d.label),t.d,t.b].join('|')
    }))}
  }
  return out;
}

function parseFixNet(html,source){
  const $=cheerio.load(html);$('script,style,noscript,svg').remove();const out=[];
  $('h3').each((_,el)=>{
    const name=clean($(el).text());if(!name||!/Flex|Exclusive|Gamer|Streamer|İş/i.test(name))return;
    let node=$(el),raw=name;
    for(let i=0;i<5;i++){node=node.parent();const t=clean(node.text());if(t.length>=80&&t.length<=1600){raw=t;if(/Mbps|Mbit/i.test(t)&&/₺/i.test(t))break}}
    const dm=raw.match(/(\d+)\s*Mbit(?:'e kadar|\s*Sabit|\b)/i)||raw.match(/(\d+)\s*Mbps\s*İndirme/i);
    const um=raw.match(/(\d+)\s*Mbps\s*Yükleme/i);
    const priceM=raw.match(/([\d.,]+)₺/i);if(!dm||!priceM)return;
    const durationM=raw.match(/(\d+)\s*Ay\s*Paket/i);const duration=durationM?Number(durationM[1]):1;
    const bonusM=raw.match(/\+\s*(\d+)\s*AY\s*HEDİYE/i);const bonus=bonusM?Number(bonusM[1]):0;
    out.push(offer({
      source_slug:source.slug,provider:source.provider,brand:source.provider,product_family:'fixed',ownership_group:source.ownership_group,source_url:source.url,
      name,technology:'WDSL / Fiber',speed_down_mbps:n(dm[1]),speed_up_mbps:um?n(um[1]):null,data_limit_gb:null,unlimited:/Limitsiz|Kotasız/i.test(raw),
      duration_months:duration,bonus_months:bonus,total_price_try:n(priceM[1]),install_fee_try:null,
      features:[/Sabit Hız Garantisi/i.test(raw)?'Sabit hız garantisi':null,/Düşük Ping/i.test(raw)?'Düşük ping':null,/Yüksek Upload/i.test(raw)?'Yüksek upload':null].filter(Boolean),
      raw_text:raw.slice(0,900),product_key:[source.slug,keyPart(name),duration,bonus].join('|')
    }));
  });
  const uniq=new Map();for(const x of out)if(!uniq.has(x.product_key))uniq.set(x.product_key,x);return [...uniq.values()];
}

function parseTowernet(html,source){
  const $=cheerio.load(html);$('script,style,noscript,svg').remove();
  const text=clean($.root().text());
  const adslAt=text.search(/A\s*D\s*S\s*L.*P\s*a\s*k\s*e\s*t/i);
  const matches=[...text.matchAll(/(\d+)\s*M\s*B\s*[Iİıi]\s*T\s*(\d[\d.]*)\s*\/\s*aylık/ig)];
  const out=[];
  for(let i=0;i<matches.length;i++){
    const m=matches[i],start=m.index||0,end=i+1<matches.length?(matches[i+1].index||text.length):text.length;
    const seg=text.slice(start,end);
    const speed=n(m[1]),monthly=n(m[2]);if(!speed||!monthly)continue;
    const technology=(adslAt>=0&&start>adslAt)?'ADSL':'WDSL';
    const terms=[];
    const one=seg.match(/1\s*Aylık\s*(\d[\d.]*)\s*₺/i);if(one)terms.push({d:1,b:0,total:n(one[1])});
    const three=seg.match(/3\s*Aylık\s*(\d[\d.]*)\s*₺/i);if(three)terms.push({d:3,b:0,total:n(three[1])});
    const six=seg.match(/6\s*Aylık\s*(\d[\d.]*)\s*₺/i);if(six)terms.push({d:6,b:0,total:n(six[1])});
    const year=seg.match(/(?:1\s*Yıllık|12\s*\+\s*3\s*AY)\s*(\d[\d.]*)\s*₺(?:\s*\+\s*(\d+)\s*Ay)?/i);
    if(year)terms.push({d:12,b:year[2]?Number(year[2]):(/12\s*\+\s*3\s*AY/i.test(seg)?3:2),total:n(year[1])});
    if(!terms.length)terms.push({d:1,b:0,total:monthly});
    for(const t of terms)out.push(offer({
      source_slug:source.slug,provider:source.provider,brand:source.provider,product_family:'fixed',ownership_group:source.ownership_group,source_url:source.url,
      name:'Towernet '+speed+' Mbps',technology,speed_down_mbps:speed,speed_up_mbps:null,data_limit_gb:null,unlimited:true,
      duration_months:t.d,bonus_months:t.b,total_price_try:t.total,
      install_fee_try:technology==='WDSL'?null:0,features:['Limitsiz'],raw_text:seg.slice(0,500),
      product_key:[source.slug,technology,speed,t.d,t.b].join('|')
    }));
  }
  return out;
}

function discoveryMeta(html,source){
  const $=cheerio.load(html);$('script,style,noscript,svg').remove();const text=clean($.root().text());
  const tech=['WDSL','ADSL','VDSL','Fiber'].filter(t=>new RegExp(t,'i').test(text));
  return {
    technologies:tech,
    address_quote:/Fiber Hız Sorgulama|adresinize sunabileceğimiz|adres.*hız/i.test(text),
    online_application:/Hemen Başvur|Başvur/i.test(text),
    pricing_visible:/\d[\d.]*\s*TL/i.test(text),
    notes:/kurulum.*modem.*dahil değildir/i.test(text)?'Kurulum/kablo/modem koşulları ayrıca belirtiliyor.':null
  };
}


let lifecellBrowserPromise=null;
async function getLifecellBrowser(){
  if(!lifecellBrowserPromise){
    lifecellBrowserPromise=puppeteer.launch({
      headless:true,
      args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']
    }).catch(e=>{lifecellBrowserPromise=null;throw e});
  }
  return lifecellBrowserPromise;
}
async function wait(ms){return new Promise(r=>setTimeout(r,ms))}

function parseDynamicLifecellVariant(source,variant,isSuperbox=false){
  const raw=clean(variant.card_text);
  const selected=clean(variant.option_text);
  const speedMatch=selected.match(/(\d+(?:[.,]\d+)?)\s*(?:Mbps|Mbit|Mb)\b/i)
    ||raw.match(/(\d+(?:[.,]\d+)?)\s*(?:Mbps|Mbit|Mb)(?:'e kadar)?/i);
  const speed=speedMatch?n(speedMatch[1]):null;
  const dataMatch=selected.match(/(\d+(?:[.,]\d+)?)\s*GB\b/i)||raw.match(/(\d+(?:[.,]\d+)?)\s*GB\b/i);
  const dataLimit=dataMatch?n(dataMatch[1]):null;
  const unlimited=/sınırsız|limitsiz/i.test(raw);
  if(speed==null&&!isSuperbox)return [];

  let name=clean(variant.heading);
  if(!name||name.length<2||/^\d/.test(name)||/^(Mbps|Hız|Seçiniz|Paket)$/i.test(name)){
    const known=raw.match(/(GNÇ[^\d]{0,40}|Merkezi[^\d]{0,30}|Standart Paket[^\d]{0,30}|Aile Paketi[^\d]{0,30}|Pro Paket[^\d]{0,30}|Oyuncu Paketi[^\d]{0,30}|[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü '\-]{2,45}Paket(?:i)?)/i);
    name=known?clean(known[1]):(isSuperbox?'Superbox '+(speed?speed+' Mbps':dataLimit?dataLimit+' GB':unlimited?'Sınırsız':'Paket'):('Lifecell Digital '+speed+' Mbps'));
  }
  name=name.replace(/\s+\d+(?:[.,]\d+)?\s*(?:Mbps|Mbit).*$/i,'').trim();
  if(isSuperbox&&!/Superbox/i.test(name))name='Superbox '+name;

  const technology=isSuperbox?'4.5G FWA':(/fiber/i.test(raw)?'Fiber':(/vdsl/i.test(raw)?'VDSL':(/adsl/i.test(raw)?'ADSL':'WDSL / Sabit Genişbant')));
  const bonusM=raw.match(/\+\s*(\d+)\s*Ay\s*Hediye/i);
  const bonusDefault=bonusM?Number(bonusM[1]):0;
  const freeInstall=/ücretsiz\s+kurulum|kurulum\s+ücretsiz/i.test(raw);

  const rows=[];
  const seenTerms=new Set();

  const monthlyTerms=[...raw.matchAll(/(1|3|4|6|12|14|24)\s*Ay(?:lık|\s+Kontratlı|\s+Paket)?[^₺\d]{0,55}(?:₺\s*)?(\d[\d.]*(?:,\d+)?)\s*(?:TL|₺)\s*\/\s*Ay/ig)];
  for(const m of monthlyTerms){
    const duration=Number(m[1]),price=n(m[2]);
    const key=duration+'|m|'+price;if(seenTerms.has(key))continue;seenTerms.add(key);
    rows.push(offer({
      source_slug:source.slug,provider:isSuperbox?'KKTCELL':'Turkcell Ev İnterneti',brand:isSuperbox?'Superbox':'Turkcell Ev İnterneti',product_family:isSuperbox?'fwa':'fixed',ownership_group:source.ownership_group,source_url:source.url,
      name,technology,speed_down_mbps:speed,speed_up_mbps:null,data_limit_gb:isSuperbox?dataLimit:null,unlimited:isSuperbox?unlimited:!/kota|GB\s*kotalı/i.test(raw),
      duration_months:duration,bonus_months:bonusDefault,price_monthly_try:price,install_fee_try:freeInstall?0:null,
      features:[freeInstall?'Ücretsiz kurulum':null,bonusDefault?bonusDefault+' ay hediye':null,'Hız dropdown fiyatı'].filter(Boolean),
      raw_text:raw.slice(0,1400),
      product_key:[source.slug,keyPart(name),speed,duration,'monthly'].join('|')
    }));
  }

  const totalTerms=[...raw.matchAll(/(1|3|4|6|12|14|24)\s*Ay(?:lık)?[^₺\d]{0,55}(?:₺\s*)?(\d[\d.]*(?:,\d+)?)\s*(?:TL|₺)(?!\s*\/\s*Ay)/ig)];
  for(const m of totalTerms){
    const duration=Number(m[1]),total=n(m[2]);
    const key=duration+'|t|'+total;if(seenTerms.has(key))continue;seenTerms.add(key);
    rows.push(offer({
      source_slug:source.slug,provider:isSuperbox?'KKTCELL':'Turkcell Ev İnterneti',brand:isSuperbox?'Superbox':'Turkcell Ev İnterneti',product_family:isSuperbox?'fwa':'fixed',ownership_group:source.ownership_group,source_url:source.url,
      name,technology,speed_down_mbps:speed,speed_up_mbps:null,data_limit_gb:isSuperbox?dataLimit:null,unlimited:isSuperbox?unlimited:!/kota|GB\s*kotalı/i.test(raw),
      duration_months:duration,bonus_months:bonusDefault,total_price_try:total,install_fee_try:freeInstall?0:null,
      features:[freeInstall?'Ücretsiz kurulum':null,bonusDefault?bonusDefault+' ay hediye':null,'Hız dropdown fiyatı'].filter(Boolean),
      raw_text:raw.slice(0,1400),
      product_key:[source.slug,keyPart(name),speed,duration,'total'].join('|')
    }));
  }

  if(!rows.length){
    const priceM=raw.match(/(?:₺\s*)?(\d[\d.]*(?:,\d+)?)\s*(?:TL|₺)(?:\s*\/\s*Ay)?/i);
    if(priceM){
      const durationM=raw.match(/(1|3|4|6|12|14|24)\s*Ay/i);
      const duration=durationM?Number(durationM[1]):1;
      rows.push(offer({
        source_slug:source.slug,provider:isSuperbox?'KKTCELL':'Turkcell Ev İnterneti',brand:isSuperbox?'Superbox':'Turkcell Ev İnterneti',product_family:isSuperbox?'fwa':'fixed',ownership_group:source.ownership_group,source_url:source.url,
        name,technology,speed_down_mbps:speed,speed_up_mbps:null,data_limit_gb:isSuperbox?dataLimit:null,unlimited:isSuperbox?unlimited:!/kota|GB\s*kotalı/i.test(raw),
        duration_months:duration,bonus_months:bonusDefault,price_monthly_try:n(priceM[1]),install_fee_try:freeInstall?0:null,
        features:[freeInstall?'Ücretsiz kurulum':null,bonusDefault?bonusDefault+' ay hediye':null,'Hız dropdown fiyatı'].filter(Boolean),
        raw_text:raw.slice(0,1400),
        product_key:[source.slug,keyPart(name),speed,duration,'fallback'].join('|')
      }));
    }
  }
  return rows;
}

async function fetchLifecellDynamic(source){
  const isSuperbox=source.parser==='lifecell-superbox-dynamic';
  const t0=Date.now();let page;
  try{
    const browser=await getLifecellBrowser();
    page=await browser.newPage();
    await page.setViewport({width:1440,height:1200,deviceScaleFactor:1});
    await page.setUserAgent(UA);
    await page.goto(source.url,{waitUntil:'networkidle2',timeout:60000});
    await page.evaluate(()=>{
      const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLocaleLowerCase('tr-TR');
      for(const el of document.querySelectorAll('button,a,[role="button"]')){
        const t=norm(el.textContent||el.getAttribute('aria-label'));
        if(/tümünü kabul|hepsini kabul|çerezleri kabul|kabul et|accept all/.test(t)){try{el.click()}catch{}}
      }
    }).catch(()=>{});
    await wait(700);
    await page.evaluate(async()=>{
      let y=0,max=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
      while(y<max){y+=900;window.scrollTo(0,y);await new Promise(r=>setTimeout(r,80));max=Math.max(max,document.body.scrollHeight)}
      window.scrollTo(0,0);
    }).catch(()=>{});
    await wait(800);

    const selectInfo=await page.evaluate(()=>{
      const all=[...document.querySelectorAll('select')];
      const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
      const nearestCard=s=>{
        let el=s;
        for(let i=0;i<8&&el;i++,el=el.parentElement){
          const t=clean(el.innerText);
          if(t.length>=50&&t.length<=3500&&/(TL|₺|Mbps|Mbit)/i.test(t))return el;
        }
        return s.parentElement;
      };
      return all.map((s,idx)=>{
        const card=nearestCard(s);
        return {
          idx,
          id:s.id||null,name:s.name||null,cls:s.className||null,
          options:[...s.options].map(o=>({value:o.value,text:clean(o.textContent),disabled:o.disabled})),
          card_text:clean(card?.innerText||'').slice(0,2500)
        };
      });
    });

    const speedSelects=selectInfo.filter(s=>{
      const opts=s.options.filter(o=>!o.disabled&&String(o.value||'')!=='');
      const speedish=opts.filter(o=>/\b\d+(?:[.,]\d+)?\s*(?:Mbps|Mbit|Mb|GB)\b/i.test(o.text)||/Sınırsız|Limitsiz/i.test(o.text));
      return speedish.length>=1 || (opts.length>=2 && /Mbps|Mbit|GB|hız|kota|sınırsız|limitsiz/i.test(s.card_text));
    });

    const customDiagnostic=await page.evaluate(()=>{
      const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
      const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>5&&r.height>5&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0};
      const selectors='button,[role="combobox"],[aria-haspopup="listbox"],[aria-haspopup="menu"],[class*="dropdown"],[class*="select"],input';
      const all=[...document.querySelectorAll(selectors)].filter(visible);
      const rows=[];
      for(const el of all){
        const text=clean(el.innerText||el.value||el.getAttribute('aria-label')||el.getAttribute('placeholder'));
        let p=el;let context='';
        for(let i=0;i<5&&p;i++,p=p.parentElement){const t=clean(p.innerText);if(t.length>=20&&t.length<=1000){context=t;if(/Mbps|Mbit|hız|paket|TL|₺/i.test(t))break}}
        if(/Mbps|Mbit|hız|paket/i.test(text+' '+context)){
          rows.push({tag:el.tagName,id:el.id||null,cls:String(el.className||'').slice(0,180),role:el.getAttribute('role'),aria:el.getAttribute('aria-haspopup'),text:text.slice(0,180),context:context.slice(0,500)});
        }
      }
      const body=clean(document.body.innerText);
      return {candidates:rows.slice(0,80),body_speed_samples:(body.match(/.{0,45}\b\d+(?:[.,]\d+)?\s*(?:Mbps|Mbit|Mb).{0,90}/ig)||[]).slice(0,30)};
    });

    const variants=[];
    for(const si of speedSelects){
      const opts=si.options.filter(o=>!o.disabled && String(o.value||'')!=='' && !/seçiniz|choose|hız seç/i.test(o.text));
      for(const opt of opts){
        const result=await page.evaluate(({idx,value})=>{
          const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
          const selects=[...document.querySelectorAll('select')],s=selects[idx];
          if(!s)return {ok:false};
          const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')?.set;
          try{setter?setter.call(s,value):(s.value=value)}catch{s.value=value}
          s.dispatchEvent(new Event('input',{bubbles:true}));
          s.dispatchEvent(new Event('change',{bubbles:true}));
          return {ok:true};
        },{idx:si.idx,value:opt.value});
        if(!result?.ok)continue;
        await wait(650);
        await page.waitForNetworkIdle({idleTime:300,timeout:1800}).catch(()=>{});
        const v=await page.evaluate(({idx,optionText})=>{
          const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
          const s=[...document.querySelectorAll('select')][idx];
          if(!s)return null;
          let card=s;
          for(let i=0;i<8&&card;i++,card=card.parentElement){
            const t=clean(card.innerText);
            if(t.length>=50&&t.length<=3500&&/(TL|₺|Mbps|Mbit)/i.test(t))break;
          }
          const headings=card?[...card.querySelectorAll('h1,h2,h3,h4,h5,h6,.title,.card-title,strong,b')]:[];
          const heading=headings.map(x=>clean(x.textContent)).find(t=>t.length>=3&&t.length<=100&&!/^\d/.test(t)&&!/(TL|₺|Mbps|Mbit|Ay$)/i.test(t))||'';
          return {option_text:optionText,selected_value:s.value,heading,card_text:clean(card?.innerText||'').slice(0,3500)};
        },{idx:si.idx,optionText:opt.text});
        if(v)variants.push(v);
      }
    }

    const customButtonCount=await page.$$eval('button.speed-button',els=>els.length).catch(()=>0);
    let customOptionsExamined=0;
    if(customButtonCount){
      const readCard=async idx=>page.evaluate(idx=>{
        const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
        const btn=[...document.querySelectorAll('button.speed-button')][idx];
        if(!btn)return null;
        let card=btn;
        for(let i=0;i<10&&card;i++,card=card.parentElement){
          const text=clean(card.innerText);
          const oneControl=card.querySelectorAll?card.querySelectorAll('button.speed-button').length===1:false;
          if(oneControl&&text.length>=40&&text.length<=1800&&/(TL|₺)\s*\/\s*Ay/i.test(text)&&/İncele/i.test(text))break;
        }
        const raw=clean(card?.innerText||'');
        const heading=(raw.match(/^(.*?)\s+\d+(?:[.,]\d+)?\s*Mbps\s*İndirme Hızı/i)||[])[1]||'';
        return {option_text:clean(btn.innerText),selected_value:clean(btn.innerText),heading:clean(heading),card_text:raw.slice(0,3500)};
      },idx);

      for(let idx=0;idx<customButtonCount;idx++){
        const initial=await readCard(idx);if(initial)variants.push(initial);
        await page.evaluate(idx=>{const b=[...document.querySelectorAll('button.speed-button')][idx];if(b)b.click()},idx);
        await wait(180);
        const options=await page.evaluate(()=>{
          const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
          const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0};
          const els=[...document.querySelectorAll('.ant-dropdown-menu-item,[role="menuitem"],.ant-dropdown [class*="menu-item"]')].filter(visible);
          const out=[];const seen=new Set();
          for(const el of els){const t=clean(el.innerText||el.textContent);if(!/^\d+(?:[.,]\d+)?\s*(?:Mbps|Mbit|Mb|GB)\b/i.test(t)&&!/^(Sınırsız|Limitsiz)/i.test(t))continue;if(!seen.has(t)){seen.add(t);out.push(t)}}
          return out;
        });
        await page.keyboard.press('Escape').catch(()=>{});
        const initialText=clean(initial?.option_text||'');
        const allOptions=[initialText,...options].filter((x,i,a)=>x&&a.indexOf(x)===i);
        for(const optionText of allOptions){
          if(initialText&&clean(optionText)===initialText)continue;
          await page.evaluate(idx=>{const b=[...document.querySelectorAll('button.speed-button')][idx];if(b)b.click()},idx);
          await wait(100);
          const clicked=await page.evaluate(optionText=>{
            const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
            const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0};
            const target=clean(optionText);
            const els=[...document.querySelectorAll('.ant-dropdown-menu-item,[role="menuitem"],.ant-dropdown [class*="menu-item"]')].filter(visible);
            const el=els.find(x=>clean(x.innerText||x.textContent)===target)||els.find(x=>clean(x.innerText||x.textContent).startsWith(target));
            if(!el)return false;el.click();return true;
          },optionText);
          if(!clicked){await page.keyboard.press('Escape').catch(()=>{});continue}
          customOptionsExamined++;
          await wait(260);
          const v=await readCard(idx);if(v)variants.push(v);
        }
      }
    }

    const products=[];
    for(const v of variants)products.push(...parseDynamicLifecellVariant(source,v,isSuperbox));
    const uniq=new Map();
    for(const p of products){
      const old=uniq.get(p.product_key);
      if(!old || Number(p.effective_monthly_try||Infinity)<Number(old.effective_monthly_try||Infinity))uniq.set(p.product_key,p);
    }
    const rows=[...uniq.values()];
    return {
      ok:true,http_status:200,response_ms:Date.now()-t0,products:rows,
      meta:{
        dynamic:true,
        select_count:selectInfo.length,
        speed_select_count:speedSelects.length,
        combinations_examined:variants.length,
        unique_products:rows.length,
        custom_speed_button_count:customButtonCount,
        custom_options_examined:customOptionsExamined,
        speed_options:speedSelects.map(s=>s.options.map(o=>o.text).filter(Boolean)).slice(0,30),custom_candidate_count:customDiagnostic.candidates.length
      }
    };
  }catch(e){
    return {ok:false,http_status:null,response_ms:Date.now()-t0,products:[],meta:{dynamic:true},error:e?.message||String(e)};
  }finally{if(page)await page.close().catch(()=>{})}
}

export function parserFor(source,html){
  if(source.parser==='kktcell'||source.parser==='kktcell-superbox')return {products:parseKktcell(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='extend-table')return {products:parseExtendTable(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='lifecell-digital')return {products:parseLifecellDigital(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='telsim-home')return {products:parseTelsimHome(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='redbox')return {products:parseRedBox(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='freenet')return {products:parseFreeNet(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='fixnet')return {products:parseFixNet(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='towernet')return {products:parseTowernet(html,source),meta:discoveryMeta(html,source)};
  return {products:parseISP(html,source).map(offer),meta:discoveryMeta(html,source)};
}

// Configured official hosts only; unrelated redirects must not become package sources.
export async function fetchSource(source){
  const t0=Date.now();let httpStatus=null;
  try{
    let result;
    if(source.parser==='lifecell-dynamic'||source.parser==='lifecell-superbox-dynamic'){
      result=await fetchLifecellDynamic(source);
    }else{
      let url=source.fetch_url||source.url,res;
      const host=new URL(url).hostname.replace(/^www\./,'');
      const signal=AbortSignal.timeout(20000);
      for(let i=0;i<5;i++){
        res=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml','accept-language':'tr-TR,tr;q=0.9,en;q=0.7'},redirect:'manual',signal});
        httpStatus=res.status;
        if(res.status>=300&&res.status<400){
          const next=new URL(res.headers.get('location')||'',url);
          if(!['http:','https:'].includes(next.protocol)||next.hostname.replace(/^www\./,'')!==host)throw new Error('Beklenmeyen alan adına yönlendirme; kaynak doğrulaması gerekli');
          await res.body?.cancel();url=next.href;continue;
        }
        break;
      }
      if(!res.ok)throw new Error('HTTP '+res.status);
      const html=await res.text();
      if(html.length>8_000_000)throw new Error('Kaynak beklenen boyutu aşıyor');
      const parsed=parserFor(source,html);
      result={ok:true,http_status:res.status,response_ms:Date.now()-t0,products:parsed.products,meta:{...parsed.meta,social_links:socialLinks(html,source.url)}};
    }
    result.meta={...result.meta,parser_version:PARSER_VERSION};
    result.products=(result.products||[]).map(p=>({...p,company_ids:source.company_ids,market_segment:source.market_segment||p.market_segment||'residential'}));
    if(result.ok&&!result.products.length){
      return {...result,ok:false,status:source.parser==='services'?'discovery':'parse_error',
        error:source.parser==='services'?'Site erişilebilir; paket bilgisi henüz doğrulanamadı':'Paket verisi ayrıştırılamadı; önceki doğrulanmış teklifler korunuyor'};
    }
    return {...result,status:result.ok?'ok':'error'};
  }catch(e){return {ok:false,status:'error',http_status:httpStatus,response_ms:Date.now()-t0,products:[],meta:{parser_version:PARSER_VERSION},error:e?.message||String(e)}}
}

function comparable(a,b){
  const av=a==null?null:(typeof a==='number'?round(a,3):a);
  const bv=b==null?null:(typeof b==='number'?round(b,3):b);
  return JSON.stringify(av)===JSON.stringify(bv);
}
async function writeChanges(pool,source,scanId,prevRows,nextRows){
  const prev=new Map((prevRows||[]).map(x=>[x.product_key,x]));
  const next=new Map((nextRows||[]).map(x=>[x.product_key,x]));
  let count=0;
  for(const [k,p] of next){
    const old=prev.get(k);
    if(!old){
      await pool.query(`INSERT INTO home_internet_changes(source_slug,provider,product_key,product_name,change_type,new_value,severity,scan_id) VALUES($1,$2,$3,$4,'added',$5,'critical',$6)`,[source.slug,source.provider,k,p.name,JSON.stringify(p),scanId]);count++;continue;
    }
    for(const [field,label,severity] of TRACK_FIELDS){
      if(!comparable(old[field],p[field])){
        await pool.query(`INSERT INTO home_internet_changes(source_slug,provider,product_key,product_name,change_type,field_name,old_value,new_value,severity,scan_id) VALUES($1,$2,$3,$4,'field_changed',$5,$6,$7,$8,$9)`,[source.slug,source.provider,k,p.name,label,old[field]==null?null:String(old[field]),p[field]==null?null:String(p[field]),severity,scanId]);count++;
      }
    }
  }
  for(const [k,p] of prev){
    if(!next.has(k)){
      await pool.query(`INSERT INTO home_internet_changes(source_slug,provider,product_key,product_name,change_type,old_value,severity,scan_id) VALUES($1,$2,$3,$4,'removed',$5,'critical',$6)`,[source.slug,source.provider,k,p.name,JSON.stringify(p),scanId]);count++;
    }
  }
  return count;
}

let running=false;
let migrationCleanupDone=false;
async function cleanupHomeInternetMigrationNoise(pool){
  if(migrationCleanupDone)return;
  await pool.query(`DELETE FROM home_internet_changes
    WHERE (
      source_slug='lifecell-digital-home'
      AND detected_at >= TIMESTAMPTZ '2026-09-13 13:20:00+00'
      AND detected_at < TIMESTAMPTZ '2026-09-13 13:45:00+00'
    ) OR (
      source_slug='kktcell-home'
      AND detected_at >= TIMESTAMPTZ '2026-09-13 14:03:00+00'
      AND detected_at < TIMESTAMPTZ '2026-09-13 14:06:00+00'
    ) OR (
      source_slug='kktcell-home'
      AND detected_at >= TIMESTAMPTZ '2026-09-13 14:11:00+00'
      AND detected_at < TIMESTAMPTZ '2026-09-13 14:14:00+00'
    )`);
  migrationCleanupDone=true;
}
export async function scanHomeInternet(pool,{sources=HOME_INTERNET_SOURCES,fetcher=fetchSource}={}){
  if(running)return {ok:false,skipped:true,reason:'home internet scan already running'};
  running=true;
  try{
    await cleanupHomeInternetMigrationNoise(pool);
    const results=[];
    const pending=[...sources];
    async function worker(){for(;;){
      const source=pending.shift();if(!source)return;
      let fetched=await fetcher(source);
      fetched.meta={...fetched.meta,parser_version:PARSER_VERSION};
      if(fetched.ok&&!fetched.products.length)fetched={...fetched,ok:false,status:'parse_error',error:'Paket verisi boş; önceki teklifler korunuyor'};
      const prev=await pool.query(`SELECT payload_json,source_meta_json FROM home_internet_scans WHERE source_slug=$1 AND status='ok' ORDER BY captured_at DESC,id DESC LIMIT 1`,[source.slug]);
      const previousProducts=prev.rows.length&&Array.isArray(prev.rows[0].payload_json)?prev.rows[0].payload_json:[];
      const sameParser=prev.rows[0]?.source_meta_json?.parser_version===PARSER_VERSION;
      if(fetched.ok&&sameParser&&previousProducts.length>=6&&fetched.products.length<previousProducts.length/2){
        fetched={...fetched,ok:false,status:'parse_error',error:'Paket sayısı yarıdan fazla düştü; kaynak kontrolü gerekli',products:[]};
      }
      const ins=await pool.query(`INSERT INTO home_internet_scans(source_slug,provider,source_name,source_url,technology,ownership_group,status,http_status,response_ms,parsed_count,payload_json,source_meta_json,error)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13) RETURNING id,captured_at`,[
        source.slug,source.provider,source.name,source.url,source.technology,source.ownership_group,
        fetched.status||(fetched.ok?'ok':'error'),fetched.http_status,fetched.response_ms,fetched.products.length,JSON.stringify(fetched.products),JSON.stringify(fetched.meta||{}),fetched.error||null
      ]);
      const scanId=ins.rows[0].id;
      const parserBaseline=!sameParser||previousProducts.length===0;
      const changes=fetched.ok&&prev.rows.length&&!parserBaseline?await writeChanges(pool,source,scanId,previousProducts,fetched.products):0;
      results.push({...source,...fetched,changes,captured_at:ins.rows[0].captured_at});
      console.log('[home-internet]',source.slug,JSON.stringify({ok:fetched.ok,parsed:fetched.products.length,changes,response_ms:fetched.response_ms,error:fetched.error||null,meta:fetched.meta||{}}));
    }}
    await Promise.all(Array.from({length:3},worker));
    const scanProducts=results.flatMap(x=>x.products||[]);
    console.log('[home-internet-summary]',JSON.stringify({
      total:scanProducts.length,companies:ISP_COMPANIES.length,sources:results.length,healthy_sources:results.filter(x=>x.ok).length,
      priced:scanProducts.filter(x=>x.effective_monthly_try>0).length,brands:new Set(scanProducts.map(x=>x.provider)).size,
      fixed:scanProducts.filter(x=>(x.product_family||'fixed')==='fixed').length,
      fwa:scanProducts.filter(x=>x.product_family==='fwa').length,
      turkcell_home:scanProducts.filter(x=>x.provider==='Turkcell Ev İnterneti'&&x.product_family!=='fwa').length,
      superbox:scanProducts.filter(x=>x.brand==='Superbox').length,
      redbox:scanProducts.filter(x=>x.brand==='Red Box').length
    }));
    return {ok:results.every(x=>x.ok),scanned_at:new Date().toISOString(),sources:results.map(x=>({slug:x.slug,provider:x.provider,name:x.name,url:x.url,technology:x.technology,ownership_group:x.ownership_group,ok:x.ok,http_status:x.http_status,response_ms:x.response_ms,parsed_count:x.products.length,changes:x.changes,meta:x.meta,error:x.error||null}))};
  }finally{running=false}
}

function scoreOffer(x){
  if(x.stale||x.market_segment==='business'||!x.speed_down_mbps||!x.effective_monthly_try)return null;
  const value=Math.min(100,(Number(x.mbps_per_100tl)||0)*10);
  const tech={Fiber:100,'4.5G FWA':72,WDSL:60,ADSL:35,'Turkcell Ev İnterneti':60}[x.technology]||55;
  const flexibility=x.duration_months<=1?100:x.duration_months<=6?75:55;
  const install=x.install_fee_try===0?100:x.install_fee_try==null?60:Math.max(20,100-Number(x.install_fee_try)/20);
  return Math.round(value*.45+tech*.25+flexibility*.15+install*.15);
}

export function marketPayload(scans,changes,lastGood=[]){
  const products=[],sources=[];
  const bySlug=new Map(scans.map(r=>[r.source_slug,r]));
  const good=new Map(lastGood.map(r=>[r.source_slug,r]));
  for(const source of HOME_INTERNET_SOURCES){
    const row=bySlug.get(source.slug);
    const usable=row?.status==='ok'&&row.source_meta_json?.parser_version===PARSER_VERSION;
    const fallback=good.get(source.slug);
    const snapshot=usable?row:fallback?.source_meta_json?.parser_version===PARSER_VERSION?fallback:null;
    const stale=!usable||snapshot&&Date.now()-new Date(snapshot.captured_at).getTime()>26*3600000;
    const payload=Array.isArray(snapshot?.payload_json)?snapshot.payload_json:[];
    products.push(...payload.map(x=>({...x,company_ids:source.company_ids,market_segment:source.market_segment||x.market_segment||'residential',
      stale:!!stale,verified_at:snapshot.captured_at,market_score:scoreOffer({...x,stale})})));
    sources.push({...source,captured_at:row?.captured_at||null,
      last_success_at:snapshot?.captured_at||null,status:row?.status||'pending',
      http_status:row?.http_status,response_ms:row?.response_ms,parsed_count:usable?row.parsed_count:0,
      retained_count:!usable?payload.length:0,meta:row?.source_meta_json||{},error:row?.error||null});
  }
  const companies=companyCoverage(sources,products);
  const priced=products.filter(x=>!x.stale&&x.market_segment!=='business'&&x.effective_monthly_try>0);
  const speedBased=priced.filter(x=>x.speed_down_mbps>0);
  const providerCount=new Set(sources.map(x=>x.provider)).size;
  const technologies=[...new Set(products.map(x=>x.technology).filter(Boolean))];
  const bestValue=[...speedBased].sort((a,b)=>(b.mbps_per_100tl||0)-(a.mbps_per_100tl||0))[0]||null;
  const fastest=[...speedBased].sort((a,b)=>(b.speed_down_mbps||0)-(a.speed_down_mbps||0))[0]||null;
  const cheapest=[...priced].sort((a,b)=>(a.effective_monthly_try||Infinity)-(b.effective_monthly_try||Infinity))[0]||null;
  const fixedProducts=products.filter(x=>x.product_family!=='fwa');
  const fwaProducts=products.filter(x=>x.product_family==='fwa');
  const ours=speedBased.filter(x=>x.provider==='Turkcell Ev İnterneti'&&x.product_family!=='fwa');
  const rivals=speedBased.filter(x=>x.provider!=='Turkcell Ev İnterneti'&&x.product_family!=='fwa');
  const opportunities=[];
  for(const o of ours){
    const near=rivals.filter(r=>r.technology===o.technology&&r.unlimited===o.unlimited&&r.duration_months===o.duration_months&&r.duration_days===o.duration_days&&Math.abs(Number(r.speed_down_mbps)-Number(o.speed_down_mbps))<=Math.max(5,Number(o.speed_down_mbps)*.35)).sort((a,b)=>(b.market_score||0)-(a.market_score||0))[0];
    if(near){
      opportunities.push({kktcell:o,competitor:near,score_gap:(o.market_score??0)-(near.market_score??0),monthly_gap_try:round(Number(o.effective_monthly_try)-Number(near.effective_monthly_try)),value_gap:round(Number(o.mbps_per_100tl||0)-Number(near.mbps_per_100tl||0),3)});
    }
  }
  opportunities.sort((a,b)=>a.score_gap-b.score_gap);
  const superbox=fwaProducts.filter(x=>x.brand==='Superbox').sort((a,b)=>(a.effective_monthly_try||Infinity)-(b.effective_monthly_try||Infinity));
  const redbox=fwaProducts.filter(x=>x.brand==='Red Box').sort((a,b)=>(a.effective_monthly_try||Infinity)-(b.effective_monthly_try||Infinity));
  const fwa_comparison={superbox,redbox,superbox_count:superbox.length,redbox_count:redbox.length};
  return {
    generated_at:new Date().toISOString(),
    methodology:'Home Internet v2 • Resmî paket kaynakları. Hediye süre dâhil efektif aylık bedel; kurulum/kablo ayrıca. Gün bazlı paketlerde 30 gün = 1 ay. 12 ay eşdeğer bedel bir taahhüt fiyatı değildir.',
    scope:ISP_SCOPE,companies,social:socialDirectory(sources),
    metrics:{
      listed_companies:companies.length,tracked_companies:companies.filter(c=>['tracked','partial'].includes(c.status)).length,
      providers:providerCount,sources:sources.length,products:products.length,priced_products:priced.length,
      fixed_products:fixedProducts.length,fwa_products:fwaProducts.length,turkcell_home_products:fixedProducts.filter(x=>x.provider==='Turkcell Ev İnterneti').length,superbox_products:fwaProducts.filter(x=>x.brand==='Superbox').length,redbox_products:fwaProducts.filter(x=>x.brand==='Red Box').length,
      technologies:technologies.length,changes_7d:changes.filter(x=>new Date(x.detected_at)>Date.now()-7*86400000).length,
      best_value:bestValue,fastest,cheapest
    },
    sources,products,fixed_products:fixedProducts,fwa_products:fwaProducts,opportunities:opportunities.slice(0,10),fwa_comparison,changes:changes.slice(0,100)
  };
}

export async function getHomeInternetMarket(pool,{refresh=false}={}){
  if(refresh)await scanHomeInternet(pool);
  let r=await pool.query(`SELECT DISTINCT ON (source_slug) * FROM home_internet_scans ORDER BY source_slug,captured_at DESC,id DESC`);
  if(!r.rows.length){await scanHomeInternet(pool);r=await pool.query(`SELECT DISTINCT ON (source_slug) * FROM home_internet_scans ORDER BY source_slug,captured_at DESC,id DESC`)}
  const ch=await pool.query(`SELECT * FROM home_internet_changes WHERE detected_at>=NOW()-INTERVAL '30 days' ORDER BY detected_at DESC,id DESC LIMIT 300`);
  const good=await pool.query(`SELECT DISTINCT ON (source_slug) * FROM home_internet_scans WHERE status='ok' AND source_meta_json->>'parser_version'=$1 ORDER BY source_slug,captured_at DESC,id DESC`,[PARSER_VERSION]);
  return marketPayload(r.rows,ch.rows,good.rows);
}
