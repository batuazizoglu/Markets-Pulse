import {socialDirectory} from './isp-registry.js';
export function validateObservation(input,sources){
  const brands=new Set(socialDirectory(sources).map(x=>x.brand));
  const brand=String(input?.brand||'').trim(),kind=String(input?.kind||'page');
  if(!brands.has(brand))throw new Error('Geçerli bir rakip seçin');
  if(!['ad','post','page'].includes(kind))throw new Error('Geçersiz gözlem türü');
  let url;try{url=new URL(String(input?.source_url||''))}catch{throw new Error('Geçerli bir kaynak bağlantısı girin')}
  const host=url.hostname.replace(/^(www|m)\./,'');
  if(url.protocol!=='https:'||url.username||url.password||!['facebook.com','instagram.com'].includes(host)||url.href.length>2048)throw new Error('Facebook veya Instagram HTTPS bağlantısı gerekli');
  const note=String(input?.note||'').trim();
  if(note.length<3||note.length>2000)throw new Error('Not 3–2000 karakter olmalı');
  return {brand,kind,source_url:url.href,note};
}
export function registerSocialWatchRoutes(app,pool,sources){
  app.get('/api/home-internet/social-observations',async(req,res,next)=>{
    try{const r=await pool.query('SELECT id,brand,kind,source_url,note,created_at FROM social_watch_observations ORDER BY created_at DESC,id DESC LIMIT 200');res.json({rows:r.rows,mode:'manual',automatic_status:'see_ad_visuals'})}catch(e){next(e)}
  });
  app.post('/api/home-internet/social-observations',async(req,res,next)=>{
    // JSON and same-origin requests only. Authentication is applied by registerAuth.
    if(!req.is('application/json'))return res.status(415).json({error:'JSON gerekli'});
    if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Aynı siteden gönderim gerekli'});
    const origin=req.get('origin');
    if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Geçersiz kaynak'})}catch{return res.status(403).json({error:'Geçersiz kaynak'})}}
    let data;try{data=validateObservation(req.body,sources)}catch(e){return res.status(400).json({error:e.message})}
    try{
      const r=await pool.query('INSERT INTO social_watch_observations(brand,kind,source_url,note,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,brand,kind,source_url,note,created_at',
        [data.brand,data.kind,data.source_url,data.note,req.appUser.id]);
      res.status(201).json({row:r.rows[0]});
    }catch(e){next(e)}
  });
}
