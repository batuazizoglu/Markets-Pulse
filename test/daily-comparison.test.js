import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCards} from '../src/parser.js';
import {dailyComparisonRow} from '../src/daily-comparison.js';

const mini=`Super Cool Uni - Mini\n5 GB\nAda İçi ve TR yönüne 50 DK ve 50 SMS\n29 Yaş ve Altı için özel\nİlk 6 ay 499 TL, İkinci 6 ay 599 TL\n₺\n499\n/ ay`;
const junior=`Red Junior\n10 GB\n+ 5 GB Özgür Pass\n500 Dk Ada içi & TR ve 1000 SMS\nFatura aşımı yoktur. 6-17 yaş aralığındakiler faydalanabilir.\n₺\n569\n/ ay`;
function pair(currentText=mini){
  const previous={...parseCards(mini)[0],bonus_data_gb:5,raw_text:`${parseCards(mini)[0].raw_text} | ${parseCards(junior)[0].raw_text}`};
  const current=parseCards(currentText)[0];
  return {current_version_id:2,previous_version_id:1,current_captured_at:'2026-09-27T16:00:00Z',previous_captured_at:'2026-09-26T03:18:00Z',
    current_name_version:current.name,previous_name:previous.name,_current_observation:current,_previous_observation:previous};
}

test('midnight comparison does not announce the parser-only removal of Junior bonus from Mini',()=>{
  const input=pair(),saved=structuredClone(input),row=dailyComparisonRow(input);
  assert.equal(row.changed,false);
  assert.equal(row.previous_bonus_data_gb,null);
  assert.equal(row.current_bonus_data_gb,null);
  assert.deepEqual(row.diffs.bonus_data_gb,{old:null,new:null,delta:null,pct:null});
  assert.equal(row.previous_version_id,1);
  assert.equal(row.previous_captured_at,input.previous_captured_at);
  assert.equal('_previous_observation' in row,false);
  assert.equal('_current_observation' in row,false);
  assert.deepEqual(input,saved);
});

test('midnight comparison preserves genuine simultaneous price/minute changes and unknown history',()=>{
  const row=dailyComparisonRow(pair(mini.replace('50 DK','60 DK').replace('\n499\n','\n549\n')));
  assert.equal(row.changed,true);
  assert.deepEqual(row.diffs.local_tr_minutes,{old:50,new:60,delta:10,pct:20});
  assert.equal(row.diffs.price_try.old,499);assert.equal(row.diffs.price_try.new,549);
  const missing=pair();missing._previous_observation=null;missing.previous_version_id=null;missing.previous_name=null;
  const unknown=dailyComparisonRow(missing);
  assert.equal(unknown.previous_version_id,null);assert.equal(unknown.diffs.data_gb.old,null);
  const unproven=pair();unproven._previous_observation.raw_text=null;
  assert.equal(dailyComparisonRow(unproven).diffs.bonus_data_gb.old,5);
});
