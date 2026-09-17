import { buildBenchmark } from './kktcell-benchmark.js';
import { loadComparableInputs } from './match-review.js';

// Dashboard, scheduled scores and every report use the same catalog + saved decisions.
export async function currentBenchmark(pool,{refresh=false,getCatalog}={}){
  const {telsimRows,catalog,overrides}=await loadComparableInputs(pool,{refresh,getCatalog});
  return {...buildBenchmark(telsimRows,catalog.rows,overrides,{sources:catalog.sources}),kktcell_sources:catalog.sources,
    kktcell_catalog_count:catalog.rows.length,kktcell_core_count:catalog.rows.filter(x=>x.is_core).length,kktcell_error:catalog.error};
}
