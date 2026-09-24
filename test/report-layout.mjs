// Offline print-layout gate. Produces real PDFs and page PNGs for visual review.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {compileFunction} from 'node:vm';
import puppeteer from 'puppeteer';
import {renderReportHtml,renderReportPdf} from '../src/report-render.js';
import {createReportLayoutFixtures} from './report-layout-fixture.js';
import {REPORT_NAMES,REPORT_TZ} from '../src/report-data.js';
import {monthlyOverviewHtml} from '../src/monthly-report-content.js';

const output='test-output/report-layout';
await mkdir(output,{recursive:true});
const executablePath=process.env.PUPPETEER_EXECUTABLE_PATH||['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser',puppeteer.executablePath()].find(existsSync);
if(!executablePath)throw new Error('A Chromium binary is required for the PDF layout check.');
const fixtures=await createReportLayoutFixtures(),results=[],emails=[];
// Compile only pure production formatters. Never import report-email's DB timers or transport.
const emailSource=await readFile(new URL('../src/report-email.js',import.meta.url),'utf8');
const emailHelpers=emailSource.split('\n').filter(line=>line.startsWith('function esc(')||line.startsWith('function localDate(')).join('\n');
const emailFormatters=emailSource.slice(emailSource.indexOf('function signed('),emailSource.indexOf('export async function sendReportEmail('));
const emailHtml=compileFunction(emailHelpers+'\n'+emailFormatters+'\nreturn emailHtml(type,ctx,attachments);',['type','ctx','attachments','REPORT_NAMES','REPORT_TZ','monthlyOverviewHtml']);
const command=(name,args)=>{
  const result=spawnSync(name,args,{encoding:'utf8',maxBuffer:20*1024*1024});
  if(result.error||result.status!==0)throw new Error(`${name} failed: ${result.error?.message||result.stderr}`);
  return result.stdout;
};
// PDF artifacts are always produced. Poppler extends the gate when available.
const hasPoppler=['pdfinfo','pdftotext','pdftoppm'].every(name=>spawnSync(name,['-v'],{encoding:'utf8'}).status===0);
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  for(const [name,ctx] of Object.entries(fixtures)){
    const page=await browser.newPage();await page.setViewport({width:688,height:1000,deviceScaleFactor:1});await page.emulateMediaType('print');
    const html=renderReportHtml(ctx);await writeFile(`${output}/${name}.html`,html);
    await page.setContent(html,{waitUntil:'load',timeout:60000});
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images,image=>image.decode()))});
    const metrics=await page.evaluate(()=>({
      width:innerWidth,scroll:document.documentElement.scrollWidth,
      bodyFont:parseFloat(getComputedStyle(document.body).fontSize),
      tableFonts:Array.from(document.querySelectorAll('td,th')).map(el=>parseFloat(getComputedStyle(el).fontSize)),
      brokenImages:Array.from(document.images).filter(el=>!el.complete||!el.naturalWidth).length,
      oversizedCards:Array.from(document.querySelectorAll('.ad-report-card')).filter(el=>el.getBoundingClientRect().height>930).length,
      images:document.images.length,cards:document.querySelectorAll('.ad-report-card').length
    }));
    assert.ok(metrics.scroll<=metrics.width+1,name+' horizontal overflow');
    assert.ok(metrics.bodyFont>=14,name+' body smaller than 10.5pt');
    assert.ok(metrics.tableFonts.every(size=>size>=12),name+' table smaller than 9pt');
    assert.equal(metrics.brokenImages,0,name+' missing images');
    assert.equal(metrics.oversizedCards,0,name+' ad card exceeds printable page');
    if(name!=='empty'){assert.ok(metrics.cards>=4,name+' missing ad cards');assert.ok(metrics.images>=4,name+' missing embedded creative images')}
    await page.screenshot({path:`${output}/${name}-flow.png`,fullPage:true});
    await page.close();
    const {buffer}=await renderReportPdf(ctx,{executablePath});
    const path=`${output}/${name}.pdf`;await writeFile(path,buffer);
    let pages=null;
    if(hasPoppler){
      const info=command('pdfinfo',[path]);pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      assert.ok(pages>=1&&pages<=35,name+' unexpected page count: '+pages);
      command('pdftotext',['-layout',path,`${output}/${name}.txt`]);
      const text=await readFile(`${output}/${name}.txt`,'utf8'),pageTexts=text.split('\f').filter(part=>part.trim());
      assert.equal(pageTexts.length,pages,name+' blank pages or extraction mismatch');
      for(let i=0;i<pageTexts.length;i++){
        const body=pageTexts[i].replace(/Markets Pulse by Turkcell/g,'').replace(/Sayfa\s+\d+\s*\/\s*\d+/g,'').trim();
        assert.ok(body.length>45,`${name} near-empty page ${i+1}`);
        assert.match(pageTexts[i],new RegExp(`Sayfa\\s+${i+1}\\s*\\/\\s*${pages}`),`${name} page footer ${i+1}`);
      }
      // Every page, not just the cover: PNGs are the reviewable CI artifact.
      command('pdftoppm',['-png','-r','90',path,`${output}/${name}-page`]);
    }
    results.push({name,pages,bytes:buffer.length,...metrics});
    console.log('REPORT_LAYOUT '+JSON.stringify(results.at(-1)));
  }
  for(const name of ['daily','monthly','home','fwa']){
    const ctx=fixtures[name],html=emailHtml(ctx.type,ctx,[{filename:`markets-pulse-${name}.pdf`}],REPORT_NAMES,REPORT_TZ,monthlyOverviewHtml);
    await writeFile(`${output}/email-${name}.html`,html);
    for(const width of [700,390]){
      const page=await browser.newPage();await page.emulateMediaType('screen');
      await page.setViewport({width,height:1000,deviceScaleFactor:1});await page.setContent(html,{waitUntil:'load',timeout:60000});
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images,image=>image.decode()))});
      const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,images:document.images.length,
        brokenImages:Array.from(document.images).filter(el=>!el.complete||!el.naturalWidth).length,
        mode:document.querySelector('.ad-report')?.dataset.reportMode,
        clippedImages:Array.from(document.images).filter(el=>{const box=el.getBoundingClientRect();return box.x<0||box.right>innerWidth+1}).length
      }));
      await page.screenshot({path:`${output}/email-${name}-${width}.png`,fullPage:true});
      assert.ok(metrics.scroll<=width+1,`email ${name} horizontal overflow ${width}: ${metrics.scroll}`);
      assert.equal(metrics.brokenImages,0,`email ${name} missing images ${width}`);
      assert.equal(metrics.clippedImages,0,`email ${name} image outside viewport ${width}`);
      assert.ok(metrics.images>=5,`email ${name} missing illustrated ad cards ${width}`);
      assert.equal(metrics.mode,'email',`email ${name} must render email ad markup`);
      emails.push({name,...metrics});console.log('EMAIL_LAYOUT '+JSON.stringify(emails.at(-1)));
      await page.close();
    }
  }
}finally{await browser.close()}
await writeFile(`${output}/metrics.json`,JSON.stringify({poppler:hasPoppler,reports:results,emails},null,2));
