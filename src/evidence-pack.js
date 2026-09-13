import archiver from 'archiver';
import zlib from 'zlib';
import { PassThrough } from 'stream';
import { buildReportContext } from './report-data.js';
import { renderReportHtml } from './report-render.js';
import puppeteer from 'puppeteer';

function csvValue(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}
function localStamp(v){return new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Famagusta',dateStyle:'short',timeStyle:'short'}).format(new Date(v));}
function slugStamp(v=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Famagusta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v)).replace(/-/g,'');}
function changesCsv(rows){
  const head=['Tarih','Kaynak','Paket','Tip','Alan','Önce','Sonra','Önem'];
  const body=rows.map(c=>[localStamp(c.detected_at),c.source_name,c.product_name||'',c.change_type,c.field_name||'',c.old_value||'',c.new_value||'',c.severity].map(csvValue).join(','));
  return [head.map(csvValue).join(','),...body].join('\n');
}
async function zipToBuffer(build){
  const output=new PassThrough(),chunks=[];
  output.on('data',c=>chunks.push(c));
  const done=new Promise((resolve,reject)=>{output.on('end',resolve);output.on('error',reject);});
  const zip=archiver('zip',{zlib:{level:9}});
  zip.on('error',e=>output.destroy(e));zip.pipe(output);
  await build(zip);await zip.finalize();await done;
  return Buffer.concat(chunks);
}
async function pdfFromHtml(html){
  const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
  const page=await browser.newPage();
  try{
    await page.setContent(html,{waitUntil:'networkidle0',timeout:60000});
    return await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,margin:{top:'0',right:'0',bottom:'0',left:'0'}});
  }finally{await page.close().catch(()=>{});await browser.close().catch(()=>{});}
}
export async function generateEvidencePack(pool,options={}){
  const days=Math.max(1,Math.min(30,Number(options.days||7)));
  const ctx=await buildReportContext(pool,'evidence',{days});
  const summaryCtx=Object.assign({},ctx,{type:'telsim7',title:'Son 7 Günde Telsim Ne Yaptı?'});
  const pdf=await pdfFromHtml(renderReportHtml(summaryCtx));
  const manifest={
    generated_at:ctx.generated_at,period_start:ctx.period_start,period_end:ctx.period_end,days,
    report:'Market Pulse Evidence Pack',snapshot_count:ctx.evidence.length,change_count:ctx.changes.length,
    note:'Focused package images are included for every available snapshot. Full-page images are included for change/baseline snapshots or when no focused image exists.'
  };
  const buffer=await zipToBuffer(async zip=>{
    zip.append(pdf,{name:'00-report/son-7-gunde-telsim-ne-yapti.pdf'});
    zip.append(JSON.stringify(manifest,null,2),{name:'00-report/manifest.json'});
    zip.append(changesCsv(ctx.changes),{name:'00-report/changes.csv'});
    for(const x of ctx.evidence){
      const stamp=new Date(x.captured_at).toISOString().replace(/[:.]/g,'-');
      const base='evidence/'+String(x.source_slug||'source')+'/'+stamp+'-snapshot-'+x.id+'/';
      if(x.focused_screenshot_png)zip.append(x.focused_screenshot_png,{name:base+'package-focus.png'});
      if(x.screenshot_png&&(x.kind==='change'||x.kind==='baseline'||!x.focused_screenshot_png))zip.append(x.screenshot_png,{name:base+'full-page.png'});
      if(x.extracted_json)zip.append(JSON.stringify(x.extracted_json,null,2),{name:base+'extracted.json'});
      if(x.html_gzip){try{zip.append(zlib.gunzipSync(x.html_gzip),{name:base+'page.html'});}catch{}}
      zip.append(JSON.stringify({id:x.id,source:x.source_name,url:x.source_url,captured_at:x.captured_at,kind:x.kind,page_hash:x.page_hash,screenshot_meta:x.screenshot_meta},null,2),{name:base+'metadata.json'});
    }
  });
  return {buffer,ctx,fileName:'market-pulse-evidence-pack-'+slugStamp(ctx.period_end)+'.zip',contentType:'application/zip'};
}
