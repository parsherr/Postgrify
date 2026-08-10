# Tweeter Clone — Postgrify Test Projesi

Postgrify REST API ve `@postgrify/auth-js` SDK'sını gerçek dünya senaryosunda test etmek
için yazılmış minimal Twitter klonu.

## Amaç

Postgrify'ın şu özelliklerini test etmek:
- Per-DB auth (kayıt, giriş, hesap silme)
- Row CRUD (tweet oluşturma, silme)
- Görsel paylaşma
- Takip sistemi (follows)
- Timeline sorguları (JOIN, subquery)

## Kurulum

```bash
# Postgrify'ın çalışıyor olması gerekiyor
cd packages && docker compose up -d

# Token ve API URL'ini config.js'de ayarla
# Sonra setup'ı çalıştır:
node src/setup.js

# Uygulamayı başlat:
node src/serve.js
# → http://localhost:4000 adresinde açılır
```

## Bulgulan Sorunlar

Tüm sorunlar proje kökündeki `database-issues.md` dosyasında detaylıca belgelenmiştir.

## Dosya Yapısı

```
tweeter-clone/
├── src/
│   ├── config.js        — API URL, token ayarları
│   ├── setup.js         — Veritabanı ve tablo kurulumu
│   ├── api.js           — Postgrify REST API wrapper
│   ├── serve.js         — Basit HTTP sunucu (static + API proxy)
│   └── app.js           — Frontend uygulama mantığı (vanilla JS)
├── public/
│   ├── index.html       — Ana sayfa
│   └── style.css        — Stiller
└── README.md
```