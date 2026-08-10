/**
 * config.js — Tweeter Clone Yapılandırması
 *
 * WHY: Tüm Postgrify bağlantı ayarları tek bir dosyada tutuldu ki
 * farklı ortamlarda (Docker, local) kolayca değiştirilebilsin.
 *
 * SORUN NOTU: Bu dosyada DB_TOKEN'ı saklamak production'da güvensiz.
 * Postgrify şu an per-DB auth user token'larına data API erişimi
 * vermiyor (database-issues.md #7). Bu yüzden burada bir DB scope token
 * hardcode edilmek zorunda — gerçek bir uygulamada bu backend'de tutulur.
 */

export const config = {
  // Postgrify API base URL
  apiUrl: process.env.POSTGRIFY_URL || 'http://localhost:3000',

  // Veritabanı adı — Postgrify'da önceden oluşturulmuş olmalı
  database: process.env.DB_NAME || 'twitter',

  // Admin secret — tablo oluşturma ve token üretmek için
  // SADECE setup aşamasında kullanılır, frontend'e verilmez
  adminSecret: process.env.ADMIN_SECRET || 'change-me-admin-secret',

  // Admin email/password — admin token almak için (opsiyonel)
  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',

  // Sunucu portu
  port: parseInt(process.env.PORT || '4000', 10),
};