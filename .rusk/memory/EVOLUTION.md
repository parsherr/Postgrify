# Evolution — Hatalar ve Dersler

## 2026-08-04 — .env.example izin hatası
**Hata:** `.env.example` yazılırken "directory denied" aldım.
**Neden:** `.claude/` altına yazmaya çalışmış olabilir (path collision).
**Ders:** Root dosyaları için mutlak path `/home/dogukan/Documents/github/postgrify/` ile yazmak güvenli.

## 2026-08-04 — /loop cron 120m geçersiz
**Hata:** `*/120 * * * *` geçerli bir cron ifadesi değil (dakika alanı 0-59).
**Ders:** 120 dakika = 2 saat = `0 */2 * * *`. CronCreate'e vermeden önce dönüşümü doğrula.