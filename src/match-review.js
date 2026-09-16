import { getKktcellCatalog } from './kktcell-benchmark.js';
import { ENGINE_VERSION, evaluateComparableProducts } from './comparable-engine.js';

export const LATEST_SQL=`SELECT p.id,p.identity_base,p.current_name,p.first_seen_at,p.last_seen_at,p.active,p.missing_count,p.last_position,
  s.slug source_slug,s.name source_name,s.url source_url,
  v.captured_at,v.name,v.data_gb,v.bonus_data_gb,v.local_tr_minutes,v.international_minutes,v.sms,v.validity_days,v.red_passport_days,v.price_try,v.extras_json,v.raw_text
  FROM products p JOIN sources s ON s.id=p.source_id
  LEFT JOIN LATERAL (SELECT * FROM product_versions v2 WHERE v2.product_id=p.id ORDER BY v2.captured_at DESC,v2.id DESC LIMIT 1) v ON TRUE
  WHERE p.active=TRUE ORDER BY s.id,v.price_try ASC NULLS LAST,p.current_name`;

export async function ensureMatchReviewSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS product_match_overrides (
    telsim_product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK (decision IN ('primary','secondary','reject')),
    kktcell_product_key TEXT,
    kktcell_product_name TEXT,
    note TEXT,
    engine_version TEXT,
    engine_score INTEGER,
    created_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (decision='reject' OR kktcell_product_key IS NOT NULL)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_product_match_overrides_decision ON product_match_overrides(decision,updated_at DESC)');
}

export async function loadComparableInputs(pool,{refresh=false,getCatalog=getKktcellCatalog,includeReviewers=false}={}){
  await ensureMatchReviewSchema(pool);
  const [tr,catalog,ov]=await Promise.all([
    pool.query(LATEST_SQL),getCatalog(refresh),
    pool.query(includeReviewers
      ? 'SELECT o.*,u.first_name,u.last_name,u.email FROM product_match_overrides o LEFT JOIN app_users u ON u.id=o.updated_by ORDER BY o.updated_at DESC'
      : 'SELECT telsim_product_id,decision,kktcell_product_key FROM product_match_overrides')
  ]);
  return {telsimRows:tr.rows,catalog,overrides:ov.rows};
}

export async function buildMatchReviewSnapshot(pool,{refresh=false}={}){
  const {telsimRows,catalog,overrides}=await loadComparableInputs(pool,{refresh,includeReviewers:true});
  return evaluateComparableProducts(telsimRows,catalog.rows,overrides);
}

export async function saveMatchOverride(pool,{telsimProductId,decision,kktcellProductKey,note,userId,refresh=false}){
  await ensureMatchReviewSchema(pool);const id=Number(telsimProductId);if(!Number.isFinite(id))throw new Error('Geçersiz Telsim ürün ID');if(!['primary','secondary','reject'].includes(decision))throw new Error('Geçersiz karar');
  const snap=await buildMatchReviewSnapshot(pool,{refresh}),row=snap.rows.find(x=>x.telsim_product_id===id);if(!row)throw new Error('Telsim ürünü bulunamadı');let key=null,name=null,score=row.engine_score;
  if(decision!=='reject'){key=String(kktcellProductKey||'');const c=row.candidates.find(x=>x.product?.key===key);if(!c)throw new Error('Seçilen KKTCELL ürünü bu ürün için karşılaştırılabilir aday değil');name=c.product.name;score=c.score}
  const q=await pool.query(`INSERT INTO product_match_overrides(telsim_product_id,decision,kktcell_product_key,kktcell_product_name,note,engine_version,engine_score,created_by,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)
    ON CONFLICT(telsim_product_id) DO UPDATE SET decision=EXCLUDED.decision,kktcell_product_key=EXCLUDED.kktcell_product_key,kktcell_product_name=EXCLUDED.kktcell_product_name,note=EXCLUDED.note,engine_version=EXCLUDED.engine_version,engine_score=EXCLUDED.engine_score,updated_by=EXCLUDED.updated_by,updated_at=NOW()
    RETURNING *`,[id,decision,key,name,String(note||'').trim().slice(0,1000)||null,ENGINE_VERSION,score,userId]);return q.rows[0];
}
export async function deleteMatchOverride(pool,telsimProductId){await ensureMatchReviewSchema(pool);const r=await pool.query('DELETE FROM product_match_overrides WHERE telsim_product_id=$1 RETURNING *',[Number(telsimProductId)]);return r.rows[0]||null}
