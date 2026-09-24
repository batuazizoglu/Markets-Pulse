import { sendReportEmail } from './report-email.js';

function normalizeEmail(v){
  const email=String(v||'').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}

export async function sendPersonalReportEmail(pool,type,userEmail,options={}){
  const email=normalizeEmail(userEmail);
  if(!email){
    const e=new Error('Hesabınıza bağlı geçerli bir e-posta adresi bulunamadı.');
    e.code='PERSONAL_EMAIL_REQUIRED';
    throw e;
  }
  const result=await sendReportEmail(pool,type,{...options,recipientEmails:[email]});
  return {...result,recipients:['1 kişi'],recipient_count:1,recipient_mode:'manual-user',delivery_to:email};
}
