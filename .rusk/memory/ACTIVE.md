# Active Work — 2026-08-16 (TURTLE)

## PR açılımı nedir?
**Pull Request (PR)** = GitHub'da branch'indeki değişiklikleri ana repoya
(merge etmesi için) inceleme isteği. Reviewer kodu/testleri kontrol eder,
onaylarsa `main`'e birleşir. Sen açacaksın; biz metni `.rusk/memory/PR-C01.md`
içinde hazırlıyoruz.

## Kaç endpoint bitti?
| ID | Endpoint | Kod | Test (func+sec) | PR metni | Durum |
|----|----------|-----|-----------------|----------|-------|
| **C-01** | GET list | ✅ | ✅ (yeşil) | ✅ PR-C01.md | **PR'a hazır (lokal)** |
| E-01 | HEAD | kod var | henüz ayrı suite yok | — | C-01 ile aynı handler; sonraki tick |
| C-02…C-20 | — | ❌ | ❌ | ❌ | kuyruk |
| E-02…E-97 | — | ❌ | ❌ | ❌ | kuyruk |

**Tam bitmiş (PR açılabilir): 1 → C-01**  
**Toplam hedef:** 20 düzeltme + 97 eksik (fazlı)

## C-01 test paketleri
- `test/utils/prefer.test.ts`
- `test/routes/c01-get-list.test.ts`
- `test/routes/rows-pagination.test.ts`
- `test/routes/rows.test.ts` (GET kısmı güncellendi)
- `test/security/c01-get-list.security.test.ts` (authz, injection, DoS limit)

## Sonraki
1. Kullanıcı isterse C-01 için branch + commit (sen söyle, commit atarım)
2. PR body: `PR-C01.md` kopyala → GitHub
3. Sonra E-01 HEAD security+func test → ayrı küçük PR veya C-01'e ek
4. C-02 POST Prefer
