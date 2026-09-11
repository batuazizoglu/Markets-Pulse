export function matchCardsToProducts(cards, products) {
  const pairs = [];
  for (let ci = 0; ci < cards.length; ci++) {
    for (let pi = 0; pi < products.length; pi++) {
      const c = cards[ci], p = products[pi];
      const score = matchScore(c, p);
      if (score >= 50) pairs.push({ ci, pi, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const usedCards = new Set();
  const usedProducts = new Set();
  const matches = new Map();

  for (const pair of pairs) {
    if (usedCards.has(pair.ci) || usedProducts.has(pair.pi)) continue;
    usedCards.add(pair.ci);
    usedProducts.add(pair.pi);
    matches.set(pair.ci, products[pair.pi]);
  }
  return matches;
}

function matchScore(c, p) {
  let s = 0;
  if (c.identity_base === p.identity_base) s += 50;
  if (c.name === p.current_name) s += 28;
  if (sameNullable(c.validity_days, p.validity_days)) s += 12;
  if (sameNullable(c.red_passport_days, p.red_passport_days)) s += 4;
  if (sameNullable(c.price_try, p.price_try)) s += 16;
  else if (near(c.price_try, p.price_try, 0.08)) s += 8;
  if (c.position === p.last_position) s += 10;
  else if (Number.isFinite(p.last_position) && Math.abs(c.position - p.last_position) === 1) s += 5;
  if (sameNullable(c.data_gb, p.data_gb)) s += 7;
  return s;
}

function sameNullable(a,b){ return (a == null && b == null) || (a != null && b != null && Number(a) === Number(b)); }
function near(a,b,pct){
  if (a == null || b == null) return false;
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return false;
  return Math.abs(x-y)/Math.abs(y) <= pct;
}
