# Architecture Decisions

## ADR-001: Lazy Connection Pool
**Karar:** Her DB için lazy postgres.js pool (ilk istekte aç, idle'da kapat)
**Neden:** Aktif olmayan DB'ler için kaynak israfı önlenir; 100 DB tanımlı olsa bile yalnızca kullanılanlar bağlantı tutar.

## ADR-002: Redis Opsiyonel
**Karar:** Redis URL yoksa in-memory LRU (lru-cache) devreye girer
**Neden:** Küçük kurulumlar için Redis zorunlu kılmak overhead; production'da Redis önerilir.

## ADR-003: SELECT-only Ham SQL
**Karar:** /db/:db/query endpoint'i varsayılan olarak yalnızca SELECT kabul eder
**Neden:** Yetkisiz DDL/DML koruması; admin token + ALLOW_RAW_SQL_ADMIN=true ile açılır.

## ADR-004: Identifier Validation
**Karar:** Tablo/kolon/DB adları `/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/` regex + reserved keyword blocklist
**Neden:** SQL injection'ın parametrik sorgu dışındaki vektörünü kapatır (dinamik tablo adları).

## ADR-005: Scope-based Authorization
**Karar:** JWT claim'de scope dizisi: read/write/delete/schema/query
**Neden:** Tek DB içinde okuma-yazma ayrımı; frontend-only client'lara write vermemek mümkün.