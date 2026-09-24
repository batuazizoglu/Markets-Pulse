import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';

// Exercise the actual recipient and delivery functions while keeping database
// timers, report rendering and both external mail transports fully isolated.
const reportSource=(await readFile(new URL('../src/report-email.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const personalSource=(await readFile(new URL('../src/manual-report-email.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
function harness(mode,{configured=true,fail=false}={}){
  const sent=[],scheduled=['scheduled-one@example.test','scheduled-two@example.test'];let reads=0;
  const pool={query:async()=>{reads++;return {rows:scheduled.map(email=>({email}))}}};
  const deliver=async recipients=>{if(fail)throw new Error('Synthetic mail failure');const id='message-'+(sent.length+1);sent.push({id,recipients});return id};
  const dependencies={
    nodemailer:{createTransport:()=>({sendMail:async message=>({messageId:await deliver(message.to.split(', '))})})},
    REPORT_NAMES:{home:'Home'},REPORT_TZ:'UTC',reportDays:()=>7,monthlyOverviewHtml:()=>'',monthlyPlainText:()=>'',
    generateReportPdf:async()=>({ctx:{period_end:'2026-09-24T10:00:00Z'},fileName:'synthetic.pdf',buffer:Buffer.from('PDF'),contentType:'application/pdf'}),
    generateEvidencePack:()=>assert.fail('Evidence pack not used'),dbPool:pool,
    process:{env:configured?{REPORT_EMAIL_FROM:'sender@example.test',...(mode==='api'?{BREVO_API_KEY:'synthetic-only'}:{SMTP_HOST:'synthetic-only'})}:{}},
    fetch:async(url,options)=>{assert.equal(url,'https://api.brevo.com/v3/smtp/email');const body=JSON.parse(options.body);const messageId=await deliver(body.to.map(row=>row.email));return {ok:true,status:201,json:async()=>({messageId})}},
    setTimeout:()=>({unref(){}}),setInterval:()=>({unref(){}}),clearTimeout:()=>{},console:{log(){},error(){}}
  };
  const report=compileFunction(reportSource+'\nfunction emailHtml(){return ""}\nreturn {sendReportEmail,refreshReportRecipients,getReportEmailStatus};',Object.keys(dependencies))(...Object.values(dependencies));
  const sendPersonalReportEmail=compileFunction(personalSource+'\nreturn sendPersonalReportEmail;',['sendReportEmail','refreshReportRecipients'])(report.sendReportEmail,report.refreshReportRecipients);
  return {pool,sent,scheduled,report,sendPersonalReportEmail,reads:()=>reads};
}

for(const mode of ['smtp','api'])test(mode+': concurrent personal sends keep their own recipient and do not change scheduled distribution',async()=>{
  const h=harness(mode);await h.report.refreshReportRecipients(h.pool);
  const before=h.reads();
  const [first,second,batch]=await Promise.all([
    h.sendPersonalReportEmail(h.pool,'home','FIRST@example.test',{recipientEmails:['ignored@example.test']}),
    h.sendPersonalReportEmail(h.pool,'home','second@example.test'),
    h.report.sendReportEmail(h.pool,'home')
  ]);
  const actual=result=>h.sent.find(message=>message.id===result.message_id).recipients;
  assert.deepEqual(actual(first),['first@example.test']);assert.equal(first.delivery_to,'first@example.test');
  assert.deepEqual(actual(second),['second@example.test']);assert.equal(second.delivery_to,'second@example.test');
  assert.deepEqual(actual(batch),h.scheduled);assert.equal(batch.recipient_count,2);
  assert.equal(h.reads(),before+1,'Only scheduled delivery refreshes the distribution list');
  assert.deepEqual(h.report.getReportEmailStatus().recipient_emails,h.scheduled);
  assert.equal(h.report.getReportEmailStatus().recipient_source,'active-app-users');
  assert.doesNotMatch(JSON.stringify(h.report.getReportEmailStatus()),/scheduled-one|scheduled-two/);
});

test('a personal send works before the first scheduled-recipient refresh and never changes its status',async()=>{
  const h=harness('smtp');assert.equal(h.report.getReportEmailStatus().recipient_count,0);
  const result=await h.sendPersonalReportEmail(h.pool,'home','reader@example.test');
  assert.deepEqual(h.sent[0].recipients,['reader@example.test']);assert.equal(result.recipient_count,1);
  assert.equal(h.reads(),0);assert.equal(h.report.getReportEmailStatus().recipient_count,0);
});

test('failed or invalid personal delivery leaves scheduled recipients intact',async()=>{
  const h=harness('smtp',{fail:true});await h.report.refreshReportRecipients(h.pool);const before=h.reads();
  await assert.rejects(h.sendPersonalReportEmail(h.pool,'home','reader@example.test'),/Synthetic mail failure/);
  await assert.rejects(h.sendPersonalReportEmail(h.pool,'home','invalid-email'),{code:'PERSONAL_EMAIL_REQUIRED'});
  assert.equal(h.reads(),before);assert.deepEqual(h.report.getReportEmailStatus().recipient_emails,h.scheduled);
  const missing=harness('smtp',{configured:false});
  await assert.rejects(missing.sendPersonalReportEmail(missing.pool,'home','reader@example.test'),{code:'EMAIL_NOT_CONFIGURED'});
  assert.equal(missing.sent.length,0);
});
