// Local-only preview. Synthetic records; no production connection or email jobs.
import express from 'express';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { registerEvidenceRoutes } from '../src/evidence-archive.js';
import { createEvidenceFixture } from './evidence-fixture.js';
const {pool}=await createEvidenceFixture();
const app=express(),publicDir=fileURLToPath(new URL('../public/',import.meta.url));
app.use((req,res,next)=>{req.appUser={id:1,role:'standard',first_name:'Örnek',last_name:'Kullanıcı',username:'preview'};next();});
registerEvidenceRoutes(app,pool);
app.get('/api/auth/me',(req,res)=>res.json({user:req.appUser}));
app.get('/api/summary',async(req,res)=>res.json({active_products:9,changes_today:1,changes_24h:1,sources:(await pool.query('SELECT *,3 active_products,3 parsed_count FROM sources')).rows}));
for(const route of ['/api/packages','/api/changes','/api/timeline','/api/value-index'])app.get(route,(req,res)=>res.json([]));
app.get('/api/comparison',(req,res)=>res.json({rows:[]}));
app.get('/api/market-pulse',(req,res)=>res.json({pressure:{score:0,label:'Örnek veri'},top_threats:[],intent_mix:[],segment_mix:[],summary:{},changes:[]}));
app.get('/api/benchmark',(req,res)=>res.json({matches:[],segment_scores:[],segment_summary:[],sources:[],overall_score:{score:66,level:'Örnek'},catalog:{sources:[]}}));
app.get('/api/benchmark-history',(req,res)=>res.json({series:{},points:[]}));
app.get('/api/home-internet',(req,res)=>res.json({products:[],sources:[],changes:[],summary:{}}));
app.get('/api/reports/status',(req,res)=>res.json({email:{configured:false},recent_runs:[]}));
app.get('/',async(req,res)=>{
  let html=await readFile(path.join(publicDir,'index.html'),'utf8');
  const notice='<div style="position:fixed;z-index:1000;bottom:0;left:0;background:#fff3bc;color:#453200;padding:4px 10px;font:10px sans-serif">ÖNİZLEME · ÖRNEK VERİ</div>';
  html=html.replace('<body>','<body>'+notice);
  res.send(html);
});
app.use(express.static(publicDir));app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
export { app };
if(!process.env.EVIDENCE_PREVIEW_BUILD)app.listen(4173,'127.0.0.1',()=>console.log('Evidence preview: http://127.0.0.1:4173/#evidence'));
