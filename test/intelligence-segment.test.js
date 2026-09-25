import {test} from 'node:test';
import assert from 'node:assert/strict';
import {marketPulseFromRows} from '../src/intelligence.js';

const now=new Date('2026-09-25T00:00:00Z');
function segment(name,extra={}){
  return marketPulseFromRows([{id:1,product_id:1,scan_id:1,event_version_id:1,detected_at:'2026-09-24T10:00:00Z',product_name:name,change_type:'added',severity:'high',...extra}],7,now).moves[0].segment;
}
test('student package families and Turkish university labels are classified consistently in historical moves',()=>{
  for(const name of ['Super Cool Uni - Mini','Super Cool Uni - Maxi (Üniversitelere Özel)','ÜNİ Paketi','Uni-Pack','UniPack','University Internet','GNÇ Giga M','GNC Giga M'])assert.equal(segment(name),'Öğrenci / Genç',name);
  for(const name of ['Universal Paket','Community Plan','Super Databol Medium'])assert.equal(segment(name),'Genel',name);
  assert.equal(segment('Historical general package',{identity_base:'Future Uni package'}),'Genel','future identity cannot change event-time classification');
});
test('existing explicit eligibility labels retain their precedence',()=>{
  assert.equal(segment('Askerfone Genç'),'Asker');
  assert.equal(segment('Tourist Student eSIM'),'Turist');
  assert.equal(segment('Super Red Platinum'),'Premium / Platinum');
});
