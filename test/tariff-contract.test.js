import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseValidatedTariffPage} from '../src/tariff-contract.js';
import {SOURCE_DEFS} from '../src/config.js';

function card({name='Super Simple 30',data='30 GB',price='999',benefits='Aşım Yok',extra='',cta=true}={}) {
  return `<div class="shadow-full"><div class="rounded-t"><div>${name}</div></div><div>
    <h1 class="text-2xl font-bold">${data}</h1><p>${benefits}</p>
    <p>500 DK Ada İçi &amp; TR ve 100 SMS</p>${extra}
    <div><span>₺</span><h1 class="text-4xl font-extrabold">${price}</h1> / ay</div>
    <button>Detayları Göster</button>${cta?'<button>Hemen Başvur</button>':''}</div></div>`;
}
const page = content => `<!doctype html><html><body><h1>Faturalı</h1>${content}</body></html>`;
const parse = (html, source=SOURCE_DEFS[0]) => parseValidatedTariffPage(html, source);
const rejects = html => assert.throws(()=>parse(html), error=>error.code==='TARIFF_CONTRACT_ERROR');

test('known sources parse isolated cards, preserving distinct prices and avoiding adjacent menu/footer benefits',()=>{
  const first=card(), second=card({price:'1099',cta:false});
  for (const source of SOURCE_DEFS) {
    const parsed=parse(page(`${first}<h2>Numara Taşıma Teklifleri</h2>${second}<footer>Happy Avantajlar İlk 6 ay 100 TL</footer>`),source);
    assert.deepEqual(parsed.cards.map(item=>item.price_try),[999,1099]);
    assert.deepEqual(parsed.cards.map(item=>item.extras_json),[['Aşım Yok'],['Aşım Yok']]);
    assert.deepEqual(parsed.validation,{contract_version:'telsim-dom-v2',scope:'supported-gsm-card-shapes',candidate_count:2,validated_count:2,excluded:[]});
  }
});

test('headline prices and commercial phases stay distinct and real large price changes remain valid',()=>{
  const benefits='Aşım Yok</p><p>İlk 6 ay 499 TL, İkinci 6 ay 999 TL</p><p>29 Yaş ve Altı';
  const cards=parse(page(card({price:'9999',benefits}))).cards;
  assert.equal(cards[0].price_try,9999);
  assert.deepEqual(cards[0].extras_json,['Aşım Yok','29 Yaş ve Altı','İlk 6 ay: 499 TL','İkinci 6 ay: 999 TL']);
  assert.equal(parse(page(card({price:'0'}))).cards[0].price_try,0,'explicit free headline is not a missing price');
});

test('partial selector drift cannot silently drop a card from the inventory',()=>{
  for (const broken of [
    card().replace('shadow-full','new-card-shell'),
    card().replace('text-2xl','new-quota-class'),
    card().replace('text-4xl','new-price-class'),
    card().replace('Detayları Göster','Yeni detay düğmesi'),
    card().replace('rounded-t','new-header-class'),
    card().replace(/class="[^"]*"/g,'').replace('Detayları Göster','Yeni detay düğmesi')
  ]) rejects(page(card({name:'Other offer'})+broken));
});

test('missing, duplicate or ambiguous required fields reject the whole source',()=>{
  for (const broken of [
    card({price:''}),card({price:'999 veya 1099'}),card({data:''}),card({data:'Yeni sınırsız kota'}),
    card({name:''}),card({extra:'<h1 class="text-4xl">1099</h1>'}),
    card({extra:'<h1 class="text-2xl">60 GB</h1>'}),
    card({extra:'<button>Detayları Göster</button>'}),
    card({extra:'<p>1000 SMS</p>'}),card().replace('₺','€'),
    card({extra:card({name:'Nested offer'})})
  ]) rejects(page(card({name:'Valid offer'})+broken));
});

test('prices outside the dedicated slot cannot override a valid card price',()=>{
  rejects(page(card({extra:'<p>Başka ücret 10 TL</p>'}).replace('<span>₺</span>','<span>TL</span>')));
  rejects(page(card({extra:'<p>₺10 hediye</p>'})));
  rejects(page(card({price:'1.999,50'})),'a parser/DOM numeric disagreement must be held for review');
});

test('legacy untracked shapes are explicit exclusions rather than silently missing cards',()=>{
  const excluded=[
    card({name:'Askerfone 250',data:'İnternetsiz Paket'}),
    card({name:'Gümrük Mini',data:'500 MB'}),
    card({name:'Engelleri Aşan',data:'5 GB/10 GB/15 GB'}),
    card({name:'Super Red 8',data:'8 GB + 4 GB Özgür Pass'}),
    card({name:'Red Box Sınırsız',data:'4.5G',benefits:'Sınırsız'})
  ];
  const result=parse(page(card()+excluded.join('')));
  assert.equal(result.validation.candidate_count,6);assert.equal(result.cards.length,1);
  assert.deepEqual(result.validation.excluded.map(item=>item.reason),[
    'legacy-no-data','legacy-mb-allowance','legacy-multiple-allowances','legacy-combined-allowance','legacy-unlimited-redbox'
  ]);
  rejects(page(excluded.join('')));
  rejects(page(card()+card({name:'Unknown offer',data:'İnternetsiz Paket'})));
});

test('existing numeric Red Box identities remain stable while their body quota and price are independently checked',()=>{
  const item=card({name:'Red Box 200 GB',data:'4.5G',benefits:'12 Ay Tarifeye Ek</p><p>200 GB',price:'1299'});
  const [parsed]=parse(page(item)).cards;
  assert.equal(parsed.name,'12 Ay Tarifeye Ek');assert.equal(parsed.data_gb,200);assert.equal(parsed.price_try,1299);
  rejects(page(item.replace('200 GB</p>','200 GB</p><p>300 GB</p>')));
});

test('unknown sources, wrong paths and empty pages never become a valid baseline',()=>{
  for(const source of [
    {...SOURCE_DEFS[0],slug:'new-source'},
    {...SOURCE_DEFS[0],url:SOURCE_DEFS[1].url},
    {...SOURCE_DEFS[0],url:'https://example.com/tr/tarifeler/tarifeler/faturali'},
    {...SOURCE_DEFS[0],url:'invalid'}
  ]) assert.throws(()=>parse(page(card()),source),error=>error.code==='TARIFF_CONTRACT_ERROR');
  rejects(page('<p>Geçici olarak hizmet verilemiyor</p>'));
  rejects(page(card()).replace('</body></html>',''));
});

test('retired combined Super Red cards are inventoried separately from the live split-quota offer',()=>{
  const live=card({name:'Super Red 10',data:'10 GB',price:'669',benefits:'+ 15 GB Özgür Pass'});
  const archive=card({name:'Super Red 10',data:'10 GB + 15 GB Özgür Pass',price:'2109',benefits:'Bu tarife sonlanmıştır',cta:false});
  const result=parse(page(live+archive),SOURCE_DEFS[2]);
  assert.deepEqual(result.cards.map(c=>[c.name,c.data_gb,c.bonus_data_gb,c.price_try]),[['Super Red 10',10,15,669]]);
  assert.deepEqual(result.validation.excluded.map(item=>item.reason),['retired-super-red-combined-allowance']);
  for(const changed of [
    archive.replace('Bu tarife sonlanmıştır','Aşım Yok'),
    archive.replace('Detayları Göster</button>','Detayları Göster</button><button>Hemen Başvur</button>'),
    archive.replace('10 GB +','11 GB +')
  ]) assert.equal(parse(page(live+changed),SOURCE_DEFS[2]).validation.excluded[0].reason,'legacy-combined-allowance');
  assert.equal(parse(page(live+archive)).validation.excluded[0].reason,'legacy-combined-allowance');
});
