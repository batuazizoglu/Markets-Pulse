# GSM tarife kimliğini kaynak ve kazanım kanalına bağlamak

Bu dal çevrimdışı çalışan bir prototiptir. Üretim tarayıcısının varsayılan eşleştiricisi, veritabanı başlangıç şeması ve e-posta işçisi mevcut kod yolunu kullanır.

## Mevcut sorun ve kimlik

`parser.js` paket adından `identity_base` üretirken GB/MB ifadelerini çıkarır. `scanner.js` fiziksel kartları önce `product_hash` ile tekilleştirir. `matcher.js` aktif ürünleri ad, fiyat yakınlığı, kota ve son pozisyon üzerinden puanlayarak sırayla eşleştirir. İki kanal aynı ticari koşullara sahipse kartlardan biri daha eşleştirme başlamadan kaybolabilir. İki kanal fiyatlarını değiş tokuş ederse eski fiyat yanlış ürünü öne çıkarabilir. #62’deki satıştan kalkmış Super Red koruması ayrı bir doğrulama adımıdır.

Kalıcı anahtar **(kaynak, kazanım kanalı, sağlayıcı paket ID’si)** üçlüsüdür. Kaynak, uygulamada kanonik slug, PostgreSQL’de bu slug’a bağlı `sources.id` olarak temsil edilir. Kanalın değerleri `port-in`, `new-customer`, `postpaid-conversion` ve `catalogue-only` olur. Son değer, incelenen katalogda doğrulanmış bir kazanım alt listesine atanmadığını ifade eder. Müşterinin uygunluğuna dair bir iddia içermez. Sağlayıcının sayısal CMS paket ID’si kalıcı bileşendir. Fiyat, kota, başvuru düğmesi, metin özeti, sıralama ve isim anahtara girmez. Veritabanındaki mevcut ürün ID’si geçmiş sürümlerin, bildirimlerin ve kanıt bağlantılarının adresi olarak kalır.

## Kanıt zinciri

1. Aynı gözlemde ana HTML’yi ve Diğer Faturalı için üç kanalın filtrelenmiş HTML’sini sakla. Kaynak adresini, etkin filtre bağlantısını ve filtre adını doğrula. Eski bir çalışmanın filtrelerini yeni kataloğa ekleme.
2. Next.js yanıtındaki veri çerçevelerini JSON olarak oku. Kartları çizen ızgaranın çocuk referanslarını çöz. Her fiziksel kartı aynı yanıtın aynı çizim yuvasındaki `packageData.id` ile ilişkilendir. DOM ve CMS başlık, ana kota, başlık fiyatı ve ticari alanlarda uyuşmalıdır. Yuva numarasının anlamı o yanıtla sınırlıdır.
3. Kanalı sağlayıcının ilgili filtrede yayımladığı ID’den doğrula. Aynı ID’nin ana ve filtrelenmiş sayfadaki kart kanıtı eşleşmelidir. Tanınmayan yapı, eksik filtre, çelişkili içerik, boş filtre için yetersiz kanıt veya çoklu kanal üyeliği bütün kaynağı incelemeye alır. Tedarikçinin daha sonra çoklu üyeliği resmen desteklemesi halinde bunun için ayrı sözleşme gerekir.
4. Mevcut kart doğrulamasını ham envanter üzerinde çalıştır. Aynı anahtar ancak aynı fiziksel içerik tekrar ediyorsa tekilleşir. Başlık ve fiyatları aynı olan farklı ID’ler ayrı kalır. Harici ID yenilenmesi veya kanal transferi eski anahtarın kaybolmasıyla çakışırsa ilişkilendirme incelemeye gider.
5. Önceki gözlem aynı anahtarla bulunduğunda mevcut ticari alan karşılaştırmasını kullan. Gerçek fiyat farkı normal önem seviyesinde bir olaydır. Sayfa henüz doğrulanmadıysa tarama hata vererek günlük, sürüm, eksik görülme sayacı ve e-posta üretiminden önce durur. Çevrimdışı önizleme olayları yalnız bellek içindedir.

### 26 Kasım 2026 tarihli halka açık sayfa tekrarı

| Kaynak | Fiziksel kart | Sonuç |
| --- | ---: | --- |
| Faturalı | 28 | 28 ayrı desteklenen kimlik |
| Faturasız | 31 | 27 ayrı desteklenen kimlik, 2 kapsam dışı kart, 2 tekrar |
| Diğer Faturalı | 182 | Kimlik envanteri okundu. Ana kart sözleşmesi 178. kartı reddetti, yayın önizlemesi durdu. |

Diğer Faturalı filtresinde 17 numara taşıma, 4 yeni müşteri ve 12 faturalı hatta geçiş kartı okundu. Bu alt listelerdeki kart içerikleri ana sayfada aynı ID ile yer alan kartlarla uyuştu. Super Simple 30 ana Faturalı sayfasında 543, Diğer Faturalı numara taşıma listesinde 549, faturalı hatta geçiş listesinde 595 ID’siyle geldi. Bu gözlem fiyat değişikliği zamanı veya gönderilmiş bir e-posta hakkında kanıt oluşturmaz.

Sayısal Red Box’ın 50/100/150/200 GB başlıkları sırasıyla 701/702/703/704 ID’leriyle geldi. Eski metin ayrıştırıcısının `12 Ay Tarifeye Ek` çıktısı eski gözlemi doğrulamak için kullanılır. Yeni başlığın kaynağı fiziksel kart başlığıdır. `Red Box Sınırsız` (705) mevcut açık kapsam dışı biçimdir. `5G Red Box Sınırsız` (756) ayrı bir üründür. Ana sayfanın 178. kartındaki `5G` kota başlığı mevcut sözleşmede tanınmadığı için Diğer Faturalı yayıma hazır değildir. Bu kartın sınırsız kullanım, fiyat ve satış durumunu doğrulayan ayrı bir biçim testi gerekir.

## Veri geçişi

- `docs/sql/tariff-product-identities.sql` hazırlama ortamı içindir. Kaynak/kanal/sağlayıcı ID’si benzersizdir. Bir iç ürün kaydı bir kalıcı kimliğe bağlanır. Bileşik dış anahtar kaynağı farklı bir ürünle bağlamayı engeller.
- `stageTariffBindings(tx, slug)` bir kopyadaki tüm aktif ve pasif ürünleri ve sürümlerini okur. Her sürüm için kendi başarılı taramasının tekil gzip HTML kopyası ve o taramaya ait gerekli filtre arşivleri gerekir. Bir sürümün yalnız bir aday paketi olmalıdır. Bundan sonra kayıtlı ham metin, hash ve izlenen ticari alanlar kontrol edilir. Aynı isimli iki adayı eski fiyat veya kart sırasıyla ayırmaz.
- Aynı ürünün farklı sürümleri farklı kalıcı anahtarlara çıkarsa, bir anahtara birden fazla iç ürün talipse veya bir sürümün kanıtı eksikse kaynak için sıfır bağ döner. Bu durum geçmişte birleşmiş olabilecek ürünleri ve ayırt edilemeyen Red Box gövde başlıklarını kapsar. Sonradan alınan kanal sayfası geçmiş kanıtın yerini tutmaz. Eski sistem her taramada HTML, her sürümde kanal HTML’si saklamadığı için bazı kaynaklar otomatik geçirilemeyebilir.
- Varsayılan yalnız okumadır. `stageTariffBindings(tx, slug, {writeBindings:true})` aynı hazırlama kopyasında açıkça çağrılırsa yalnız doğrulanmış bağları ekler. Aynı girdiyle tekrar çağrı aynı eşleşmeleri korur. İşlem dışına hata taşınırsa çağıran transaction tamamını geri almalıdır. Eski ürünler, sürümler, taramalar, görseller ve olaylar yeniden yazılmaz.
- Manuel incelemede tarihli ve ürüne bağlanabilir birincil kanıt gerekir. Kimlik kurtarılamıyorsa eski tarihçe açıkça eski döneme ait kalır. Onaylanmış yeni bir başlangıç gözlemiyle ayrı bir dönem açılabilir. Bu kararın iş akışı ve otomatik yeni dönem açılması prototip kapsamında değildir.

## Çalıştırma

Depo kökünden `node scripts/tariff-identity-replay.js manifest.json` komutunu çalıştır. Komut yalnız yerel dosyaları okur. Kabul edilen gözlemleri veya inceleme nedenini döndürür. İnceleme durumunun çıkış kodu 2’dir. Dosya yolları manifestin dizinine göredir.

```json
{
  "source": "diger-faturali",
  "pages": {
    "catalogue": "ana.html",
    "numara-tasima-teklifleri": "numara-tasima.html",
    "yeni-musteri-alimi-teklifleri": "yeni-musteri.html",
    "faturali-hatta-gecis-teklifleri": "faturaliya-gecis.html"
  }
}
```

Faturalı ve Faturasız için yalnız `pages.catalogue` gerekir. İsteğe bağlı `previous` listesinde son kabul edilen gözlemler ve her birinin `productId`, `active`, `missingCount` alanları bulunur. İlk geçerli gözlem başlangıçtır. CLI aynı zamanda `products` (kaynak, iç ürün ID’si, orijinal sürümler) ve `archives` (tarama ID’sinden o taramanın sayfa dosyalarına eşleme) ile çevrimdışı geçiş planı üretir. PostgreSQL biçimli sürüm dışa aktarımı `id`, `scan_id`, `name`, `product_hash`, `raw_text` ve tüm izlenen alanları içermelidir. DB delilleri için transaction alan hazırlama fonksiyonu tercih edilir.

## Canlıya geçiş için kabul koşulları

1. Her kaynak için taslağı eski okuyucuyla aynı gözlemler üzerinde gölge modda çalıştır. Tam envanteri, kabul/ret nedenlerini, eksik tarihli kanıtları ve fiyat olaylarını karşılaştır. Diğer Faturalı için 178. kart ve tarihsel bağ incelemesi açık koşullardır.
2. Yeni yayın yolunu bağlarken aynı kaynağın yazıcılarını bir kaynak satırı kilidi altında sırala. Başarılı son taramadan eski veya tekrar teslim edilen taramayı reddet. `(source_id,scan_id)` kabul kaydı, bağlar, sürümler, eksik sayacı ve olayları tek transaction’da yaz. Ardışık iki ayrı başarılı taramada yokluk doğrulanınca kaldırma üret. DB kimliğini yeniden görülen kayıtta koru.
3. Kaynağa ait geçiş planı tam ve tarihsel kayıt sayıları/içerikleri birebir korunmuş olmalı. Her kabul edilmiş gerçek fiyat farkı aynı ürün kimliğiyle mevcut GSM bildirim kuyruğuna bir kez ulaşmalı. Timeline ve e-postada kaynak, fiziksel başlık ve kanalın okunabilir adını göster. Canlı yayın adaptörü, görünüm değişiklikleri ve e-posta gönderimi bu dalda etkinleştirilmez.
4. Sorunda ilgili kaynağı son doğrulanmış görünümde beklet. Gölge sonuçları olay olarak yeniden oynatma. Kanal kimlikleriyle yazılmış katalogda eski puanlı eşleştiriciye otomatik geri dönmek ayrı teklifleri yeniden karıştırabilir.

Üretim durumu hakkında çıkarım için tarama ve gönderim kayıtları ayrıca incelenmelidir. Bu prova kaynak HTML’si ve yalıtılmış test verisiyle yapılmıştır.
