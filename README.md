# Telsim Tarife Watch — Railway Cloud

KKTC Telsim'in üç resmi tarife sayfasını saatlik izleyen canlı rekabet takip dashboard'u.

## İzlenen sayfalar
- https://www.kktctelsim.com/tr/tarifeler/tarifeler/faturali
- https://www.kktctelsim.com/tr/tarifeler/tarifeler/faturasiz
- https://www.kktctelsim.com/tr/tarifeler/tarifeler/diger-faturali-tarifeler

## Mimari
- Node.js 20 + Express
- Railway PostgreSQL
- node-cron ile saatlik tarama
- Railway public domain üzerinden dashboard
- İlk başarılı tarama baseline
- Paket adı, data, bonus data, dakika, uluslararası dakika, SMS, geçerlilik, Red Pasaport günü, fiyat ve fayda/koşul değişiklikleri
- Yeni paket / kaldırılan paket algılama
- Kaldırılma için 2 ardışık tarama doğrulaması
- Değişiklikte sıkıştırılmış HTML + extracted JSON evidence snapshot
- Ürün geçmişi ekranı

## Railway kurulumu
1. Yeni Railway Project oluşturun.
2. PostgreSQL ekleyin.
3. Bu GitHub repository'yi source olarak bağlayın.
4. Uygulama servisine PostgreSQL `DATABASE_URL` değişkenini bağlayın.
5. İsteğe bağlı `DASHBOARD_USER` ve `DASHBOARD_PASSWORD` ekleyin.
6. Deploy edin. Uygulama açılıştan 5 saniye sonra ilk baseline taramasını otomatik yapar.

Railway `PORT` değişkenini kendisi sağlar. `railway.json` health check `/api/health` yolunu kullanır.

## Ortam değişkenleri
- `DATABASE_URL` (zorunlu)
- `SCAN_CRON` varsayılan: `0 * * * *`
- `TZ` varsayılan: `Asia/Famagusta`
- `DASHBOARD_USER` / `DASHBOARD_PASSWORD` isteğe bağlı Basic Auth

## API
- `GET /api/health`
- `GET /api/summary`
- `GET /api/packages`
- `GET /api/changes?limit=80`
- `GET /api/scans?limit=30`
- `GET /api/product/:id/history`
- `GET /api/snapshots`
- `POST /api/scan`
