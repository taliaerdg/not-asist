# Not Asist

Türkçe ve İngilizce çıktı sunan, belgeleri ve ders notlarını çalışma rehberlerine dönüştüren web uygulaması.

## Bilgisayarda çalıştırma

1. Node.js 22.13+ veya 24+ kurun.
2. `npm install` komutunu çalıştırın.
3. `.env.example` dosyasını `.env` olarak kopyalayın. İsteğe bağlı olarak `GEMINI_API_KEY` (ücretsiz) veya `OPENAI_API_KEY` ekleyin. Anahtar yoksa belge analizi yerel, kaynak metne dayalı modda çalışır.
4. `npm start` komutuyla sunucuyu başlatın ve `http://localhost:3000` adresini açın.

Canlı dikte Chrome/Edge SpeechRecognition desteğini kullanır; tarayıcıdan mikrofon izni verilmesi gerekir. Ses dosyası transkripsiyonu bir AI anahtarı gerektirir.

## Arkadaşlarla paylaşma (tek anahtar, tek link)

Uygulama tek bir Gemini anahtarıyla internette yayınlandığında şu korumalar devreye girer (hepsi `.env` / ortam değişkenleriyle ayarlanır):

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `ACCESS_CODE` | boş | Doluysa uygulama açılışta bu şifreyi sorar. Linki bilen yabancılar kotanı harcayamaz. |
| `DAILY_AI_LIMIT_PER_USER` | 15 | Bir kişinin (tarayıcının) günlük AI analiz hakkı. Hak bitince yerel analiz çalışır. |
| `DAILY_AI_LIMIT_TOTAL` | 200 | Herkes için toplam günlük AI analiz sınırı. Her analiz 2 Gemini isteği kullanır; Flash-Lite ücretsiz katmanı günde yaklaşık 500 istek verir. |
| `AI_REQUESTS_PER_MINUTE` | 8 | Dakikalık AI istek sınırı. Yoğunlukta istekler kısa süre bekletilir, olmazsa yerel analiz gösterilir. |
| `GEMINI_MODEL` | gemini-3.5-flash-lite | Kullanılacak Gemini modeli. |
| `GEMINI_FALLBACK_MODEL` | gemini-3.1-flash-lite | Ana model yoğunsa (503) veya kotası dolduysa (429) denenecek yedek model; kotası ayrıdır. `none` ile kapatılır. |

Günlük haklar Gemini kotasıyla aynı anda (Pasifik saatiyle gece yarısı, Türkiye saatiyle 10:00 veya 11:00) yenilenir. Sayaçlar sunucu belleğinde tutulur; sunucu yeniden başlarsa sıfırlanır, ama toplam sınır ve Google'ın kendi kotası yine de korur. Gemini yoğunsa uygulama kısa bekleyip tekrar dener, sonra yedek modele geçer; ikisi de olmazsa hata vermez, yerel analize geçer.

### Render'da yayınlama

1. Projeyi GitHub'a gönderin (VS Code → Source Control → Publish to GitHub, private depo). `.env` ve `node_modules` `.gitignore` sayesinde yüklenmez.
2. render.com → New → Web Service → depoyu seçin. Runtime: Node, Build Command: `npm install`, Start Command: `npm start`, Instance Type: Free.
3. Environment Variables bölümüne `GEMINI_API_KEY` ve `ACCESS_CODE` ekleyin (istenirse diğer değişkenler de). `PORT` eklemeyin.
4. Deploy edin ve verilen `https://...onrender.com` linkini şifreyle birlikte paylaşın.

Ücretsiz planda sunucu 15 dakika kullanılmazsa uyur; ilk açılış yaklaşık bir dakika sürer.

## Özellikler

- PDF, DOCX, TXT ve Markdown dosyalarından metin çıkarma; PDF içindeki renkli metni ve vurgulama/altını çizme ek açıklamalarını tespit etme.
- Çıktı dili seçimi: Türkçe (AI etkinse teknik terimlerin İngilizce karşılıklarıyla) veya İngilizce.
- Bölüm bölüm, sınav odaklı özet (genel bakış + her başlık için maddeler, ★ ile en kritik noktalar), terim sözlüğü, önemli nokta listesi, açık uçlu, doğru/yanlış ve çoklu seçim soruları.
- API anahtarı yoksa yerel özetleyici (`summarizer.js`) PDF'in başlık/slayt yapısını çıkarır, cümleleri tanım, vurgu, karşılaştırma gibi ipuçlarına göre puanlar ve her bölümden en önemli maddeleri seçer. API anahtarı varsa özet AI tarafından kendi cümleleriyle, çok daha ayrıntılı yazılır.
- Ses dosyası transkripsiyonu (Gemini veya OpenAI) ve tarayıcıda canlı dikte.
- Koyu/açık tema, indirilebilir Markdown çalışma rehberi ve mobil uyumlu arayüz.

## Yapı

- `server.js`: Express API ve dosya işleme.
- `ai.js`: Gemini ve OpenAI entegrasyonu (analiz ve ses transkripsiyonu).
- `access.js`: giriş şifresi, günlük kullanım hakları ve istek sınırları.
- `summarizer.js`: API anahtarı gerektirmeyen yerel özetleme motoru.
- `public/index.html`, `public/styles.css`, `public/app.js`: istemci uygulaması.
- `GET /api/health`, `POST /api/verify-access`, `POST /api/analyze`, `POST /api/transcribe`: API uç noktaları.

Dosyalar bellekte işlenir ve sunucuya kalıcı olarak kaydedilmez. AI anahtarı yapılandırıldığında belge metinleri analiz için ilgili sağlayıcıya iletilir. Gemini'nin ücretsiz katmanında (AB dışından) gönderilen içerik Google tarafından ürün geliştirmede kullanılabilir; kişisel veya gizli belgeler yüklemeyin. API anahtarını istemciye koymayın; sadece sunucudaki `.env` dosyasını veya barındırma platformunun ortam değişkenlerini kullanın.
