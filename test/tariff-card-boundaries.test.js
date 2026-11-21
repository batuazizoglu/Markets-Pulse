import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCards,rebaseCardBoundaries,rebaseCommercialTerms,recoverEmbeddedCards} from '../src/parser.js';

const simple30 = `Super Simple 30
30 GB
Aşım Yok
500 DK Ada İçi & TR ve 100 SMS
₺999
/ ay
Detayları Göster
Hemen Başvur`;

test('Super Simple 30 ignores following offer sections and footer benefits without changing its hash',()=>{
  const clean = parseCards(simple30)[0];
  for (const heading of ['Numara Taşıma Teklifleri','Yeni Müşteri Alımı Teklifleri','Faturalı Hatta Geçiş Teklifleri']) {
    const contaminated = parseCards(`${simple30}\n${heading}\nHappy Avantajlar\nİlk 6 ay 100 TL`)[0];
    assert.deepEqual(contaminated,clean);
    const noCta = simple30.replace('\nHemen Başvur','');
    assert.deepEqual(parseCards(`${noCta}\n${heading}`),parseCards(noCta));
  }
  const twoOffers = parseCards(`${simple30}\nNumara Taşıma Teklifleri\n${simple30.replace('₺999','₺1099')}`);
  assert.equal(twoOffers.length,2);
  assert.deepEqual(twoOffers.map(card=>card.price_try),[999,1099]);
  assert.deepEqual(twoOffers.map(card=>card.extras_json),[['Aşım Yok'],['Aşım Yok']]);
});

test('overflow benefits do not match words containing aşım, and real eligibility remains intact',()=>{
  const text = simple30.replace('Aşım Yok',
    'Aşım Yok\nFatura aşımı yoktur.\nNumara Taşıma kampanyası\nUlaşım\nNumara taşıyanlara 12 ay taahhüt');
  assert.deepEqual(parseCards(text)[0].extras_json,
    ['Aşım Yok','Fatura aşımı yoktur.','Numara taşıyanlara 12 ay taahhüt']);
});

test('standalone leaked headings are rebased only with raw evidence, keeping original observations',()=>{
  const clean = parseCards(simple30)[0];
  const previous = {...clean,product_hash:'legacy',extras_json:['Aşım Yok','Numara Taşıma Teklifleri'],
    raw_text:clean.raw_text+' | Numara Taşıma Teklifleri'};
  const saved = structuredClone(previous);
  const rebased = rebaseCardBoundaries(previous);
  assert.deepEqual(rebased.extras_json,['Aşım Yok']);
  assert.equal(rebased.product_hash,'legacy');
  assert.equal(rebased.raw_text,previous.raw_text);
  assert.deepEqual(previous,saved);
  for (const raw_text of [null,'',clean.raw_text]) {
    const unproven = {...previous,raw_text};
    assert.strictEqual(rebaseCardBoundaries(unproven),unproven);
  }
  const partiallyProven = {...previous,extras_json:[...previous.extras_json,'Faturalı Hatta Geçiş Teklifleri']};
  assert.strictEqual(rebaseCardBoundaries(partiallyProven),partiallyProven);
});

test('an exact section after a card control bounds proven footer benefits and phase prices',()=>{
  for (const text of [simple30,simple30.replace('Detayları Göster\n',''),
    simple30.replace('Detayları Göster\n','').replace('Hemen Başvur','Satın Al')]) {
    const clean=parseCards(text)[0];
    const raw_text=(text+'\nNumara Taşıma Teklifleri\nHappy Avantajlar\nİlk 6 ay 100 TL').split('\n').join(' | ');
    const previous={...clean,raw_text,product_hash:'legacy-section-footer',
      extras_json:['Aşım Yok','Numara Taşıma Teklifleri','Happy Avantajlar','İlk 6 ay: 100 TL']};
    const original=structuredClone(previous);
    const rebased=rebaseCommercialTerms(rebaseCardBoundaries(previous),clean);
    assert.deepEqual(rebased.extras_json,['Aşım Yok']);
    assert.equal(rebased.price_try,999);
    assert.equal(rebased.raw_text,raw_text);
    assert.equal(rebased.product_hash,previous.product_hash);
    assert.deepEqual(previous,original);
    for (const raw of [raw_text.replace('Numara Taşıma Teklifleri','Numara Taşıma Teklifleri için koşullar'),
      raw_text.replace(' | Numara Taşıma Teklifleri',' | Uncertain text | Numara Taşıma Teklifleri')]) {
      const uncertain={...previous,raw_text:raw};
      assert.ok(rebaseCardBoundaries(uncertain).extras_json.includes('Happy Avantajlar'));
    }
    const mismatch={...previous,price_try:888};
    assert.ok(rebaseCardBoundaries(mismatch).extras_json.includes('Happy Avantajlar'));
  }
});

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

const closedRelax = `Super Relax 10 GB + 600 DK
10 GB
Bu tarife sonlanmıştır
600 DK 1.000 SMS
₺1879
/ ay
Detayları Göster`;
const closedRed = `Super Red 8
8 GB + 15 GB Özgür Pass
Bu tarife sonlanmıştır
700 DK 1000 SMS
İlk 6 ay 2009 TL, İkinci 6 ay 2209 TL
₺2009
/ ay
Detayları Göster`;

function legacyDetailSpill(first=closedRelax,next=closedRed) {
  const combined=first+'\n'+next;
  return {...parseCards(combined.replaceAll('Detayları Göster',''))[0],
    product_hash:'legacy-detail-spill',raw_text:combined.split('\n').join(' | ')};
}

test('detail controls bound inactive cards independently of following unsupported allowance shapes',()=>{
  assert.deepEqual(parseCards(closedRelax+'\n'+closedRed),parseCards(closedRelax));
  const box='12 Ay Tarifeye Ek\n200 GB\nSim Kart Girişlidir\n₺850\n/ ay\nDetayları Göster';
  const unlimited='Red Box Sınırsız\n4.5G\n12 Ay Tarifeye Ek\nSınırsız\nSim Kart Girişlidir\n₺1499\n/ ay\nDetayları Göster';
  assert.deepEqual(parseCards(box+'\n'+unlimited),parseCards(box));
  const previous=legacyDetailSpill(box,unlimited),original=structuredClone(previous);
  const rebased=rebaseCardBoundaries(previous);
  assert.deepEqual(rebased.extras_json,[]);
  assert.equal(rebased.raw_text,previous.raw_text);
  assert.equal(rebased.product_hash,previous.product_hash);
  assert.deepEqual(previous,original);
});

test('proven detail spills rebase fields while retaining raw evidence and excluding neighboring phase prices',()=>{
  const previous=legacyDetailSpill(),original=structuredClone(previous);
  assert.equal(previous.bonus_data_gb,15);
  const rebased=rebaseCardBoundaries(previous);
  const clean=parseCards(closedRelax)[0];
  for (const field of ['data_gb','bonus_data_gb','price_try','extras_json']) assert.deepEqual(rebased[field],clean[field]);
  assert.equal(rebased.raw_text,previous.raw_text);
  assert.equal(rebased.product_hash,previous.product_hash);
  assert.deepEqual(previous,original);
  assert.strictEqual(rebaseCardBoundaries(rebased),rebased);
  const compared=rebaseCommercialTerms(rebased,clean);
  assert.deepEqual(compared.extras_json,clean.extras_json);
  assert.equal(compared.raw_text,previous.raw_text);
  const postgresNumbers={...previous,data_gb:'10.000',bonus_data_gb:'15.0',
    local_tr_minutes:'600',sms:'1000',price_try:'1879.00'};
  assert.deepEqual(rebaseCardBoundaries(postgresNumbers).extras_json,clean.extras_json);
});

test('detail boundary correction retains uncertain, mismatched and incomplete evidence',()=>{
  const previous=legacyDetailSpill();
  for (const candidate of [
    {...previous,raw_text:null},
    {...previous,raw_text:previous.raw_text.replace('₺1879','')},
    {...previous,raw_text:previous.raw_text.replace('₺2009','').replace('İlk 6 ay 2009 TL, İkinci 6 ay 2209 TL','')},
    {...previous,raw_text:previous.raw_text.replace(/ \| Detayları Göster$/,'')},
    {...previous,raw_text:previous.raw_text+' | Additional unknown conditions'},
    {...previous,identity_base:'unrelated'},
    {...previous,current_name:'Different observed offer'},
    {...previous,price_try:999},
    {...previous,extras_json:['Unproven recorded benefit']}
  ]) assert.strictEqual(rebaseCardBoundaries(candidate),candidate);
});
