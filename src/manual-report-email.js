import { sendReportEmail, refreshReportRecipients } from './report-email.js';

function normalizeEmail(v){
  const email=String(v||'').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}

function personalRecipientPool(pool,email){
  const recipientQuery=/select\s+email\s+from\s+app_users\s+where\s+active\s*=\s*true/i;
  return new Proxy(pool,{
    get(target,prop,receiver){
      if(prop==='query'){
        return async (sql,params)=>{
          if(recipientQuery.test(String(sql||''))) return {rows:[{email}],rowCount:1};
          return target.query(sql,params);
        };
      }
      const value=Reflect.get(target,prop,receiver);
      return typeof value==='function'?value.bind(target):value;
    }
  });
}

export async function sendPersonalReportEmail(pool,type,userEmail,options={}){
  const email=normalizeEmail(userEmail);
  if(!email){
    const e=new Error('Hesabınıza bağlı geçerli bir e-posta adresi bulunamadı.');
    e.code='PERSONAL_EMAIL_REQUIRED';
    throw e;
  }
  const scopedPool=personalRecipientPool(pool,email);
  try{
    const result=await sendReportEmail(scopedPool,type,options);
    return {...result,recipients:['1 kişi'],recipient_count:1,recipient_mode:'manual-user',delivery_to:email};
  }finally{
    // Manuel gönderim, otomatik toplu dağıtım listesini kalıcı olarak değiştirmemeli.
    await refreshReportRecipients(pool).catch(e=>console.error('[report-email] recipient restore failed',e?.message||String(e)));
  }
}
