import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {SCHEMA_SQL} from '../src/schema.js';
import {HOME_INTERNET_SOURCES} from '../src/home-internet.js';
import {socialDirectory} from '../src/isp-registry.js';
import {adLibraryUrl} from '../src/ad-library-url.js';
import {adLibrarySource,captureCloudAds} from '../src/ad-cloud-capture.js';
import {startProviderRun} from '../src/ad-provider-client.js';
import {queueNewCloudSources} from '../src/ad-cloud.js';

const advertiser='Kuzey Kıbrıs Turkcell';
const providerEnv={AD_CAPTURE_PROVIDER:'apify',APIFY_TOKEN:'synthetic-test-token',APIFY_MAX_RUN_USD:'0.10',APIFY_DAILY_BUDGET_USD:'1.00'};

test('Turkcell Meta shortcuts use the public advertiser name and preserve internal brand keys',()=>{
  const directory=socialDirectory(HOME_INTERNET_SOURCES);
  for(const brand of ['KKTCELL','Turkcell Ev İnterneti']){
    const source=directory.find(row=>row.brand===brand),url=new URL(source.ad_library_url);
    assert.equal(source.brand,brand);
    assert.equal(source.ad_library_search_name,advertiser);
    assert.equal(source.ad_library_type,'brand_search');
    assert.equal(url.searchParams.get('q'),advertiser);
    assert.equal(url.searchParams.get('search_type'),'keyword_unordered');
    assert.equal(url.searchParams.get('country'),'CY');
    assert.equal(url.searchParams.has('view_all_page_id'),false);
  }
  for(const source of directory.filter(row=>!row.page_id&&!row.ad_library_search_name)){
    assert.equal(new URL(source.ad_library_url).searchParams.get('q'),source.brand);
  }
});

test('verified page IDs take precedence over advertiser names in every URL builder',()=>{
  const directory=socialDirectory(HOME_INTERNET_SOURCES);
  for(const source of directory.filter(row=>row.page_id)){
    const url=new URL(adLibraryUrl({...source,ad_library_search_name:advertiser}));
    assert.equal(url.searchParams.get('view_all_page_id'),source.page_id);
    assert.equal(url.searchParams.get('search_type'),'page');
    assert.equal(url.searchParams.has('q'),false);
    assert.equal(adLibrarySource(source),source.ad_library_url);
  }
  assert.equal(new URL(directory.find(row=>row.brand==='Telsim').ad_library_url).searchParams.get('view_all_page_id'),'164143610515');
});

test('corrected keyword links do not authorize unverified cloud or paid provider capture',async()=>{
  const source=socialDirectory(HOME_INTERNET_SOURCES).find(row=>row.brand==='KKTCELL');
  assert.equal(adLibrarySource(source),null);
  const result=await captureCloudAds(source,()=>assert.fail('unverified images must not be attributed'),{
    launch:()=>assert.fail('keyword shortcuts must not start cloud capture')
  });
  assert.equal(result.status,'unverified');
  await assert.rejects(startProviderRun(source,{env:providerEnv,fetcher:()=>assert.fail('unverified pages must not incur provider costs')}),{code:'PROVIDER_SOURCE_INVALID'});
});

test('Apify uses the same verified-page URL and never replaces a page ID with a keyword',async()=>{
  const source={brand:'KKTCELL',page_id:'123456789012345',ad_library_search_name:advertiser};
  let calls=0;
  await startProviderRun(source,{env:providerEnv,fetcher:async(_,options)=>{
    calls++;
    const input=JSON.parse(options.body),url=new URL(input.startUrls[0].url);
    assert.equal(input.startUrls[0].url,adLibrarySource(source));
    assert.equal(url.searchParams.get('view_all_page_id'),source.page_id);
    assert.equal(url.searchParams.has('q'),false);
    return new Response(JSON.stringify({data:{id:'testRun123',status:'RUNNING',defaultDatasetId:'dataset123'}}),{status:201,headers:{'content-type':'application/json'}});
  }});
  assert.equal(calls,1);
});

test('source registration refreshes historical keyword shortcuts idempotently without touching verified jobs or capture state',async()=>{
  const db=new PGlite();
  try{
    await db.exec(SCHEMA_SQL);
    await db.query("UPDATE ad_cloud_control SET lease_owner='search-name-test',lease_until=NOW()+INTERVAL '10 minutes' WHERE id=1");
    await queueNewCloudSources(db,HOME_INTERNET_SOURCES,'search-name-test');
    for(const [index,brand] of ['KKTCELL','Turkcell Ev İnterneti'].entries()){
      const source={brand,ad_library_url:adLibraryUrl({brand}),ad_library_type:'brand_search',legacy_note:'preserve this'};
      await db.query('INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status,note,attempts,captured) VALUES($1,$2,$3::jsonb,$4,$5,2,3)',
        ['old-search-'+index,brand,JSON.stringify(source),index?'imported':'unverified','Historical capture result']);
    }
    const verified={brand:'KKTCELL',page_id:'123456789012345',ad_library_url:adLibraryUrl({page_id:'123456789012345'})};
    await db.query("INSERT INTO ad_cloud_jobs(batch_key,brand,source_json,status) VALUES('verified-turkcell','KKTCELL',$1::jsonb,'blocked')",[JSON.stringify(verified)]);
    const before=(await db.query('SELECT * FROM ad_cloud_jobs ORDER BY id')).rows;
    assert.deepEqual(await queueNewCloudSources(db,HOME_INTERNET_SOURCES,'search-name-test'),[]);
    const after=(await db.query('SELECT * FROM ad_cloud_jobs ORDER BY id')).rows;
    assert.equal(after.length,before.length);
    for(const [index,row] of after.entries()){
      const old=before[index];
      if(row.batch_key.startsWith('old-search-')){
        assert.deepEqual({...row,source_json:old.source_json},old);
        assert.equal(row.source_json.brand,old.brand);
        assert.equal(row.source_json.legacy_note,'preserve this');
        assert.equal(row.source_json.ad_library_search_name,advertiser);
        assert.equal(new URL(row.source_json.ad_library_url).searchParams.get('q'),advertiser);
        assert.equal(row.source_json.page_id,undefined);
      }else assert.deepEqual(row,old);
    }
    assert.deepEqual(await queueNewCloudSources(db,HOME_INTERNET_SOURCES,'search-name-test'),[]);
    assert.deepEqual((await db.query('SELECT * FROM ad_cloud_jobs ORDER BY id')).rows,after);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_provider_runs')).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int n FROM ad_provider_budget')).rows[0].n,0);
  }finally{await db.close()}
});
