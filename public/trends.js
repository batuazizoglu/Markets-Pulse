(()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=(value,digits=0)=>value==null||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('tr-TR',{maximumFractionDigits:digits});
  const date=(value,short=false)=>value&&Number.isFinite(+new Date(value))?new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:short?'short':'long',...(short?{}:{year:'numeric'}),timeZone:'Asia/Famagusta'}).format(new Date(value)):'—';
  const period=data=>data?`Son ${data.window_days} gün · ${date(data.window_start,true)} – ${date(data.window_end)}`:'';
  const signed=value=>value==null?'—':`${value>0?'+':''}${number(value,1)}%`;
  const active=()=>document.body.dataset.view==='trends';
  const state={data:null,key:'',attemptKey:'',pending:null,controller:null,generation:0,loading:false,error:'',ready:null,authorized:false};
  function ensureSection(){
    let section=document.getElementById('trend-analysis-section');if(section)return section;
    const shell=document.querySelector('main.shell');if(!shell)return null;
    section=document.createElement('section');section.id='trend-analysis-section';section.className='section ta-section';section.dataset.routeSection='1';section.classList.toggle('route-visible',active());
    section.innerHTML='<div class="ta-toolbar"><div><p class="ta-eyebrow">Dönemi birlikte okuyalım</p><p id="trendPeriod" class="ta-period">Dönem bilgisi bekleniyor.</p></div><div class="ta-periods" role="group" aria-label="Analiz dönemi">'+[7,30,90].map(days=>'<button type="button" data-market-days="'+days+'" aria-pressed="false">'+days+' gün</button>').join('')+'</div></div><div class="ta-status-row"><p id="trendStatus" role="status" aria-live="polite"></p><button id="trendRetry" type="button" hidden>Yeniden dene</button></div><div id="trendContent" aria-busy="false"><div class="ta-empty ta-initial"><span class="ta-empty-mark" aria-hidden="true">↗</span><h2>Dönemin hareketleri hazırlanıyor</h2><p>Paket değişimlerini, yönünü ve etkisini birlikte göreceksiniz.</p></div></div>';
    section.querySelector('#trendRetry').addEventListener('click',retry);shell.append(section);return section;
  }
  function updateStatus(){
    const section=ensureSection();if(!section)return;
    const content=section.querySelector('#trendContent'),status=section.querySelector('#trendStatus'),retryButton=section.querySelector('#trendRetry');
    const market=window.MarketPulseData?.getState(),selected=market?.days||30,busy=state.loading||Boolean(active()&&market?.loading);
    for(const button of section.querySelectorAll('[data-market-days]')){const selectedButton=Number(button.dataset.marketDays)===selected;button.classList.toggle('active',selectedButton);button.setAttribute('aria-pressed',String(selectedButton))}
    content.setAttribute('aria-busy',String(busy));
    section.querySelector('#trendPeriod').textContent=state.data?period(state.data):'Son '+selected+' gün';
    status.classList.toggle('ta-status-error',Boolean(state.error));retryButton.hidden=!state.error;retryButton.disabled=busy;
    status.textContent=state.error?(state.data?'Analiz yenilenemedi. '+period(state.data)+' verileri gösteriliyor.':'Analiz şu anda alınamıyor. Yeniden deneyin.'):
      busy?(state.data?'Yeni dönem hazırlanıyor. Altta '+period(state.data)+' verileri var.':'Dönem verileri hazırlanıyor…'):
      state.data?'Son güncelleme: '+date(state.data.generated_at):'';
  }
  const empty=(title,body)=>'<div class="ta-empty"><h3>'+esc(title)+'</h3><p>'+esc(body)+'</p></div>';
  function coverage(data){
    const c=data.coverage||{},current=c.current||{},previous=c.previous||{};
    const observed=Math.max(Number(current.observed_days)||0,(data.activity||[]).filter(row=>row.move_count!=null).length),expected=Number(current.expected_days)||data.window_days,knownMoves=(data.activity||[]).some(row=>Number(row.move_count)>0||row.observed_change);
    return '<div id="trendCoverage" class="ta-coverage"><span class="ta-coverage-mark" aria-hidden="true">'+(current.complete?'✓':'◷')+'</span><div><strong>'+(observed?number(observed)+' / '+number(expected)+' günde kayıt var':knownMoves?'Paket hareketleri var; günlük kayıtlar eksik':'Bu dönem için henüz kayıt yok')+'</strong><p>'+(c.first_observed_at?'Mevcut kayıtlar: '+esc(date(c.first_observed_at,true))+' – '+esc(date(c.last_observed_at))+'. ':'')+(current.complete?'Kayıt bulunan günlerdeki değişimler gösterilir.':'Bazı günlerin kayıtları eksik olabilir. Kayıt olmayan günler grafikte ayrı işaretlenir; bu günler “değişiklik yok” sayılmaz.')+(!c.comparable?' Önceki dönem '+number(previous.observed_days||0)+' / '+number(previous.expected_days||data.window_days)+' gün içeriyor; dönem farkı tek başına büyüme göstermez.':'')+'</p></div></div>';
  }
  function findings(data){
    const rows=(data.insights||[]).slice(0,3);
    if(!rows.length)return '';
    return '<div class="ta-findings" aria-label="Dönemin öne çıkan bulguları">'+rows.map((item,index)=>'<article class="ta-finding ta-finding-'+(['positive','warning'].includes(item.tone)?item.tone:'info')+'" data-trend-insight><span class="ta-finding-index" aria-hidden="true">0'+(index+1)+'</span><div><h2>'+esc(item.title)+'</h2><p>'+esc(item.body)+'</p></div></article>').join('')+'</div>';
  }
  function activity(data){
    const rows=data.activity||[],observed=rows.filter(row=>row.move_count!=null),max=Math.max(1,...observed.map(row=>Number(row.move_count)||0));
    if(!rows.length)return '<div data-trend-chart="activity">'+empty('Günlük görünüm henüz oluşmadı','Kayıtlar geldikçe hareketli ve sakin günleri burada görebilirsiniz.')+'</div>';
    const width=880,height=210,left=65,right=18,top=25,bottom=168,plot=width-left-right,slot=plot/rows.length,barWidth=Math.max(2,Math.min(30,slot*.65));
    const times=rows.map(row=>+new Date(row.date+'T12:00:00Z')),first=Math.min(...times),last=Math.max(...times),span=Math.max(86400000,last-first+86400000);
    const x=index=>left+((times[index]-first+43200000)/span)*plot;
    const y=value=>bottom-(Number(value)/max)*(bottom-top);
    const bars=rows.map((row,index)=>{
      const cx=x(index),label=date(row.date+'T12:00:00Z',true),count=Number(row.move_count)||0;
      if(row.move_count==null)return '<g><title>'+esc(label)+': kayıt yok</title><rect x="'+(cx-barWidth/2).toFixed(2)+'" y="'+top+'" width="'+barWidth.toFixed(2)+'" height="'+(bottom-top)+'" rx="2" fill="url(#ta-unobserved)"/></g>';
      const title=label+': '+count+' paket hamlesi'+(row.partial||!row.observed?' · bu günün kayıtları eksik olabilir':'');
      return '<g><title>'+esc(title)+'</title>'+(count?'<rect class="ta-activity-bar" x="'+(cx-barWidth/2).toFixed(2)+'" y="'+y(count).toFixed(2)+'" width="'+barWidth.toFixed(2)+'" height="'+(bottom-y(count)).toFixed(2)+'" rx="3"'+(row.partial||!row.observed?' stroke="currentColor" stroke-dasharray="3 2"':'')+'/>':'<circle class="ta-zero" cx="'+cx.toFixed(2)+'" cy="'+bottom+'" r="2.3"/>')+'</g>';
    }).join('');
    const marks=[...new Set([0,Math.floor((rows.length-1)/2),rows.length-1])];
    const grid=[...new Set([0,Math.ceil(max/2),max])].map(value=>'<line class="ta-gridline" x1="'+left+'" y1="'+y(value)+'" x2="'+(width-right)+'" y2="'+y(value)+'"/><text class="ta-axis" x="'+(left-8)+'" y="'+(y(value)+4)+'" text-anchor="end">'+number(value,1)+'</text>').join('');
    const labels=marks.map((index,i)=>'<text class="ta-axis" x="'+(i===0?left:i===marks.length-1?width-right:x(index))+'" y="196" text-anchor="'+(i===0?'start':i===marks.length-1?'end':'middle')+'">'+esc(date(rows[index].date+'T12:00:00Z',true))+'</text>').join('');
    const total=observed.reduce((sum,row)=>sum+(Number(row.move_count)||0),0);
    return '<div data-trend-chart="activity" class="ta-activity-chart"><svg viewBox="0 0 '+width+' '+height+'" role="img" aria-labelledby="ta-activity-title ta-activity-desc"><title id="ta-activity-title">Günlük paket hamleleri</title><desc id="ta-activity-desc">'+esc(rows.length+' günün '+observed.length+' gününde kayıt var; toplam '+total+' paket hamlesi. Taralı günlerde kayıt yok.')+'</desc><defs><pattern id="ta-unobserved" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M-1 1 1-1 M0 5 5 0 M4 6 6 4" class="ta-missing-stroke"/></pattern></defs>'+grid+bars+labels+'</svg></div><div class="ta-chart-footer"><p>'+number(observed.filter(row=>Number(row.move_count)>0).length)+' gün hareketli · '+number(observed.filter(row=>Number(row.move_count)===0).length)+' gün kayıt var, değişiklik yok</p><div class="ta-legend"><span><i class="ta-key ta-key-current"></i>Paket hamlesi</span><span><i class="ta-key ta-key-missing"></i>Kayıt yok</span></div></div><details class="ta-disclosure"><summary>Günlük değerleri gör</summary><div class="ta-table-wrap"><table class="ta-value-table ta-daily-table"><caption>Günlere göre paket hamleleri ve kayıt durumu</caption><thead><tr><th>Tarih</th><th>Paket hamlesi</th><th>Kayıt durumu</th></tr></thead><tbody>'+rows.map(row=>'<tr><th scope="row">'+esc(date(row.date+'T12:00:00Z'))+'</th><td>'+number(row.move_count)+'</td><td>'+(row.move_count==null?'Kayıt yok':row.partial||!row.observed?'Bu günün kayıtları eksik olabilir':'Kayıt var')+'</td></tr>').join('')+'</tbody></table></div></details>';
  }
  function directions(data){
    const rows=data.directions||[],counts=Object.fromEntries(rows.map(row=>[row.key,row.count==null?null:Number(row.count)]));
    if(!rows.length||rows.every(row=>row.count==null))return '<div data-trend-chart="directions">'+empty('Değişimin yönü için yeterli kayıt yok','Kayıt geldikçe fiyat, internet ve koşul değişimleri burada ayrılacak.')+'</div>';
    const count=key=>Object.hasOwn(counts,key)?counts[key]:0,max=Math.max(1,...rows.map(row=>Number(row.count)||0));
    const groups=[['Fiyat','price_decrease','İndirim','price_increase','Artış'],['İnternet / bonus','data_decrease','Azalış','data_increase','Artış']];
    const lanes=groups.map(([label,down,downLabel,up,upLabel])=>'<div class="ta-direction"><div class="ta-direction-title"><h3>'+label+'</h3><span>'+(count(down)==null&&count(up)==null?'Veri yok':number((count(down)||0)+(count(up)||0))+' hamle')+'</span></div><div class="ta-split-labels"><span>↓ '+downLabel+' <b>'+number(count(down))+'</b></span><span>↑ '+upLabel+' <b>'+number(count(up))+'</b></span></div><div class="ta-split" aria-label="'+esc(label+': '+number(count(down))+' '+downLabel+', '+number(count(up))+' '+upLabel)+'"><div class="ta-split-half ta-split-left"><i style="width:'+count(down)/max*100+'%"></i></div><div class="ta-split-half ta-split-right"><i style="width:'+count(up)/max*100+'%"></i></div></div></div>').join('');
    return '<div data-trend-chart="directions">'+lanes+'<div class="ta-mix-list">'+[['added','Yeni paket','+'],['removed','Kaldırılan paket','−'],['benefit_change','Fayda / koşul','↔'],['other_change','Diğer değişiklikler','⋯']].map(([key,label,icon])=>'<div><span class="ta-mix-icon" aria-hidden="true">'+icon+'</span><span>'+label+'</span><b>'+number(count(key))+'</b></div>').join('')+'</div></div><p class="ta-footnote">Bir paket hamlesi birden fazla başlıkta yer alabilir.</p>';
  }
  function segments(data){
    const rows=[...(data.segments||[])].sort((a,b)=>Number(b.current)-Number(a.current)||Number(b.previous)-Number(a.previous));
    if(!rows.length)return '<div data-trend-chart="segments">'+empty(data.summary?.move_count==null?'Müşteri grupları için yeterli kayıt yok':'Gruplarda henüz hareket yok','Yeni kayıtlar müşteri gruplarına göre burada karşılaştırılacak.')+'</div>';
    const max=Math.max(1,...rows.flatMap(row=>[Number(row.current)||0,Number(row.previous)||0]));
    return '<div class="ta-legend ta-segment-legend"><span><i class="ta-key ta-key-current"></i>Bu dönem</span><span><i class="ta-key ta-key-previous"></i>Önceki dönem</span></div><div data-trend-chart="segments" class="ta-segment-list">'+rows.map(row=>'<div class="ta-segment-row"><h3>'+esc(row.name)+'</h3><div class="ta-segment-bars"><div class="ta-segment-track"><i class="ta-current" style="width:'+(Number(row.current)||0)/max*100+'%"></i><span>'+number(row.current)+' <small>bu dönem</small></span></div><div class="ta-segment-track"><i class="ta-previous" style="width:'+(Number(row.previous)||0)/max*100+'%"></i><span>'+number(row.previous)+' <small>önceki dönem</small></span></div></div></div>').join('')+'</div><p class="ta-footnote">'+(data.coverage?.comparable?'Eşit uzunluktaki iki dönemde görülen paket hamleleri.':'Önceki dönem kayıtları eksik olabilir; barlar mevcut kayıtları gösterir.')+'</p>';
  }
  function sourceLink(url){try{const parsed=new URL(url);return ['https:','http:'].includes(parsed.protocol)?'<a href="'+esc(parsed.href)+'" target="_blank" rel="noopener noreferrer">Resmi sayfa ↗</a>':''}catch{return ''}}
  function valueRow(row,index,max){
    const width=470,height=52,left=32,right=435,span=right-left;
    const from=Number(row.from_value),to=Number(row.to_value),x=value=>left+Math.max(0,value)/max*span;
    const fromX=x(from),toX=x(to),up=to>from,same=to===from;
    const desc=row.name+': '+number(from,2)+' → '+number(to,2)+' GB / 100 TL';
    const labelOffset=Math.abs(toX-fromX)<54?14:0;
    return '<div class="ta-value-row"><div class="ta-value-name"><h3>'+esc(row.name)+'</h3><span>'+esc(date(row.from_at,true))+' → '+esc(date(row.to_at,true))+'</span></div><svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(desc)+'"><title>'+esc(desc)+'</title><line class="ta-value-baseline" x1="'+left+'" y1="28" x2="'+right+'" y2="28"/><line class="ta-value-change" x1="'+fromX.toFixed(2)+'" y1="28" x2="'+toX.toFixed(2)+'" y2="28"/><circle class="ta-value-before" cx="'+fromX.toFixed(2)+'" cy="28" r="5"/><circle class="ta-value-after" cx="'+toX.toFixed(2)+'" cy="28" r="5"/><text class="ta-value-label ta-value-label-before" x="'+fromX.toFixed(2)+'" y="11" text-anchor="middle">'+number(from,2)+'</text><text class="ta-value-label" x="'+toX.toFixed(2)+'" y="'+(labelOffset?49:11)+'" text-anchor="middle">'+number(to,2)+'</text></svg><strong class="ta-value-delta">'+(same?'Aynı':row.change_pct==null?number(from,2)+' → '+number(to,2):(up?'↑ ':'↓ ')+signed(row.change_pct))+'</strong></div>';
  }
  function valueTable(rows){return '<div class="ta-table-wrap"><table class="ta-value-table"><caption>Değer karşılaştırmasının paket bilgileri</caption><thead><tr><th>Paket</th><th>Önce</th><th>Sonra</th><th>Fiyat</th><th>Süre</th><th>Kaynak</th></tr></thead><tbody>'+rows.map(row=>'<tr><th scope="row">'+esc(row.name)+'</th><td>'+number(row.from_value,2)+' GB/100 TL<small>'+esc(date(row.from_at))+'</small></td><td>'+number(row.to_value,2)+' GB/100 TL<small>'+esc(date(row.to_at))+'</small></td><td>'+number(row.from_price)+' → '+number(row.to_price)+' TL</td><td>'+number(row.validity_days)+' gün</td><td>'+sourceLink(row.source_url)+'</td></tr>').join('')+'</tbody></table></div>'}
  function values(data){
    const info=data.values||{},rows=(info.rows||[]).filter(row=>row.from_value!=null&&row.to_value!=null&&Number.isFinite(Number(row.from_value))&&Number.isFinite(Number(row.to_value))),max=Math.max(1,...rows.flatMap(row=>[Number(row.from_value),Number(row.to_value)]))*1.08;
    const eligible=Number(info.eligible_count)||0,unchanged=Number(info.unchanged_count)||0,excluded=Number(info.excluded_count)||0;
    if(!rows.length)return '<div data-trend-chart="value">'+empty(eligible?'Karşılaştırılabilen paketlerde değer aynı':'Paket değerini karşılaştırmak için yeterli kayıt yok',eligible?number(unchanged||eligible)+' paketin 100 TL başına ana internet değeri aynı kaldı.': 'Aynı paketin aynı süreyle iki fiyat ve internet kaydı oluştuğunda değişimi burada göreceksiniz.')+'</div><p class="ta-footnote">'+number(excluded)+' paket için iki karşılaştırılabilir kayıt bulunamadı. Yeni veya kaldırılan paketler bu hesaba katılmaz.</p>';
    const sorted=[...rows].sort((a,b)=>Math.abs(Number(b.change_pct)||0)-Math.abs(Number(a.change_pct)||0));
    return '<div class="ta-value-intro"><p>100 TL karşılığında alınan ana internet miktarı. Aynı paket ve aynı kullanım süresi karşılaştırılır; bonus internet dahil değildir.</p><div class="ta-legend"><span><i class="ta-key ta-key-before"></i>Önce</span><span><i class="ta-key ta-key-current"></i>Sonra</span></div></div><div data-trend-chart="value" class="ta-value-list">'+sorted.slice(0,6).map((row,index)=>valueRow(row,index,max)).join('')+'</div>'+(sorted.length>6?'<details class="ta-disclosure"><summary>Diğer '+number(sorted.length-6)+' değer değişimini göster</summary>'+sorted.slice(6).map((row,index)=>valueRow(row,index+6,max)).join('')+'</details>':'')+'<div class="ta-value-note"><p>'+number(rows.length)+' pakette değişim · '+number(unchanged)+' pakette aynı değer · '+number(excluded)+' paket için yeterli karşılaştırma yok</p><span>↑ Daha fazla GB / 100 TL &nbsp; ↓ Daha az GB / 100 TL</span></div><details class="ta-disclosure"><summary>Kaynakları ve hesapta kullanılan fiyatları incele</summary>'+valueTable(sorted)+'</details>';
  }
  function render(data){
    const section=ensureSection();if(!section)return;
    const content=section.querySelector('#trendContent');content.dataset.windowDays=String(data.window_days);content.dataset.windowEnd=data.window_end||'';
    content.innerHTML=findings(data)+coverage(data)+'<article class="ta-panel ta-activity-panel"><header class="ta-panel-head"><div><p class="ta-eyebrow">Zaman içindeki hareket</p><h2>Hangi günler hareketliydi?</h2><p>Aynı pakette birlikte değişen bilgiler tek hamle sayılır.</p></div><a href="#competitor" class="ta-context-link">Değişiklikleri aç ↗</a></header>'+activity(data)+'</article><div class="ta-two-up"><article class="ta-panel"><header class="ta-panel-head"><div><p class="ta-eyebrow">Değişimin yönü</p><h2>Fiyat mı, internet mi, koşullar mı?</h2></div></header>'+directions(data)+'</article><article class="ta-panel"><header class="ta-panel-head"><div><p class="ta-eyebrow">Müşteri grupları</p><h2>Hareket nerede yoğunlaştı?</h2></div><a href="#segment" class="ta-context-link">Grupları incele ↗</a></header>'+segments(data)+'</article></div><article class="ta-panel ta-value-panel"><header class="ta-panel-head"><div><p class="ta-eyebrow">Aynı paketin değeri</p><h2>100 TL ile alınan internet nasıl değişti?</h2></div><span class="ta-unit">GB / 100 TL</span></header>'+values(data)+'</article>';
    updateStatus();
  }
  async function request(snapshot,force=false){
    if(!state.authorized||!active()||!snapshot)return;
    const days=Number(snapshot.window_days),end=snapshot.window_end;
    if(![7,30,90].includes(days)||!end)return;
    const key=days+'|'+end;
    if(state.pending?.key===key)return state.pending.promise;
    if(!force&&(state.key===key||state.attemptKey===key)){updateStatus();return state.data}
    state.controller?.abort();const controller=new AbortController(),generation=++state.generation;state.controller=controller;state.loading=true;state.error='';state.attemptKey=key;updateStatus();
    const promise=(async()=>{
      try{
        const response=await fetch('/api/competitive-trends?'+new URLSearchParams({days:String(days),end}),{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw new Error('Trend data unavailable');
        const data=await response.json();
        if(generation!==state.generation)return;
        if(Number(data.window_days)!==days||+new Date(data.window_end)!==+new Date(end)||!Array.isArray(data.activity)||!Array.isArray(data.segments)||!Array.isArray(data.directions))throw new Error('Trend data invalid');
        state.data=data;state.key=key;render(data);return data;
      }catch(error){if(generation!==state.generation||error.name==='AbortError')return;state.error='unavailable';}
      finally{if(generation===state.generation){state.loading=false;state.pending=null;updateStatus()}}
    })();state.pending={key,promise};return promise;
  }
  function onMarket(market){
    if(!state.authorized||!active())return;
    updateStatus();
    if(market.loading){if(state.pending&&Number(market.days)!==Number(state.pending.key.split('|')[0])){state.controller?.abort();state.generation++;state.pending=null;state.loading=false;state.attemptKey=''}return}
    if(market.error){state.error='market';updateStatus();return}
    if(Number(market.snapshot?.window_days)===Number(market.days))request(market.snapshot);
  }
  async function initialize(){
    const user=await Promise.resolve(window.MarketPulseAccess?.ready).catch(()=>null);
    state.authorized=['standard','admin'].includes(user?.role);if(!state.authorized)return;
    ensureSection();window.MarketPulseData?.subscribe(onMarket);
  }
  async function activate(){
    await state.ready;if(!state.authorized||!active())return;ensureSection();
    const market=window.MarketPulseData?.getState();
    if(market?.loading||Number(market?.snapshot?.window_days)!==Number(market?.days))await window.MarketPulseData?.ensure();
    const current=window.MarketPulseData?.getState();if(current?.error){state.error='market';updateStatus();return}
    return request(current?.snapshot);
  }
  async function retry(){
    await state.ready;if(!state.authorized||!active())return;
    state.error='';state.attemptKey='';
    const market=window.MarketPulseData?.getState();
    if(market?.error||!market?.snapshot||Number(market.snapshot.window_days)!==Number(market.days)){await window.MarketPulseData?.refresh({force:true});return activate()}
    return request(market.snapshot,true);
  }
  window.MarketPulseTrends={activate,retry};state.ready=initialize();
})();
