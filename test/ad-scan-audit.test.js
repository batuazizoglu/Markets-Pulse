import test from 'node:test';
import assert from 'node:assert/strict';
import {adScanAudit} from '../src/ad-scan-audit.js';

test('operational audit includes missing registry pages and never reuses an older successful match',()=>{
  const now=new Date('2026-11-21T08:00:00Z');
  const directory=[{brand:'KKTCELL',page_id:'127496543986832'},{brand:'Xrealnet',page_id:'391015854865659'}];
  const run={job_id:'1',page_id:directory[0].page_id,state:'complete',coverage_complete:true,
    created_at:'2026-11-21T04:00:00Z',finished_at:'2026-11-21T04:10:00Z',ads:5,expected_ads:5,list_matches_latest_scan:true};
  const status={schedule:{last_scheduled_day:'2026-11-21',timezone:'Asia/Famagusta',daily_at:'06:00'},
    visibility:{max_observation_age_hours:30},capture_provider:{runs:[run]},
    sources:[{job_id:'1',page_id:run.page_id,status:'ok',active_count:5,created_at:'2026-11-21T03:59:00Z'},
      {job_id:'0',page_id:run.page_id,brand:'Turkcell Ev İnterneti',status:'error',created_at:'2026-11-20T04:00:00Z'}]};
  let audit=adScanAudit(status,directory,{now});
  assert.equal(audit.verified_pages,2);assert.equal(audit.complete_pages,1);assert.equal(audit.matched_pages,1);
  assert.equal(audit.sources[1].status,'missing');assert.equal(audit.sources[1].checked_at,null);
  status.sources[0]={...status.sources[0],job_id:'2',status:'error'};
  audit=adScanAudit(status,directory,{now});
  assert.equal(audit.complete_pages,0);assert.equal(audit.matched_pages,0);assert.equal(audit.sources[0].list_matches_latest_scan,null);
  status.sources[0].job_id='1';
  audit=adScanAudit(status,directory,{now});
  assert.equal(audit.complete_pages,0);assert.equal(audit.sources[0].list_matches_latest_scan,null);assert.equal(audit.sources[0].status,'error');
  status.sources[0].status='ok';
  run.created_at='2026-11-20T01:59:59.999Z';
  audit=adScanAudit(status,directory,{now});
  assert.equal(audit.sources[0].status,'stale');assert.equal(audit.matched_pages,0);
});
