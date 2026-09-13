import * as cheerio from 'cheerio';

const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Safari/537.36';

export const HOME_INTERNET_SOURCES=[
  {slug:'kktcell-home',provider:'KKTCELL',name:'Kuzey Kıbrıs Turkcell İnternet',url:'https://www.kktcell.com/internet-paketleri',technology:'4.5G / Ev İnterneti',ownership_group:'Kuzey Kıbrıs Turkcell',parser:'kktcell'},
  {slug:'lifecell-digital-home',provider:'Turkcell Ev İnterneti',name:'Lifecell Digital Ev İnterneti',url:'https://tsurvey.lifecelldigital.com/kurumsal/paketler',technology:'WDSL / Sabit Genişbant',ownership_group:'Lifecell Digital Ltd.',parser:'lifecell-digital'},
  {slug:'extend-wdsl',provider:'Extend',name:'Extend WDSL',url:'https://www.extendbroadband.com/urunler-wdsl.php',technology:'WDSL',ownership_group:'Aydoğan Communication Ltd.',parser:'extend-table'},
  {slug:'extend-fiber',provider:'Extend',name:'Extend FiberNET',url:'https://www.extendbroadband.com/urunler-fibernet.php',technology:'Fiber',ownership_group:'Aydoğan Communication Ltd.',parser:'extend-table'},
  {slug:'telsim-home',provider:'Telsim',name:'Vodafone Evde İnternet',url:'https://www.kktctelsim.com/tr/internet/evde-internet-ve-red-box/vodafone-evde-internet',technology:'WDSL / ADSL',ownership_group:'KKTC Telsim',parser:'telsim-home'},
  {slug:'freenet-home',provider:'FreeNet',name:'FreeNet Ev İnterneti',url:'https://freenetcyp.com/',technology:'WDSL',ownership_group:'FreeNet',parser:'freenet'},
  {slug:'fixnet-home',provider:'FixNet',name:'FixNet Broadband',url:'https://www.fixnetbroadband.com/',technology:'WDSL / Fiber',ownership_group:'FixNet Broadband',parser:'fixnet'},
  {slug:'towernet-home',provider:'Towernet',name:'Towernet Ev İnterneti',url:'https://towernet.net/paketler/',technology:'WDSL / ADSL',ownership_group:'Towernet',parser:'towernet'},
  {slug:'nethouse-home',provider:'Nethouse',name:'Nethouse Bireysel',url:'https://nethouse.net/tr/',technology:'WDSL / ADSL / VDSL / Fiber',ownership_group:'Netonline Bilişim Şti. Ltd.',parser:'discovery'},
  {slug:'multimax-home',provider:'Multimax',name:'Multimax Bireysel',url:'https://www.mmcyp.com/',technology:'WDSL / Fiber / Apartman',ownership_group:'Netonline Bilişim Şti. Ltd.',parser:'discovery'}
];

const TRACK_FIELDS=[
  ['speed_down_mbps','Download Hızı','high'],
  ['speed_up_mbps','Upload Hızı','high'],
  ['effective_monthly_try','Efektif Aylık Ücret','high'],
  ['price_monthly_try','Aylık Ücret','high'],
  ['total_price_try','Toplam Ücret','high'],
  ['duration_months','Taahhüt / Ödeme Süresi','medium'],
  ['bonus_months','Hediye Ay','medium'],
  ['install_fee_try','Kurulum Ücreti','medium'],
  ['unlimited','Limitsiz','high'],
  ['data_limit_gb','Kota','high'],
  ['technology','Teknoloji','medium']
];

function n(v){
  if(v==null)return null;
  const s=String(v).replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.').replace(/[^0-9.]/g,'');
  const x=Number(s);return Number.isFinite(x)?x:null;
}
function clean(v){return String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim()}
function keyPart(v){return clean(v).toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü]+/gi,'-').replace(/^-|-$/g,'')}
function round(v,d=2){if(v==null||!Number.isFinite(Number(v)))return null;const p=10**d;return Math.round(Number(v)*p)/p}

function offer(base={}){
  const duration=Number(base.duration_months||1);
  const bonus=Number(base.bonus_months||0);
  const service=Math.max(1,duration+bonus);
  const total=base.total_price_try!=null?Number(base.total_price_try):(base.price_monthly_try!=null?Number(base.price_monthly_try)*duration:null);
  const effective=total!=null?total/service:(base.price_monthly_try!=null?Number(base.price_monthly_try):null);
  const monthly=base.price_monthly_try!=null?Number(base.price_monthly_try):(total!=null?total/duration:null);
  const speed=base.speed_down_mbps!=null?Number(base.speed_down_mbps):null;
  return {
    ...base,
    duration_months:duration,
    bonus_months:bonus,
    service_months:service,
    price_monthly_try:round(monthly),
    total_price_try:round(total),
    effective_monthly_try:round(effective),
    first_year_equiv_try:effective!=null?round(effective*12):null,
    mbps_per_100tl:(speed>0&&effective>0)?round(speed/effective*100,3):null,
    product_key:base.product_key||[base.source_slug,keyPart(base.name),duration,bonus].join('|')
  };
}

function parseKktcell(html,source){
  const $=cheerio.load(html);$('script,style,noscript,svg').remove();
  const out=[],seen=new Set();
  $('a').each((_,el)=>{
    const raw=clean($(el).text());
    if(!raw||raw.length<12||raw.length>1200)return;
    if(!/Superbox|Life(?: Extra)?\b|Dedike WiFi|Ev İnterneti/i.test(raw))return;
    const priceM=raw.match(/(\d[\d.]*(?:,\d+)?)\s*TL\s*\/\s*AY/i)||raw.match(/(\d[\d.]*(?:,\d+)?)\s*TL\b/i);
    if(!priceM)return;
    let name=raw.split(/(?=\d+(?:[.,]\d+)?\s*(?:MBPS|GB|INTERNET))/i)[0].trim();
    name=name.replace(/^(Yeni|Popüler)\s+/i,'').replace(/\s+Faturalı$/i,'').trim();
    if(!name||name.length>140)return;
    const speedM=raw.match(/(\d+(?:[.,]\d+)?)\s*MBPS\b/i);
    const dataM=!speedM?raw.match(/(\d+(?:[.,]\d+)?)\s*GB\b/i):null;
    const durM=raw.match(/(\d+)\s*Aylık Abonelik/i);
    const annual=/YILLIK ABONELİK/i.test(raw);
    const technology=/Superbox/i.test(raw)?'4.5G FWA':(/Dedike WiFi|Life/i.test(raw)?'Turkcell Ev İnterneti':'Ev İnterneti');
    const row=offer({
      source_slug:source.slug,provider:source.provider,ownership_group:source.ownership_group,source_url:source.url,
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
        source_slug:source.slug,provider:source.provider,ownership_group:source.ownership_group,source_url:source.url,
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
    const pairs=[...seg.matchAll(/(1|4|12|14)\s*Ay\s+([\d.]+)\s*TL(?:\/Ay)?/ig)];
    if(pairs.length){
      for(const p of pairs){const duration=Number(p[1]),price=n(p[2]);out.push(offer({
        source_slug:source.slug,provider:source.provider,ownership_group:source.ownership_group,source_url:source.url,
        name,technology:'WDSL / Sabit Genişbant',speed_down_mbps:speed,speed_up_mbps:null,data_limit_gb:null,unlimited:true,
        duration_months:duration,bonus_months:0,total_price_try:/TL\/Ay/i.test(p[0])?null:price,price_monthly_try:/TL\/Ay/i.test(p[0])?price:null,
        install_fee_try:duration===12?0:null,features:[duration===12?'12 ay kontratta ücretsiz kurulum':null].filter(Boolean),
        raw_text:(name+' '+speed+'Mbps '+seg).slice(0,700),product_key:[source.slug,keyPart(name),speed,duration].join('|')
      }))}
    }else{
      const d=seg.match(/(12)\s*Ay/i),p=seg.match(/([\d.]+)\s*TL\/Ay/i);
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
      source_slug:source.slug,provider:source.provider,ownership_group:source.ownership_group,source_url:source.url,
      name:type+' Evde '+speed,technology:tech,speed_down_mbps:speed,speed_up_mbps:null,data_limit_gb:null,unlimited:true,
      duration_months:duration,bonus_months:bonus,price_monthly_try:price,total_price_try:total,
      install_fee_try:/Kurulum Ücretsiz/i.test(seg)?0:null,
      features:[type,/Kurulum Ücretsiz/i.test(seg)?'Kurulum ücretsiz':null,bonus?bonus+' ay hediye':null].filter(Boolean),
      raw_text:seg.slice(0,700),product_key:[source.slug,type,speed,duration,bonus].join('|')
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
      {d:1,b:0,re:/([\d.]+)₺\s*1\s*Aylık/i},
      {d:3,b:0,re:/([\d.]+)₺\s*3\s*Aylık/i},
      {d:6,b:/6\s*Aylık\s*\+1\s*Ay\s*Hediye/i.test(seg)?1:0,re:/([\d.]+)₺\s*6\s*Aylık/i},
      {d:12,b:/12\s*Aylık\s*\+2\s*Ay\s*Hediye/i.test(seg)?2:0,re:/([\d.]+)₺\s*12\s*Aylık/i}
    ];
    for(const t of terms){const m=seg.match(t.re);if(!m)continue;out.push(offer({
      source_slug:source.slug,provider:source.provider,ownership_group:source.ownership_group,source_url:source.url,
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
    const priceM=raw.match(/([\d.]+)₺/i);if(!dm||!priceM)return;
    const durationM=raw.match(/(\d+)\s*Ay\s*Paket/i);const duration=durationM?Number(durationM[1]):1;
    const bonusM=raw.match(/\+\s*(\d+)\s*AY\s*HEDİYE/i);const bonus=bonusM?Number(bonusM[1]):0;
    out.push(offer({
      source_slug:source.slug,provider:source.provider,ownership_group:source.ownership_group,source_url:source.url,
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
      source_slug:source.slug,provider:source.provider,ownership_group:source.ownership_group,source_url:source.url,
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

function parserFor(source,html){
  if(source.parser==='kktcell')return {products:parseKktcell(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='extend-table')return {products:parseExtendTable(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='lifecell-digital')return {products:parseLifecellDigital(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='telsim-home')return {products:parseTelsimHome(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='freenet')return {products:parseFreeNet(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='fixnet')return {products:parseFixNet(html,source),meta:discoveryMeta(html,source)};
  if(source.parser==='towernet')return {products:parseTowernet(html,source),meta:discoveryMeta(html,source)};
  return {products:[],meta:discoveryMeta(html,source)};
}

async function fetchSource(source){
  const t0=Date.now();
  try{
    const res=await fetch(source.url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml','accept-language':'tr-TR,tr;q=0.9,en;q=0.7','cache-control':'no-cache'},redirect:'follow',signal:AbortSignal.timeout(30000)});
    const html=await res.text();
    if(!res.ok)throw new Error('HTTP '+res.status);
    const parsed=parserFor(source,html);
    return {ok:true,http_status:res.status,response_ms:Date.now()-t0,products:parsed.products,meta:parsed.meta};
  }catch(e){return {ok:false,http_status:null,response_ms:Date.now()-t0,products:[],meta:{},error:e?.message||String(e)}}
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
export async function scanHomeInternet(pool){
  if(running)return {ok:false,skipped:true,reason:'home internet scan already running'};
  running=true;
  try{
    const results=[];
    for(const source of HOME_INTERNET_SOURCES){
      const fetched=await fetchSource(source);
      const prev=await pool.query(`SELECT payload_json FROM home_internet_scans WHERE source_slug=$1 AND status='ok' ORDER BY captured_at DESC,id DESC LIMIT 1`,[source.slug]);
      const ins=await pool.query(`INSERT INTO home_internet_scans(source_slug,provider,source_name,source_url,technology,ownership_group,status,http_status,response_ms,parsed_count,payload_json,source_meta_json,error)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13) RETURNING id,captured_at`,[
        source.slug,source.provider,source.name,source.url,source.technology,source.ownership_group,
        fetched.ok?'ok':'error',fetched.http_status,fetched.response_ms,fetched.products.length,JSON.stringify(fetched.products),JSON.stringify(fetched.meta||{}),fetched.error||null
      ]);
      const scanId=ins.rows[0].id;
      const changes=fetched.ok&&prev.rows.length?await writeChanges(pool,source,scanId,prev.rows[0].payload_json||[],fetched.products):0;
      results.push({...source,...fetched,changes,captured_at:ins.rows[0].captured_at});
      console.log('[home-internet]',source.slug,JSON.stringify({ok:fetched.ok,parsed:fetched.products.length,changes,response_ms:fetched.response_ms,error:fetched.error||null}));
    }
    return {ok:results.every(x=>x.ok),scanned_at:new Date().toISOString(),sources:results.map(x=>({slug:x.slug,provider:x.provider,name:x.name,url:x.url,technology:x.technology,ownership_group:x.ownership_group,ok:x.ok,http_status:x.http_status,response_ms:x.response_ms,parsed_count:x.products.length,changes:x.changes,meta:x.meta,error:x.error||null}))};
  }finally{running=false}
}

function scoreOffer(x){
  if(!x.speed_down_mbps||!x.effective_monthly_try)return null;
  const value=Math.min(100,(Number(x.mbps_per_100tl)||0)*10);
  const tech={Fiber:100,'4.5G FWA':72,WDSL:60,ADSL:35,'Turkcell Ev İnterneti':60}[x.technology]||55;
  const flexibility=x.duration_months<=1?100:x.duration_months<=6?75:55;
  const install=x.install_fee_try===0?100:x.install_fee_try==null?60:Math.max(20,100-Number(x.install_fee_try)/20);
  return Math.round(value*.45+tech*.25+flexibility*.15+install*.15);
}

function marketPayload(scans,changes){
  const products=[];const sources=[];
  for(const row of scans){
    const payload=Array.isArray(row.payload_json)?row.payload_json:[];
    products.push(...payload.map(x=>({...x,market_score:scoreOffer(x)})));
    sources.push({
      slug:row.source_slug,provider:row.provider,name:row.source_name,url:row.source_url,technology:row.technology,ownership_group:row.ownership_group,
      captured_at:row.captured_at,status:row.status,http_status:row.http_status,response_ms:row.response_ms,parsed_count:row.parsed_count,
      meta:row.source_meta_json||{},error:row.error
    });
  }
  const priced=products.filter(x=>x.effective_monthly_try!=null);
  const speedBased=priced.filter(x=>x.speed_down_mbps>0);
  const providerCount=new Set(sources.map(x=>x.provider)).size;
  const technologies=[...new Set(products.map(x=>x.technology).filter(Boolean))];
  const bestValue=[...speedBased].sort((a,b)=>(b.mbps_per_100tl||0)-(a.mbps_per_100tl||0))[0]||null;
  const fastest=[...speedBased].sort((a,b)=>(b.speed_down_mbps||0)-(a.speed_down_mbps||0))[0]||null;
  const cheapest=[...priced].sort((a,b)=>(a.effective_monthly_try||Infinity)-(b.effective_monthly_try||Infinity))[0]||null;
  const ours=speedBased.filter(x=>x.provider==='KKTCELL');
  const rivals=speedBased.filter(x=>x.provider!=='KKTCELL');
  const opportunities=[];
  for(const o of ours){
    const near=rivals.filter(r=>Math.abs(Number(r.speed_down_mbps)-Number(o.speed_down_mbps))<=Math.max(5,Number(o.speed_down_mbps)*.35)).sort((a,b)=>(b.market_score||0)-(a.market_score||0))[0];
    if(near){
      opportunities.push({kktcell:o,competitor:near,score_gap:(o.market_score??0)-(near.market_score??0),monthly_gap_try:round(Number(o.effective_monthly_try)-Number(near.effective_monthly_try)),value_gap:round(Number(o.mbps_per_100tl||0)-Number(near.mbps_per_100tl||0),3)});
    }
  }
  opportunities.sort((a,b)=>a.score_gap-b.score_gap);
  return {
    generated_at:new Date().toISOString(),
    methodology:'Home Internet v1 • official source monitoring + normalized contract economics',
    metrics:{
      providers:providerCount,sources:sources.length,products:products.length,priced_products:priced.length,
      technologies:technologies.length,changes_7d:changes.filter(x=>new Date(x.detected_at)>Date.now()-7*86400000).length,
      best_value:bestValue,fastest,cheapest
    },
    sources,products,opportunities:opportunities.slice(0,10),changes:changes.slice(0,100)
  };
}

export async function getHomeInternetMarket(pool,{refresh=false}={}){
  if(refresh)await scanHomeInternet(pool);
  let r=await pool.query(`SELECT DISTINCT ON (source_slug) * FROM home_internet_scans ORDER BY source_slug,captured_at DESC,id DESC`);
  if(!r.rows.length){await scanHomeInternet(pool);r=await pool.query(`SELECT DISTINCT ON (source_slug) * FROM home_internet_scans ORDER BY source_slug,captured_at DESC,id DESC`)}
  const ch=await pool.query(`SELECT * FROM home_internet_changes WHERE detected_at>=NOW()-INTERVAL '30 days' ORDER BY detected_at DESC,id DESC LIMIT 300`);
  return marketPayload(r.rows,ch.rows);
}
