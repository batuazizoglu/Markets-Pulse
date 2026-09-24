(()=>{
  const periods=[7,30,90],listeners=new Set();
  let days=30,snapshot=null,error='',loading=false,generation=0,pending=null;
  const getState=()=>({days,snapshot,error,loading});
  function notify(){
    for(const button of document.querySelectorAll('[data-market-days]')){
      const active=Number(button.dataset.marketDays)===days;
      button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    }
    for(const listener of listeners){try{listener(getState())}catch(e){console.error('Market view render failed',e)}}
  }
  function subscribe(listener){listeners.add(listener);listener(getState());return()=>listeners.delete(listener)}
  function refresh({force=false}={}){
    if(pending?.days===days&&!force)return pending.promise;
    const requestedDays=days,requestGeneration=++generation;
    loading=true;error='';
    const promise=(async()=>{
      try{
        const response=await fetch('/api/market-pulse?days='+requestedDays,{cache:'no-store'});
        if(!response.ok)throw new Error('Market snapshot unavailable');
        const data=await response.json();
        if(!Array.isArray(data.changes)||!Array.isArray(data.moves)||Number(data.window_days)!==requestedDays)throw new Error('Market snapshot invalid');
        if(requestGeneration!==generation)return snapshot;
        snapshot=data;return snapshot;
      }catch(e){if(requestGeneration===generation){error='Rakip verileri yenilenemedi. Yenile düğmesiyle tekrar deneyin.';console.error('Market refresh failed',e)}return null}
      finally{if(requestGeneration===generation){loading=false;pending=null;notify()}}
    })();
    pending={days:requestedDays,promise};notify();return promise;
  }
  function ensure(){return pending?.days===days?pending.promise:snapshot?.window_days===days?Promise.resolve(snapshot):refresh()}
  function selectDays(value){const next=Number(value);if(!periods.includes(next))return Promise.resolve(snapshot);if(next===days)return ensure();days=next;return refresh()}
  function stamp(value){return value&&Number.isFinite(+new Date(value))?new Intl.DateTimeFormat('tr-TR',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Famagusta'}).format(new Date(value)):'—'}
  function statusText(state=getState()){
    const data=state.snapshot;
    if(!window.MarketPulseAccess?.isAdmin()){
      const period=data?'Son '+data.window_days+' gün · Güncelleme: '+stamp(data.generated_at):'Veriler yükleniyor.';
      return (state.error?'Güncelleme yapılamadı. '+(data?'Son veriler gösteriliyor. ':'Yeniden deneyin. '):state.loading?'Güncelleniyor… ':'')+period;
    }
    const period=data?'Son '+data.window_days+' gün • '+stamp(data.window_start)+' – '+stamp(data.window_end)+' • KKTC saati • Son güncelleme: '+stamp(data.generated_at):'Henüz başarılı veri yüklemesi yok.';
    return (state.error?state.error+' '+(data?'Son başarılı veriler gösteriliyor. ':''):state.loading?state.days+' günlük veriler yenileniyor. ':'')+period;
  }
  const fieldLabels={data_gb:'Data',bonus_data_gb:'Bonus Data',local_tr_minutes:'Ada İçi + Türkiye DK',international_minutes:'Uluslararası DK',sms:'SMS',validity_days:'Geçerlilik',price_try:'Fiyat',name:'Paket Adı',extras_json:'Ek Fayda / Koşul','Data':'Data','Bonus Data':'Bonus Data','Ada İçi + TR Dakika':'Ada İçi + TR Dakika','Uluslararası Dakika':'Uluslararası Dakika','Geçerlilik (gün)':'Geçerlilik','Fiyat':'Fiyat'};
  function valueText(value){if(value==null||value==='')return '—';if(typeof value==='object')return JSON.stringify(value);return String(value)}
  function changeText(change){
    if(change.change_type==='added')return 'Yeni paket eklendi'+(change.new_value?' • '+valueText(change.new_value):'');
    if(change.change_type==='removed')return 'Paket kaldırıldı / görünmüyor'+(change.old_value?' • '+valueText(change.old_value):'');
    return (fieldLabels[change.field_name]||change.field_name||'Alan')+': '+valueText(change.old_value)+' → '+valueText(change.new_value);
  }
  function orderedMoves(data,order='priority'){
    const recent=(a,b)=>new Date(b.detected_at)-new Date(a.detected_at)||String(b.key).localeCompare(String(a.key),'en',{numeric:true});
    return [...(data?.moves||[])].sort(order==='recent'?recent:(a,b)=>Number(b.threat)-Number(a.threat)||recent(a,b));
  }
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function benefitLines(value){
    let parsed=value;try{parsed=JSON.parse(value)}catch{}
    if(Array.isArray(parsed))return parsed.map(valueText);
    if(parsed&&typeof parsed==='object')return Object.entries(parsed).map(([key,value])=>key+': '+(Array.isArray(value)?value.map(valueText).join(', '):valueText(value)));
    return [valueText(parsed)];
  }
  function changeMarkup(change){
    if(window.MarketPulseAccess?.isAdmin()||change.change_type!=='field_changed'||!/extras|ek fayda|koşul/i.test(change.field_name||''))return escape(changeText(change));
    const values=(label,value)=>'<div><strong>'+label+'</strong><ul>'+benefitLines(value).map(line=>'<li>'+escape(line)+'</li>').join('')+'</ul></div>';
    return '<details class="change-detail"><summary>Ek faydalar ve koşullar değişti</summary><div class="change-values">'+values('Önce',change.old_value)+values('Şimdi',change.new_value)+'</div></details>';
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-market-days]');if(button)selectDays(button.dataset.marketDays)});
  window.MarketPulseData={getState,subscribe,refresh,ensure,selectDays,statusText,changeText,changeMarkup,orderedMoves};
})();
