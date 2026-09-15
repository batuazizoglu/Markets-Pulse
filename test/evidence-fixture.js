import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import zlib from 'node:zlib';
import { SCHEMA_SQL } from '../src/schema.js';

export async function createEvidenceFixture({count=75}={}) {
  const db=new PGlite();await db.exec(SCHEMA_SQL);
  // pg returns BYTEA as Buffer; normalize PGlite's Uint8Array at this test boundary.
  const pool={async query(sql,values){const result=await db.query(sql,values);for(const row of result.rows)for(const [key,value] of Object.entries(row))if(value instanceof Uint8Array)row[key]=Buffer.from(value);return result;}};
  const full=await readFile(new URL('./fixtures/full.png',import.meta.url)),focus=await readFile(new URL('./fixtures/focus.png',import.meta.url));
  const sources=[['faturali','Faturalı'],['faturasiz','Faturasız'],['diger-faturali','Diğer Faturalı Tarifeler']];
  for(let i=0;i<sources.length;i++)await pool.query('INSERT INTO sources(id,slug,name,url) VALUES($1,$2,$3,$4)',[i+1,...sources[i],'https://www.kktctelsim.com/tr/tarifeler/tarifeler/'+sources[i][0]]);
  for(let i=1;i<=count;i++){
    const source=(i-1)%3+1,time=new Date(Date.UTC(2026,8,15,5)-Math.floor((i-1)/3)*86400000).toISOString();
    const kind=i>count-3?'baseline':i%4===0?'change':'daily',missing=i%7===0;
    const packages=[{name:source===2?'Havalimanı e-SIM 20 GB':source===3?"Öğrenci 'Özel' 20 GB":'Super Red 20 GB',data_gb:20,price_try:699,local_tr_minutes:1000,sms:1000,red_passport_days:3,extras_json:['30 günlük kullanım']},{name:'Super Red Plus 50 GB',data_gb:50,price_try:999,local_tr_minutes:1000,sms:1000},{name:'Super Red Max 100 GB',data_gb:100,price_try:1499,local_tr_minutes:1000,sms:1000}];
    await pool.query("INSERT INTO scans(id,source_id,started_at,status,parsed_count) VALUES($1,$2,$3,'ok',3)",[i,source,time]);
    await pool.query(`INSERT INTO snapshots(id,source_id,scan_id,captured_at,kind,page_hash,html_gzip,extracted_json,screenshot_png,focused_screenshot_png,screenshot_error,focused_screenshot_error,screenshot_meta)
      VALUES($1,$2,$1,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb)`,[i,source,time,kind,'test-hash-'+i,zlib.gzipSync(Buffer.from('<html><body>Arşiv örneği<script>alert("never execute")</script></body></html>')),JSON.stringify(packages),missing&&i%2===0?null:full,missing?null:focus,missing?'Örnek yakalama hatası':null,missing?'Paket alanı bulunamadı':null,JSON.stringify({focus_card_count:3,cookie_removed:1})]);
    if(kind==='change')await pool.query("INSERT INTO changes(source_id,scan_id,detected_at,change_type,field_name,old_value,new_value,severity) VALUES($1,$2,$3,'field_changed','Fiyat','599','699','critical')",[source,i,time]);
  }
  return {db,pool};
}
