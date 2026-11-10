import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {SCHEMA_SQL} from '../src/schema.js';
import {deliverGsmChangeNotification,getGsmEmailFailureDiagnostics,gsmChangeEmailHtml,gsmChangePlainText,gsmChangeSubject,queueGsmChangeNotification,queueUnnotifiedGsmChanges,recoverEmptyAttachmentNotifications} from '../src/gsm-change-email.js';

let db;
const firstAt='2030-07-02T08:03:00.000Z',retryAt='2030-07-02T09:03:00.000Z';
before(async()=>{
  db=new PGlite();await db.exec(SCHEMA_SQL);
  await db.query("INSERT INTO sources(id,slug,name,url) VALUES(1,'faturali','Faturalı','https://synthetic.example/faturali')");
  await db.query("INSERT INTO scans(id,source_id,started_at,finished_at,status) VALUES(1,1,$1,$1,'ok'),(2,1,$2,$2,'ok'),(3,1,$3,$3,'ok'),(4,1,$4,$4,'ok'),(5,1,$5,$5,'ok')",[firstAt,'2030-07-02T08:33:00.000Z',retryAt,'2030-07-02T10:03:00.000Z','2030-07-02T11:03:00.000Z']);
  await db.query(`INSERT INTO products(id,source_id,identity_base,current_name,first_seen_at,last_seen_at,active)
    VALUES(1,1,'red-20','Red 20 GB <script>','2030-07-01T08:00:00Z',$1,TRUE),(2,1,'yeni-50','Yeni 50 GB',$1,$1,TRUE)`,[firstAt]);
  await db.query(`INSERT INTO product_versions(product_id,scan_id,captured_at,name,price_try,extras_json,product_hash)
    VALUES(1,1,$1,'Red 20 GB <script>',699,'["Sosyal medya faydası"]'::jsonb,'red-1'),(2,1,$1,'Yeni 50 GB',899,'[]'::jsonb,'new-1')`,[firstAt]);
  await db.query(`INSERT INTO changes(id,source_id,product_id,detected_at,change_type,field_name,old_value,new_value,severity,scan_id) VALUES
    (1,1,1,$1,'field_changed','Fiyat','599','699','critical',1),
    (2,1,1,$1,'field_changed','Ek Fayda / Koşul','["Eski fayda"]','["Sosyal medya faydası"]','medium',1),
    (3,1,2,$1,'added',NULL,NULL,'Yeni 50 GB','critical',1),
    (4,1,1,$2,'field_changed','Data','20','25','high',3),
    (5,1,1,'2030-07-02T10:03:00Z','field_changed','SMS','500','1000','medium',4),
    (6,1,1,'2030-07-02T11:03:00Z','field_changed','Uluslararası Dakika','50','100','high',5)`,[firstAt,retryAt]);
});
after(async()=>db?.close());

test('failure diagnostics are read-only, omit sent records and redact personal data and credentials',async()=>{
  const error='Brevo API gönderim hatası (400): invalid sender person@example.com api-key=synthetic-secret https://example.com/private '+ 'x'.repeat(60);
  await db.query(`INSERT INTO gsm_change_notifications(batch_key,scan_ids,change_ids,status,last_error)
    VALUES('diagnostic-failed','{}','{}','failed',$1),('diagnostic-sent','{}','{}','sent',$1)`,[error]);
  const rows=await getGsmEmailFailureDiagnostics(db);
  assert.equal(rows.length,1);assert.equal(rows[0].batch_key,'diagnostic-failed');
  assert.match(rows[0].error,/invalid sender \[email\] \[credential\] \[url\] \[token\]/);
  assert.doesNotMatch(JSON.stringify(rows),/person@example|synthetic-secret|example.com\/private|x{40}/);
  assert.equal((await db.query("SELECT last_error FROM gsm_change_notifications WHERE batch_key='diagnostic-failed'")).rows[0].last_error,error);
  await db.query("DELETE FROM gsm_change_notifications WHERE batch_key LIKE 'diagnostic-%'");
});

test('empty-attachment repair requeues only confirmed rejected deliveries once and preserves history',async()=>{
  const cases=[
    ['repair-rejected','failed','Brevo API gönderim hatası (400): attachment is empty',null,null],
    ['repair-pending','pending','Brevo API gönderim hatası (400): attachment is empty',null,null],
    ['repair-sent','sent','Brevo API gönderim hatası (400): attachment is empty',firstAt,'accepted-id'],
    ['repair-ambiguous','failed','Brevo API bağlantı hatası: fetch failed',null,null],
    ['repair-other','failed','Brevo API gönderim hatası (400): sender is invalid',null,null],
    ['repair-auth','failed','Brevo API gönderim hatası (401): attachment empty',null,null],
    ['repair-sending','sending','Brevo API gönderim hatası (400): attachment is empty',null,null],
    ['repair-missing','failed','Brevo API gönderim hatası (400): attachment is missing',null,null]
  ];
  for(const [key,status,error,sentAt,messageId] of cases)await db.query(`INSERT INTO gsm_change_notifications(batch_key,scan_ids,change_ids,status,attempt_count,last_error,sent_at,message_id)
    VALUES($1,'{}','{999}',$2,6,$3,$4,$5)`,[key,status,error,sentAt,messageId]);
  const repaired=await recoverEmptyAttachmentNotifications(db,{now:new Date(retryAt)});
  assert.deepEqual(repaired.map(x=>x.batch_key).sort(),['repair-missing','repair-pending','repair-rejected']);
  const row=(await db.query("SELECT * FROM gsm_change_notifications WHERE batch_key='repair-rejected'")).rows[0];
  assert.equal(row.status,'pending');assert.equal(row.attempt_count,0);assert.equal(row.attachment_repair_applied,true);
  assert.match(row.last_error,/attachment is empty/);assert.equal(new Date(row.next_attempt_at).toISOString(),retryAt);
  await db.query("UPDATE gsm_change_notifications SET status='failed',attempt_count=6 WHERE batch_key='repair-rejected'");
  await db.exec(SCHEMA_SQL);
  assert.deepEqual(await recoverEmptyAttachmentNotifications(db,{now:new Date(retryAt)}),[],'schema reapplication cannot replay the one-time repair');
  for(const [key,status] of cases.slice(2,-1))assert.equal((await db.query('SELECT status FROM gsm_change_notifications WHERE batch_key=$1',[key])).rows[0].status,status);
  const missing=(await db.query("SELECT status,attempt_count,attachment_repair_applied FROM gsm_change_notifications WHERE batch_key='repair-missing'")).rows[0];
  assert.deepEqual(missing,{status:'pending',attempt_count:0,attachment_repair_applied:true});
  await db.query("DELETE FROM gsm_change_notifications WHERE batch_key LIKE 'repair-%'");
});

test('GSM alert is a compact escaped timeline table with matching plain text and dynamic subject',async()=>{
  const rows=(await db.query(`SELECT c.*,s.name source_name,p.current_name product_name FROM changes c JOIN sources s ON s.id=c.source_id LEFT JOIN products p ON p.id=c.product_id WHERE c.scan_id=1 ORDER BY c.id`)).rows;
  const html=gsmChangeEmailHtml(rows),text=gsmChangePlainText(rows),subject=gsmChangeSubject(rows),dom=new JSDOM(html);
  assert.equal(dom.window.document.querySelectorAll('.gsm-change-row').length,3);
  assert.equal(dom.window.document.querySelectorAll('img').length,0);
  assert.match(dom.window.document.querySelector('table[aria-label]').textContent,/Saat.*Paket.*Değişiklik.*Önce.*Sonra/s);
  assert.match(dom.window.document.body.textContent,/599 TL.*699 TL/s);
  assert.match(dom.window.document.body.textContent,/Eski fayda.*Sosyal medya faydası/s);
  assert.doesNotMatch(html,/<script>(?![\s\S]*<\/script>)/);
  assert.ok(!html.includes('Red 20 GB <script>'));
  assert.doesNotMatch(html,/Ekli rapor|PDF|Reklam radarı/);
  assert.match(text,/SAAT \| PAKET \| DEĞİŞİKLİK \| ÖNCE → SONRA/);
  assert.match(text,/599 TL → 699 TL/);assert.match(subject,/GSM \| 3 değişiklik \| 11:03/);
  dom.window.close();
});

test('a completed scan queues one durable batch, sends it once and records masked delivery metadata',async()=>{
  const sent=[];
  const sendEmail=async(_pool,message)=>{sent.push(message);return {message_id:'gsm-message-1',recipients:['8 kişi'],recipient_count:8,subject:message.subject,total_bytes:Buffer.byteLength(message.htmlContent+message.textContent),delivery_mode:'brevo-api'}};
  const queued=await queueGsmChangeNotification(db,[1],{trigger:'scheduled',now:new Date('2030-07-02T08:04:00Z')});
  assert.equal(queued.status,'pending');assert.equal(queued.queued,true);assert.equal(queued.change_count,3);
  const result=await deliverGsmChangeNotification(db,queued.batch_key,{sendEmail,now:new Date('2030-07-02T08:04:01Z')});
  assert.equal(result.status,'sent');assert.equal(result.delivered,true);assert.equal(result.recipient_count,8);assert.equal(sent.length,1);
  assert.deepEqual(sent[0].headers,{'X-Markets-Pulse-Type':'gsm-change','X-Markets-Pulse-Batch':queued.batch_key});
  const duplicate=await queueGsmChangeNotification(db,[1],{trigger:'manual',now:new Date('2030-07-02T08:05:00Z')});
  assert.equal(duplicate.status,'sent');assert.equal(duplicate.queued,false);
  const skipped=await deliverGsmChangeNotification(db,queued.batch_key,{sendEmail,now:new Date('2030-07-02T08:05:01Z')});
  assert.equal(skipped.status,'sent');assert.equal(skipped.delivered,false);assert.equal(sent.length,1);
  const notification=(await db.query('SELECT * FROM gsm_change_notifications WHERE batch_key=$1',[queued.batch_key])).rows[0];
  assert.equal(notification.status,'sent');assert.equal(notification.recipient_count,8);assert.equal(notification.message_id,'gsm-message-1');
  const run=(await db.query("SELECT * FROM report_runs WHERE report_type='gsm-change'")).rows[0];
  assert.deepEqual(run.recipients,['8 kişi']);assert.equal(run.delivery_status,'sent');assert.equal(run.trigger_type,'scheduled');assert.equal(run.meta_json.change_count,3);
  assert.equal((await queueGsmChangeNotification(db,[2],{now:new Date('2030-07-02T08:34:00Z')})).status,'no_changes');
});

test('failed delivery stays pending, respects backoff and succeeds without creating a duplicate batch',async()=>{
  const queued=await queueGsmChangeNotification(db,[3],{trigger:'manual',now:new Date('2030-07-02T09:04:00Z')});
  let calls=0;
  const fail=async()=>{calls++;throw new Error('Synthetic Brevo timeout')};
  const first=await deliverGsmChangeNotification(db,queued.batch_key,{sendEmail:fail,now:new Date('2030-07-02T09:04:01Z')});
  assert.equal(first.status,'pending');assert.equal(first.attempt_count,1);assert.equal(calls,1);
  const early=await deliverGsmChangeNotification(db,queued.batch_key,{sendEmail:fail,now:new Date('2030-07-02T09:04:30Z')});
  assert.equal(early.status,'pending');assert.equal(early.delivered,false);assert.equal(calls,1);
  const success=async(_pool,message)=>{calls++;return {message_id:'gsm-message-2',recipients:['8 kişi'],recipient_count:8,subject:message.subject,total_bytes:100,delivery_mode:'brevo-api'}};
  const retried=await deliverGsmChangeNotification(db,queued.batch_key,{sendEmail:success,now:new Date('2030-07-02T09:05:02Z')});
  assert.equal(retried.status,'sent');assert.equal(retried.change_count,1);assert.equal(calls,2);
  const stored=(await db.query('SELECT status,attempt_count,last_error FROM gsm_change_notifications WHERE batch_key=$1',[queued.batch_key])).rows[0];
  assert.equal(stored.status,'sent');assert.equal(stored.attempt_count,2);assert.equal(stored.last_error,null);
});

test('reconciliation queues a completed scan whose first enqueue attempt never persisted',async()=>{
  const recovered=await queueUnnotifiedGsmChanges(db,{now:new Date('2030-07-02T10:04:00Z')});
  assert.equal(recovered.status,'pending');assert.equal(recovered.queued,true);assert.equal(recovered.change_count,1);assert.deepEqual(recovered.scan_ids,['4']);
  const sent=await deliverGsmChangeNotification(db,recovered.batch_key,{now:new Date('2030-07-02T10:04:01Z'),sendEmail:async(_pool,message)=>({message_id:'gsm-message-3',recipients:['8 kişi'],recipient_count:8,subject:message.subject,total_bytes:100})});
  assert.equal(sent.status,'sent');assert.equal(sent.change_count,1);
  assert.equal((await queueUnnotifiedGsmChanges(db,{now:new Date('2030-07-02T10:05:00Z')})).status,'no_changes');
});

test('transient row preparation failure returns the claim to bounded backoff instead of leaving it sending',async()=>{
  const queued=await queueGsmChangeNotification(db,[5],{now:new Date('2030-07-02T11:04:00Z')});let fail=true,calls=0;
  const flaky={query(sql,args){if(fail&&/SELECT c\.\*,s\.slug source_slug/.test(sql)){fail=false;return Promise.reject(new Error('Synthetic row read failure'))}return db.query(sql,args)}};
  const first=await deliverGsmChangeNotification(flaky,queued.batch_key,{now:new Date('2030-07-02T11:04:01Z'),sendEmail:async()=>{calls++;return {}}});
  assert.equal(first.status,'pending');assert.equal(first.attempt_count,1);assert.match(first.error,/row read failure/);assert.equal(calls,0);
  const stored=(await db.query('SELECT status,attempt_count FROM gsm_change_notifications WHERE batch_key=$1',[queued.batch_key])).rows[0];
  assert.equal(stored.status,'pending');assert.equal(stored.attempt_count,1);
  const retried=await deliverGsmChangeNotification(db,queued.batch_key,{now:new Date('2030-07-02T11:05:02Z'),sendEmail:async(_pool,message)=>{calls++;return {message_id:'gsm-message-4',recipients:['8 kişi'],recipient_count:8,subject:message.subject,total_bytes:100}}});
  assert.equal(retried.status,'sent');assert.equal(calls,1);
});
