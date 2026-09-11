export const SOURCE_DEFS = [
  { slug: 'faturali', name: 'Faturalı', url: 'https://www.kktctelsim.com/tr/tarifeler/tarifeler/faturali' },
  { slug: 'faturasiz', name: 'Faturasız', url: 'https://www.kktctelsim.com/tr/tarifeler/tarifeler/faturasiz' },
  { slug: 'diger-faturali', name: 'Diğer Faturalı Tarifeler', url: 'https://www.kktctelsim.com/tr/tarifeler/tarifeler/diger-faturali-tarifeler' }
];

export const TRACKED_FIELDS = [
  ['data_gb', 'Data', 'high'],
  ['bonus_data_gb', 'Bonus Data', 'medium'],
  ['local_tr_minutes', 'Ada İçi + TR Dakika', 'high'],
  ['international_minutes', 'Uluslararası Dakika', 'high'],
  ['sms', 'SMS', 'medium'],
  ['validity_days', 'Geçerlilik (gün)', 'high'],
  ['red_passport_days', 'Red Pasaport (gün)', 'medium'],
  ['price_try', 'Fiyat', 'critical'],
  ['extras_json', 'Ek Fayda / Koşul', 'medium']
];
