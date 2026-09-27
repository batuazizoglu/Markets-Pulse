import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCards,rebaseCardBoundaries,rebaseCommercialTerms,recoverEmbeddedCards} from '../src/parser.js';

const mini = `Super Cool Uni - Mini
5 GB
50 DK Ada İçi & TR ve 50 SMS
29 Yaş ve Altı için özel
İlk 6 ay 499 TL, İkinci 6 ay 599 TL
₺499
/ ay
Detayları Göster
Hemen Başvur`;

const junior = `Red Junior
10 GB
+ 5 GB Özgür Pass
+ Sınırsız
500 DK Ada İçi & TR ve 1000 SMS
6-17 yaş için özel
₺569
/ ay
Detayları Göster
Hemen Başvur`;

const super65 = `Super65 DK
1 GB
1000 DK Ada İçi & TR ve 1000 SMS
₺519
/ ay
Detayları Göster
Hemen Başvur`;

function legacyObservation() {
  const clean = parseCards(mini)[0];
  return {...clean,id:45,current_name:clean.name,last_position:26,
    product_hash:'persisted-legacy-hash',captured_at:'2026-09-22T08:01:00.000Z',
    bonus_data_gb:5,
    extras_json:['29 Yaş ve Altı için özel','+ 5 GB Özgür Pass','+ Sınırsız','6-17 yaş için özel'],
    raw_text:[mini,junior].join('\n').split('\n').join(' | ')};
}

test('Mini, Red Junior and Super65 remain separate cards with their own allowances, ages and prices',()=>{
  const cards = parseCards([mini,junior,super65].join('\n'));
  assert.deepEqual(cards.map(card=>card.name),['Super Cool Uni - Mini','Red Junior','Super65 DK']);
  assert.deepEqual(cards.map(card=>[card.data_gb,card.bonus_data_gb,card.local_tr_minutes,card.sms,card.price_try]),[
    [5,null,50,50,499],[10,5,500,1000,569],[1,null,1000,1000,519]
  ]);
  assert.deepEqual(cards[0].extras_json,['29 Yaş ve Altı için özel','İlk 6 ay: 499 TL','İkinci 6 ay: 599 TL']);
  assert.deepEqual(cards[1].extras_json,['+ 5 GB Özgür Pass','+ Sınırsız','6-17 yaş için özel']);
  assert.ok(!cards[0].raw_text.includes('Red Junior'));
  assert.ok(!cards[1].raw_text.includes('Super65'));
  assert.equal(parseCards(junior).length,1,'the standalone Red Junior card is now covered');
});

test('the Red Junior exception requires an immediately following allowance and keeps other category exclusions',()=>{
  assert.equal(parseCards(junior.replace('Red Junior\n10 GB','Red Junior\nDetayları Göster\n10 GB')).length,0);
  assert.equal(parseCards(junior.replace('Red Junior','Super Red')).length,0);
  assert.deepEqual(parseCards('Red Junior\n'+mini),parseCards(mini),'a navigation label cannot override the actual next card name');
});

test('proven legacy neighbor contamination is rebased without mutating stored history or identity metadata',()=>{
  const old = legacyObservation(), saved = structuredClone(old), clean = parseCards(mini)[0];
  const rebased = rebaseCardBoundaries(old);
  for (const field of ['data_gb','bonus_data_gb','local_tr_minutes','international_minutes','sms',
    'validity_days','red_passport_days','price_try','extras_json','raw_text']) {
    assert.deepEqual(rebased[field],clean[field],field);
  }
  for (const field of ['id','name','current_name','identity_base','position','last_position','product_hash','captured_at']) {
    assert.deepEqual(rebased[field],old[field],field);
  }
  assert.deepEqual(old,saved);
  assert.deepEqual(rebaseCardBoundaries(rebased),rebased,'the clipped observation is stable');
});

test('boundary rebasing preserves the old phase evidence before commercial-term comparison',()=>{
  const previous = rebaseCardBoundaries(legacyObservation());
  const current = parseCards(mini.replace('İkinci 6 ay 599 TL','İkinci 6 ay 699 TL'))[0];
  const rebased = rebaseCommercialTerms(previous,current);
  assert.equal(rebased.bonus_data_gb,null);
  assert.ok(rebased.extras_json.includes('İkinci 6 ay: 599 TL'));
  assert.ok(!rebased.extras_json.includes('İkinci 6 ay: 699 TL'));
  assert.ok(current.extras_json.includes('İkinci 6 ay: 699 TL'));
  assert.deepEqual(rebased.extras_json,parseCards(mini)[0].extras_json);
});

test('recovery returns only a valid embedded Red Junior belonging to the identified old observation',()=>{
  const old = legacyObservation();
  assert.deepEqual(recoverEmbeddedCards(old).map(card=>({...card,position:0})),parseCards(junior));
  const withAnother = {...old,raw_text:old.raw_text+' | '+super65.split('\n').join(' | ')};
  assert.deepEqual(recoverEmbeddedCards(withAnother).map(card=>card.name),['Red Junior']);
  assert.deepEqual(recoverEmbeddedCards({...old,identity_base:'different-package'}),[]);
  assert.deepEqual(recoverEmbeddedCards({...old,identity_base:undefined}),recoverEmbeddedCards(old),'legacy name metadata can establish identity');
});

test('absent, partial, mismatched or single-card raw evidence leaves prior observations unchanged',()=>{
  const old = legacyObservation();
  for (const candidate of [
    {...old,raw_text:null},
    {...old,raw_text:''},
    {...old,raw_text:mini},
    {...old,raw_text:old.raw_text.replace('₺569','')},
    {...old,identity_base:'unrelated'},
    {raw_text:old.raw_text}
  ]) {
    assert.strictEqual(rebaseCardBoundaries(candidate),candidate);
    assert.deepEqual(recoverEmbeddedCards(candidate),[]);
  }
});
