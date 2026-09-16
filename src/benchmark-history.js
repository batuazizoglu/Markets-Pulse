import { ENGINE_VERSION } from './comparable-engine.js';

function benchmarkHourBucket(date=new Date()){
  const d=new Date(date);
  d.setUTCMinutes(0,0,0);
  return d;
}

export async function persistBenchmarkHistory(pool,benchmark,{now=new Date()}={}){
  const scores=[benchmark.overall_score,...(benchmark.segment_scores||[])].filter(Boolean);
  const bucket=benchmarkHourBucket(now);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let rowCount=0;
    for(const s of scores){
      const p=s.positions||{};
      const saved=await client.query(`INSERT INTO competitive_position_history(
        bucket_at,captured_at,segment,score,level,confidence,match_count,
        kktcell_advantage_count,telsim_advantage_count,parity_count,
        avg_value_gap_pct,avg_match_score,rationale,details_json
      ) VALUES($1,NOW(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
      ON CONFLICT(segment,bucket_at) DO UPDATE SET
        captured_at=EXCLUDED.captured_at,score=EXCLUDED.score,level=EXCLUDED.level,
        confidence=EXCLUDED.confidence,match_count=EXCLUDED.match_count,
        kktcell_advantage_count=EXCLUDED.kktcell_advantage_count,
        telsim_advantage_count=EXCLUDED.telsim_advantage_count,parity_count=EXCLUDED.parity_count,
        avg_value_gap_pct=EXCLUDED.avg_value_gap_pct,avg_match_score=EXCLUDED.avg_match_score,
        rationale=EXCLUDED.rationale,details_json=EXCLUDED.details_json
      WHERE competitive_position_history.details_json->>'engine_version'=EXCLUDED.details_json->>'engine_version'
      RETURNING id`,[
        bucket,s.segment,s.score,s.level,s.confidence,s.match_count||0,
        p.KKTCELL_ADVANTAGE||0,p.TELSIM_ADVANTAGE||0,p.PARITY||0,
        s.avg_value_gap_pct,s.avg_match_score,s.rationale||null,JSON.stringify({...s,engine_version:benchmark.engine_version})
      ]);
      rowCount+=saved.rows.length;
    }
    await client.query('COMMIT');
    return {persisted:rowCount>0,bucket_at:bucket.toISOString(),row_count:rowCount,reason:rowCount?null:'Önceki motorun saatlik kaydı korundu; yeni tarihçe sonraki saat başlar.'};
  }catch(e){
    await client.query('ROLLBACK');
    throw e;
  }finally{client.release()}
}

export function buildBenchmarkHistoryPayload(rows,requestedDays){
  rows=rows.filter(row=>row.details_json?.engine_version===ENGINE_VERSION);
  const groups=new Map();
  for(const row of rows){
    if(!groups.has(row.segment)) groups.set(row.segment,[]);
    groups.get(row.segment).push(row);
  }
  const dayFmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Famagusta',year:'numeric',month:'2-digit',day:'2-digit'});
  const horizons=[7,30,90];
  const trends={};
  for(const [segment,items] of groups){
    items.sort((a,b)=>new Date(a.bucket_at)-new Date(b.bucket_at));
    const latest=items[items.length-1];
    const latestMs=new Date(latest.bucket_at).getTime();
    const deltas={};
    const baselines={};
    for(const h of horizons){
      const target=latestMs-h*86400000;
      let baseline=null;
      for(const row of items){
        if(new Date(row.bucket_at).getTime()<=target) baseline=row; else break;
      }
      baselines[`${h}d`]=baseline?{score:baseline.score==null?null:Number(baseline.score),bucket_at:baseline.bucket_at}:null;
      deltas[`${h}d`]=(baseline&&baseline.score!=null&&latest.score!=null)?Number(latest.score)-Number(baseline.score):null;
    }
    const daily=new Map();
    for(const row of items){
      const day=dayFmt.format(new Date(row.bucket_at));
      daily.set(day,{day,bucket_at:row.bucket_at,score:row.score==null?null:Number(row.score),level:row.level,confidence:row.confidence,match_count:Number(row.match_count||0),avg_value_gap_pct:row.avg_value_gap_pct==null?null:Number(row.avg_value_gap_pct)});
    }
    const series=[...daily.values()].filter(x=>x.score!=null).slice(-Math.max(1,requestedDays));
    trends[segment]={
      segment,
      latest:{score:latest.score==null?null:Number(latest.score),bucket_at:latest.bucket_at,level:latest.level,confidence:latest.confidence,match_count:Number(latest.match_count||0),rationale:latest.rationale},
      deltas,baselines,series
    };
  }
  const first=rows.length?rows.reduce((a,b)=>new Date(a.bucket_at)<new Date(b.bucket_at)?a:b):null;
  return {generated_at:new Date().toISOString(),requested_days:requestedDays,first_recorded_at:first?.bucket_at||null,record_count:rows.length,trends};
}

