import archiver from 'archiver';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const TZ = 'Asia/Famagusta';
const BASE = `FROM snapshots sn JOIN sources s ON s.id=sn.source_id JOIN scans sc ON sc.id=sn.scan_id`;
const FLAGS = {
  has_focus: 'COALESCE(octet_length(sn.focused_screenshot_png),0)>0',
  has_screenshot: 'COALESCE(octet_length(sn.screenshot_png),0)>0',
  has_html: 'COALESCE(octet_length(sn.html_gzip),0)>0',
  has_json: "sn.extracted_json IS NOT NULL AND sn.extracted_json<>'null'::jsonb"
};
const COMPLETE = Object.values(FLAGS).map(x=>`(${x})`).join(' AND ');
const COLUMNS = `sn.id,sn.source_id,sn.scan_id,sn.captured_at,sn.kind,sn.page_hash,
  sn.screenshot_error,sn.focused_screenshot_error,sn.screenshot_meta,
  ${Object.entries(FLAGS).map(([key,value])=>`(${value}) ${key}`).join(',')},
  s.slug source_slug,s.name source_name,s.url source_url,sc.parsed_count,
  (SELECT count(*)::int FROM changes c WHERE c.scan_id=sn.scan_id AND c.source_id=sn.source_id) change_count`;
const safeArray = `CASE WHEN jsonb_typeof(sn.extracted_json)='array' THEN sn.extracted_json ELSE '[]'::jsonb END`;
const fail = (message,status=400) => Object.assign(new Error(message),{status});
const fold = value => value.toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g,c=>({'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u'}[c]));
const sqlFold = value => `translate(lower(${value}),'çğıöşüİ','cgiosui')`;

function scalar(query,key,fallback='') {
  if(query[key] == null) return fallback;
  if(typeof query[key] !== 'string') throw fail('Geçersiz filtre: '+key);
  return query[key].trim();
}
function integer(value,fallback,max) {
  if(value==='') return fallback;
  if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>max) throw fail('Geçersiz sayfa veya kayıt sayısı.');
  return Number(value);
}
function recordId(value) {
  if(!/^[1-9]\d{0,18}$/.test(String(value))||BigInt(value)>9223372036854775807n) throw fail('Geçersiz kayıt numarası.');
  return String(value);
}
function day(value) {
  if(!value) return '';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value) throw fail('Geçerli bir tarih seçin.');
  return value;
}
export function archiveFilters(query={}) {
  const values=[],conditions=[];
  const bind=value=>{values.push(value);return '$'+values.length;};
  const q=scalar(query,'q'),source=scalar(query,'source'),kind=scalar(query,'kind'),availability=scalar(query,'availability');
  const from=day(scalar(query,'from')),to=day(scalar(query,'to'));
  if(q.length>160||source.length>100) throw fail('Arama metni çok uzun.');
  if(from&&to&&from>to) throw fail('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
  if(q){
    const p=bind('%'+fold(q).replace(/[\\%_]/g,'\\$&')+'%');
    conditions.push(`(${sqlFold('s.name')} LIKE ${p} OR sn.id::text=${bind(q)} OR EXISTS (SELECT 1 FROM jsonb_array_elements(${safeArray}) card WHERE ${sqlFold("COALESCE(card->>'name','')")} LIKE ${p}))`);
  }
  if(source) conditions.push(`s.slug=${bind(source)}`);
  if(kind){if(!['change','daily','baseline'].includes(kind)) throw fail('Geçersiz kayıt türü.');conditions.push(`sn.kind=${bind(kind)}`);}
  if(availability){
    if(!['complete','missing','visual','no_visual'].includes(availability)) throw fail('Geçersiz dosya durumu.');
    conditions.push(availability==='complete'?`(${COMPLETE})`:availability==='missing'?`NOT (${COMPLETE})`:availability==='visual'?`((${FLAGS.has_focus}) OR (${FLAGS.has_screenshot}))`:`NOT ((${FLAGS.has_focus}) OR (${FLAGS.has_screenshot}))`);
  }
  if(from) conditions.push(`sn.captured_at>=(${bind(from)}::date::timestamp AT TIME ZONE '${TZ}')`);
  if(to) conditions.push(`sn.captured_at<((${bind(to)}::date+1)::timestamp AT TIME ZONE '${TZ}')`);
  return {where:conditions.length?'WHERE '+conditions.join(' AND '):'',values,
    page:integer(scalar(query,'page'),1,1000000),limit:integer(scalar(query,'limit'),24,100)};
}

const route = fn => async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status&&!res.headersSent)res.status(e.status).json({error:e.message});else next(e);}};

export function registerEvidenceRoutes(app,pool) {
  // Mounted after registerAuth; keep an explicit guard for all archive entry points.
  app.use(['/api/evidence','/api/snapshots'],(req,res,next)=>req.appUser?next():res.status(401).json({error:'Oturum gerekli'}));

  app.get('/api/evidence',route(async(req,res)=>{
    const f=archiveFilters(req.query);
    const summary=(await pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE ${COMPLETE})::int complete,
      count(*) FILTER(WHERE sn.kind='change')::int changed,min(sn.captured_at) oldest,max(sn.captured_at) newest ${BASE} ${f.where}`,f.values)).rows[0];
    const pages=Math.max(1,Math.ceil(summary.total/f.limit)),page=Math.min(f.page,pages);
    const rows=await pool.query(`SELECT ${COLUMNS},
      ARRAY(SELECT card->>'name' FROM jsonb_array_elements(${safeArray}) card WHERE card->>'name' IS NOT NULL LIMIT 3) package_names
      ${BASE} ${f.where} ORDER BY sn.captured_at DESC,sn.id DESC LIMIT $${f.values.length+1} OFFSET $${f.values.length+2}`,
      [...f.values,f.limit,(page-1)*f.limit]);
    const sources=await pool.query(`SELECT s.slug,s.name,count(sn.id)::int count FROM sources s JOIN snapshots sn ON sn.source_id=s.id GROUP BY s.id,s.slug,s.name ORDER BY s.name`);
    res.set('Cache-Control','private, no-store').json({items:rows.rows,page,pages,page_size:f.limit,total:summary.total,
      summary:{...summary,missing:summary.total-summary.complete},sources:sources.rows,timezone:TZ});
  }));

  app.get('/api/evidence/export',route(async(req,res)=>{
    const raw=scalar(req.query,'ids');
    if(!raw||raw.split(',').length>10) throw fail('Bir defada 1–10 kayıt seçin.');
    const ids=[...new Set(raw.split(',').map(recordId))];
    const size=(await pool.query(`SELECT count(*)::int count,COALESCE(sum(COALESCE(octet_length(screenshot_png),0)+COALESCE(octet_length(focused_screenshot_png),0)+COALESCE(octet_length(html_gzip),0)+COALESCE(octet_length(extracted_json::text),0)),0)::bigint bytes FROM snapshots WHERE id=ANY($1::bigint[])`,[ids])).rows[0];
    if(size.count!==ids.length) throw fail('Seçilen kayıtlardan biri bulunamadı.',404);
    if(Number(size.bytes)>128*1024*1024) throw fail('Seçim çok büyük. Daha az kayıt seçin.',413);
    const rows=(await pool.query(`SELECT ${COLUMNS},sn.screenshot_png,sn.focused_screenshot_png,sn.html_gzip,sn.extracted_json ${BASE} WHERE sn.id=ANY($1::bigint[]) ORDER BY sn.captured_at DESC,sn.id DESC`,[ids])).rows;
    const files=[],manifest={generated_at:new Date().toISOString(),timezone:TZ,records:[]};
    let total=0;
    for(const row of rows){
      const base=`${String(row.source_slug).replace(/[^a-z0-9_-]/gi,'-')}/${new Date(row.captured_at).toISOString().replace(/[:.]/g,'-')}-${row.id}/`;
      const entry={id:String(row.id),source:row.source_name,url:row.source_url,captured_at:row.captured_at,kind:row.kind,page_hash:row.page_hash,files:[],missing:[],screenshot_meta:row.screenshot_meta};
      const add=(name,buffer)=>{
        if(!buffer?.length){entry.missing.push(name);return;}
        total+=buffer.length;if(total>192*1024*1024)throw fail('Seçim çok büyük. Daha az kayıt seçin.',413);
        files.push({name:base+name,buffer});entry.files.push({name,bytes:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex')});
      };
      add('paket-gorunumu.png',row.focused_screenshot_png);
      add('tam-sayfa.png',row.screenshot_png);
      if(row.html_gzip?.length){
        try{add('sayfa.html',zlib.gunzipSync(row.html_gzip,{maxOutputLength:32*1024*1024}));}
        catch(e){if(e.status)throw e;throw fail(`Kayıt #${row.id}: HTML dosyası açılamadı.`,422);}
      }else entry.missing.push('sayfa.html');
      add('paketler.json',row.extracted_json==null?null:Buffer.from(JSON.stringify(row.extracted_json,null,2)));
      const changes=await pool.query('SELECT detected_at,change_type,field_name,old_value,new_value,severity,product_id FROM changes WHERE scan_id=$1 AND source_id=$2 ORDER BY id',[row.scan_id,row.source_id]);
      add('degisiklikler.json',Buffer.from(JSON.stringify(changes.rows,null,2)));
      files.push({name:base+'kayit.json',buffer:Buffer.from(JSON.stringify(entry,null,2))});manifest.records.push(entry);
    }
    const zip=archiver('zip',{zlib:{level:6}});
    zip.on('error',error=>res.destroy(error));
    res.on('close',()=>{if(!res.writableEnded)zip.abort();});
    res.set({'Content-Type':'application/zip','Content-Disposition':`attachment; filename="markets-pulse-kanit-${ids.length===1?ids[0]:ids.length+'-kayit'}.zip"`,'Cache-Control':'private, no-store'});
    zip.pipe(res);
    zip.append(JSON.stringify(manifest,null,2),{name:'manifest.json'});
    for(const file of files)zip.append(file.buffer,{name:file.name});
    await zip.finalize();
  }));

  app.get('/api/evidence/:id',route(async(req,res)=>{
    const id=recordId(req.params.id);
    const row=(await pool.query(`SELECT ${COLUMNS},sn.extracted_json ${BASE} WHERE sn.id=$1`,[id])).rows[0];
    if(!row) throw fail('Kanıt kaydı bulunamadı.',404);
    const previous=(await pool.query(`SELECT ${COLUMNS} ${BASE} WHERE sn.source_id=$1 AND (sn.captured_at,sn.id)<($2::timestamptz,$3::bigint) ORDER BY sn.captured_at DESC,sn.id DESC LIMIT 1`,[row.source_id,row.captured_at,id])).rows[0]||null;
    const changes=(await pool.query(`SELECT c.id,c.detected_at,c.change_type,c.field_name,c.old_value,c.new_value,c.severity,c.product_id,
      COALESCE(v.name,p.current_name) product_name FROM changes c LEFT JOIN products p ON p.id=c.product_id
      LEFT JOIN LATERAL(SELECT name FROM product_versions WHERE product_id=c.product_id AND captured_at<=c.detected_at ORDER BY captured_at DESC,id DESC LIMIT 1) v ON TRUE
      WHERE c.scan_id=$1 AND c.source_id=$2 ORDER BY c.id`,[row.scan_id,row.source_id])).rows;
    const packages=Array.isArray(row.extracted_json)?row.extracted_json:[];
    delete row.extracted_json;
    res.set('Cache-Control','private, no-store').json({...row,packages,changes,previous});
  }));

  // Preserve the legacy response for clients outside the new archive view.
  app.get('/api/snapshots',route(async(req,res)=>{
    res.json((await pool.query(`SELECT ${COLUMNS} ${BASE} ORDER BY sn.captured_at DESC,sn.id DESC LIMIT 100`)).rows);
  }));
  const assets={image:['screenshot_png','image/png','tam-sayfa.png'],focus:['focused_screenshot_png','image/png','paket-gorunumu.png'],html:['html_gzip','text/plain; charset=utf-8','sayfa.html'],json:['extracted_json','application/json; charset=utf-8','paketler.json']};
  for(const [mode,[column,type,name]] of Object.entries(assets)) app.get('/api/snapshots/:id/'+mode,route(async(req,res)=>{
    const id=recordId(req.params.id),row=(await pool.query(`SELECT ${column} asset FROM snapshots WHERE id=$1`,[id])).rows[0];
    if(row?.asset==null||(Buffer.isBuffer(row.asset)&&!row.asset.length)) throw fail('Bu kayıtta istenen dosya bulunmuyor.',404);
    let data=row.asset;
    if(mode==='html')data=zlib.gunzipSync(data,{maxOutputLength:32*1024*1024});
    if(mode==='json')data=JSON.stringify(data,null,2);
    res.set({'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=3600',
      'Content-Disposition':`${req.query.download==='1'?'attachment':'inline'}; filename="kanit-${id}-${name}"`});
    res.send(data);
  }));
}
