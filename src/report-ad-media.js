import {createHash} from 'node:crypto';
import {getAdReport} from './ad-visual.js';
import {prepareAdReportImages} from './ad-report-images.js';
import {adVisualReportHtml} from './ad-visual-report.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const imageUrl=sha256=>'https://www.marketspulse.cloud/report-media/'+sha256+'.jpg';

export async function buildAdReportSection(pool,type,start,end){
  if(!['daily','weekly','monthly','home','fwa','telsim7'].includes(type))return {ad_analysis_html:'',ad_analysis_html_pdf:''};
  const data=await getAdReport(pool,start,end,{category:['home','fwa'].includes(type)?'home':undefined});
  if(type==='telsim7')data.rows=data.rows.filter(row=>row.analysis_json.brand==='Telsim');
  const prepared=await prepareAdReportImages(pool,data);
  const byHash=new Map(),published=new Set();
  const proven=image=>image&&['creative','browser_creative'].includes(image.selection);
  const publishable=new Set(prepared.data.rows.filter(row=>proven(row.report_image)).map(row=>row.report_image.sha256));
  for(const image of prepared.images){
    if(!Buffer.isBuffer(image.content)||image.contentType!=='image/jpeg'||image.content.length>153600||hash(image.content)!==image.sha256)throw new Error('REPORT_IMAGE_INVALID');
    byHash.set(image.sha256,image);
    // A general screenshot may include account/page chrome. Only a proved
    // creative is published; unverified archive evidence remains PDF-only.
    if(publishable.has(image.sha256)){
      try{
        await pool.query('INSERT INTO ad_report_image_assets(sha256,jpeg,width,height) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[image.sha256,image.content,image.width,image.height]);
        published.add(image.sha256);
      }catch{console.warn('[ad-report-images]',JSON.stringify({code:'REPORT_IMAGE_PUBLISH_FAILED'}))}
    }
  }
  let withheld=0;
  const emailRows=prepared.data.rows.map(row=>{
    if(!row.report_image||proven(row.report_image)&&published.has(row.report_image.sha256))return row;
    withheld++;const {report_image,...rest}=row;return rest;
  });
  const emailData={...prepared.data,rows:emailRows,image_summary:{...prepared.data.image_summary,
    prepared:prepared.data.image_summary.prepared-withheld,unavailable:prepared.data.image_summary.unavailable+withheld,
    total_bytes:[...published].reduce((total,id)=>total+byHash.get(id).content.length,0)}};
  return {
    ad_analysis_html:adVisualReportHtml(emailData,{mode:'email',imageSrc:image=>published.has(image.sha256)?imageUrl(image.sha256):null}),
    ad_analysis_html_pdf:adVisualReportHtml(prepared.data,{mode:'pdf',imageSrc:image=>byHash.has(image.sha256)?'data:image/jpeg;base64,'+byHash.get(image.sha256).content.toString('base64'):null}),
    ad_report_image_summary:emailData.image_summary
  };
}

export function registerReportMediaRoutes(app,pool){
  // These are derived copies of public advertisements prepared for reports.
  // Original evidence, analysis text and the rest of the app remain authenticated.
  app.get('/report-media/:hash.jpg',async(req,res,next)=>{
    if(!/^[a-f0-9]{64}$/.test(req.params.hash))return res.status(404).end();
    try{
      const result=await pool.query('SELECT jpeg FROM ad_report_image_assets WHERE sha256=$1',[req.params.hash]);
      if(!result.rows[0])return res.status(404).end();
      res.set({'Content-Type':'image/jpeg','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'cross-origin'}).send(Buffer.from(result.rows[0].jpeg));
    }catch(error){next(error)}
  });
}
