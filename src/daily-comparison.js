import {rebaseCardBoundaries} from './parser.js';

const NUMERIC_FIELDS=['data_gb','bonus_data_gb','local_tr_minutes','international_minutes','sms','validity_days','price_try'];

// Compare the same isolated tariff on each side of midnight. Keep observation
// timestamps/IDs and original database rows intact; do not expose helper raw data.
export function dailyComparisonRow({_current_observation:current,_previous_observation:previous,...row}) {
  for (const [prefix,observation] of [['current',current],['previous',previous]]) {
    if (!observation) continue;
    const corrected=rebaseCardBoundaries(observation);
    for (const field of NUMERIC_FIELDS) row[`${prefix}_${field}`]=corrected[field];
  }
  const diffs={};
  for (const field of NUMERIC_FIELDS) {
    const a=row[`previous_${field}`],b=row[`current_${field}`];
    const old=a==null?null:Number(a),value=b==null?null:Number(b);
    diffs[field]={old,new:value,delta:old==null||value==null?null:value-old,pct:old&&value!=null?((value-old)/old)*100:null};
  }
  const changed=Object.values(diffs).some(diff=>diff.old!==diff.new)
    ||(row.previous_name!=null&&row.previous_name!==row.current_name_version);
  return {...row,diffs,changed};
}
