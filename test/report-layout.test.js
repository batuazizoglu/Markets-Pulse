import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderReportHtml} from '../src/report-render.js';
import {createReportLayoutFixtures} from './report-layout-fixture.js';

const fixtures=await createReportLayoutFixtures();

test('PDF report HTML keeps home benchmark fields in five readable columns',()=>{
  const dom=new JSDOM(renderReportHtml(fixtures.home)),table=dom.window.document.querySelector('.home-products');
  assert.equal(table.querySelectorAll('thead th').length,5);
  assert.equal(table.querySelectorAll('tbody tr').length,22);
  for(const value of ['1. Ailelere','Fiber / VDSL','100 Mbps','12 + 2 hediye ay','999 TL','11.988 TL','10,01','78/100'])assert.ok(table.textContent.includes(value),value);
  assert.equal(dom.window.document.querySelector('.footer'),null,'fixed body footer must not overlap report content');
  dom.window.close();
});

test('all PDF families retain Turkish text, page-break headings and PDF-specific ad content',()=>{
  for(const [name,ctx] of Object.entries(fixtures)){
    const html=renderReportHtml(ctx),dom=new JSDOM(html),text=dom.window.document.body.textContent;
    assert.ok(text.includes(ctx.title),name);
    assert.doesNotMatch(text,/undefined|NaN/);
    assert.ok(!text.includes('E-posta sürümü'),name+' must prefer PDF-specific images');
    assert.equal(dom.window.document.querySelector('.pagebreak+h2'),null,'heading owns the section break');
    assert.match(html,/font-size:14px/);assert.match(html,/thead\{display:table-header-group/);
    if(name!=='empty'){
      assert.ok(text.includes('Reklam Görsel Analizi'),name);
      assert.ok(text.includes('UZUN AYRINTI BAŞLANGICI'),name+' long details start');
      assert.ok(text.includes('UZUN AYRINTI SONU'),name+' long details end');
    }
    dom.window.close();
  }
});

test('legacy ad HTML remains supported and report fields escape stored text',()=>{
  const ctx={...fixtures.home,title:'<script>unsafe()</script>',ad_analysis_html_pdf:undefined,ad_analysis_html:'<p>Eski reklam bölümü</p>',home:{...fixtures.home.home,products:[{...fixtures.home.home.products[0],name:'<img src=x onerror=unsafe()>'}]}};
  const dom=new JSDOM(renderReportHtml(ctx));
  assert.equal(dom.window.document.querySelector('script,img[onerror]'),null);
  assert.match(dom.window.document.body.textContent,/<img src=x onerror=unsafe\(\)>/);
  assert.match(dom.window.document.body.textContent,/Eski reklam bölümü/);
  dom.window.close();
});
