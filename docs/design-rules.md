# Postgrify Design Rules

Bu döküman, Postgrify GUI'sinin görsel tasarım kararlarını ve kurallarını tanımlar.
Yeni sayfa, bileşen veya ekran tasarlarken bu kurallara uyulmalıdır.

---

## 1. Brand & Renk Paleti

### Renkler

| Token | Değer | Kullanım |
|-------|-------|----------|
| `--brand` | `#EFFF12` | CTA vurguları, başarı ikonları, aktif durumlar |
| Zemin | `#000000` | Tüm sayfa arka planları |
| Yüzey | `#0A0A0A` – `#141414` | Kart, panel, input arka planı |
| Birincil metin | `#FFFFFF` | Başlıklar, etiketler |
| İkincil metin | `#A1A1AA` (zinc-400) | Açıklamalar, placeholder, yardımcı yazılar |
| Kenarlık | `#27272A` (zinc-800) | Input, kart, ayırıcı border'ları |
| Hata | `#F87171` (red-400) | Hata mesajları |
| Başarı | `#4ADE80` (green-400) | Başarı durumları |

### Kural: Tam opak renkler

> **Hiçbir element yarı saydam (alpha) renk almaz.**

- `bg-white/10`, `text-white/50`, `border-white/20` gibi Tailwind opacity modifier'ları **yasaktır**.
- Saydamlık gereken her durumda **solid zinc tonları** kullanılır:
  - `white/50` yerine → `#A1A1AA` (zinc-400)
  - `white/20` yerine → `#3F3F46` (zinc-700)
  - `white/10` yerine → `#27272A` (zinc-800)
  - `black/50` yerine → `#18181B` (zinc-900)

**İstisna:** `GrainGradient` shader'ının `colorBack="#00000000"` parametresi — bu UI elementi değil, WebGL shader konfigürasyonudur.

---

## 2. Tipografi

### Font Ailesi

```css
font-family: "Geist", system-ui, sans-serif;       /* tüm UI metinleri */
font-family: "Geist Mono", ui-monospace, monospace; /* kod, SQL, terminal */
```

### Font Scale

| Kullanım | Tailwind sınıfı | Boyut |
|----------|----------------|-------|
| Sayfa başlığı (hero) | `text-[70px] lg:text-[64px] sm:text-6xl text-5xl` | responsive |
| Bölüm başlığı | `text-4xl` – `text-5xl` | 36px – 48px |
| Alt başlık | `text-xl` – `text-2xl` | 20px – 24px |
| Gövde | `text-base` | 16px |
| Küçük metin | `text-sm` | 14px |
| Etiket / meta | `text-[11px]` – `text-xs` | 11px – 12px |

### Tracking (letter-spacing)

- Büyük başlıklar: `tracking-[-0.04em]` veya `tracking-[-0.05em]`
- Normal metin: default (tracking ayarı yok)
- Küçük etiketler (`text-[11px]`): `tracking-wide`

### Font Weight

- Başlıklar: `font-medium` (500) — `font-bold` kullanılmaz
- Buton metni: `font-medium` (500)
- Gövde: `font-normal` (400)

---

## 3. Layout Primitives

### Sayfa Wrapper (full-screen sayfalar)

```tsx
<section className="min-h-screen bg-black p-3 text-white antialiased [font-synthesis:none]">
```

- `p-3` → sayfanın dört yanında 12px boşluk (köşelerde rounded panel efekti için)
- `antialiased` → font render kalitesi

### İki Kolonlu Grid (Login / Setup tarzı sayfalar)

```tsx
<div className="grid min-h-[calc(100vh-1.5rem)] rounded-md lg:grid-cols-2 lg:gap-3">
```

- Sol: form paneli
- Sağ: `GrainGradient` dekoratif panel (sadece `lg:` ve üzeri)
- Grid gap: `gap-3` (12px)

### Sol Panel Padding

```tsx
className="flex flex-col justify-center px-8 sm:px-16 lg:px-20"
```

### Sağ Panel

```tsx
className="relative hidden overflow-hidden rounded-md bg-black text-white lg:block"
```

---

## 4. Bileşen Pattern'ları

### Floating-Label Input (FieldBox)

Tüm form input'ları floating-label pattern'ını kullanır. Input yüksekliği `h-14`.

```tsx
<div className="relative">
  <input
    className="h-14 w-full rounded-[10px] border border-zinc-800 bg-zinc-900
               px-4 pt-5 pb-2 text-base text-white outline-none
               transition-colors placeholder:text-transparent
               focus:border-zinc-600"
  />
  <label className="pointer-events-none absolute left-4 text-zinc-400
                    transition-all duration-150
                    /* kaldırılmış: top-2 text-[11px] */
                    /* normal: top-1/2 -translate-y-1/2 text-base */">
    Alan Adı
  </label>
</div>
```

- `border-zinc-800` → varsayılan kenarlık
- `focus:border-zinc-600` → odak kenarlığı
- `bg-zinc-900` → input arka planı
- Label, input dolu/odaklıyken `top-2 text-[11px]`'e geçer

### Birincil Buton (Primary)

```tsx
<button className="flex h-12 w-full items-center justify-center gap-2
                   rounded-[10px] border border-zinc-600
                   bg-white text-base font-medium text-black
                   transition-colors hover:bg-zinc-100 disabled:opacity-50">
```

- Arka plan: beyaz (`#FFFFFF`)
- Metin: siyah (`#000000`)
- Hover: `bg-zinc-100`
- Yükseklik: `h-12` (48px)

### İkincil Buton (Secondary / Geri)

```tsx
<button className="flex h-12 items-center justify-center
                   rounded-[10px] border border-zinc-700
                   bg-zinc-900 px-6 text-base font-medium text-white
                   transition-colors hover:bg-zinc-800">
```

- Arka plan: `bg-zinc-900`
- Border: `border-zinc-700`
- Hover: `bg-zinc-800`

### Yükleniyor Spinner

```tsx
<svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
</svg>
```

### Step Indicator (Çok adımlı formlar)

- Aktif adım: `bg-white text-black` dolu daire
- Tamamlanmış: tik ikonu, `bg-zinc-700`
- Bekleyen: `bg-zinc-800 text-zinc-500`
- Adım etiketleri: `text-[10px] tracking-wide text-zinc-500`
- Bağlantı çizgisi: `h-px w-10 bg-zinc-800`

---

## 5. GrainGradient Shader

Dekoratif sağ paneller için WebGL tabanlı animasyon. `@paper-design/shaders-react` paketinden.

### Standart Konfigürasyon

```tsx
<GrainGradient
  speed={0.3}
  scale={1}
  rotation={0}
  offsetX={0}
  offsetY={0}
  softness={0.5}
  intensity={0.5}
  noise={0.25}
  shape="corners"
  frame={2854.5}
  colors={["#FFFFFF", "#EFFF12", "#EFFF12", "#FFFFFF"]}
  colorBack="#00000000"
  className="absolute inset-0 bg-black"
/>
```

### Kurallar

- `colors` dizisindeki brand rengi: `#EFFF12` (sarı)
- `shape="corners"` → köşe vignette modu (standart)
- `speed={0.3}` → yavaş, ambient hissiyat
- `frame` değeri sabit bırakılır → sayfa yenilemede tutarlı başlangıç noktası
- Yalnızca `lg:` breakpoint'te görünür sağ panellerde kullanılır
- Sağ panel slogan metni: `"Setup fast, / Scale faster"` tarzı iki satırlı

---

## 6. Animasyon & Geçişler

### Sayfa / Adım Geçişleri (`tailwindcss-animate`)

```tsx
// İleri yön
className="animate-in fade-in slide-in-from-right-4 duration-300"

// Geri yön
className="animate-in fade-in slide-in-from-left-4 duration-300"

// Aşağıdan (done/başarı ekranı)
className="animate-in fade-in slide-in-from-bottom-4 duration-500"
```

### Hover Geçişleri

- Butonlar: `transition-colors` (renk geçişi yeterli, transform yok)
- Input kenarlık: `transition-colors`
- Diğer interaktif elementler: `transition-colors duration-150`

### Kurallar

- `duration-300` → genel geçiş süresi
- `duration-150` → mikro animasyon (label, kenarlık)
- `duration-500` → başarı/tamamlandı ekranları
- Transform (`scale`, `translate`) animasyonları kullanılmaz — sadece `fade` + `slide`

---

## 7. Border & Yüzey

### Border Radius

| Kullanım | Sınıf |
|----------|-------|
| Input, buton, kart | `rounded-[10px]` |
| Sayfa paneli, modal | `rounded-md` (6px) |
| Küçük badge/chip | `rounded-full` |

### Border Rengi

- Input varsayılan: `border-zinc-800`
- Input odak: `border-zinc-600`
- Kart / panel: `border-zinc-800`
- Ayırıcı çizgi: `bg-zinc-800` (1px yükseklik)

### Yüzey Renkleri (Solid)

| Katman | Renk |
|--------|------|
| Sayfa zemin | `#000000` |
| Panel / kart | `#0A0A0A` – `#0F0F0F` |
| Input arka plan | `#18181B` (zinc-900) |
| Hover yüzeyi | `#27272A` (zinc-800) |

---

## 8. Erişilebilirlik

- Dekoratif görseller: `alt=""` (boş string)
- İşlevsel görseller: `alt="açıklayıcı metin"`
- İkon butonlar: `aria-label` zorunlu
- Form input'ları: her zaman eşleşen `<label>` ile birlikte
- Focus ring: Tailwind varsayılan outline korunur (`outline-none` yalnızca görsel yerine konduğunda kullanılır)

---

## 9. Yapılmaz Listesi

```
❌  bg-white/10, bg-black/50, bg-zinc-900/80   → opacity modifier'ları yasak
❌  text-white/50, text-white/30               → opacity modifier'ları yasak
❌  border-white/20                            → opacity modifier'ları yasak
❌  font-bold, font-semibold                   → başlıklarda font-medium kullan
❌  text-gray-*, bg-gray-*                     → zinc skalası kullan
❌  hover:scale-*, hover:translate-*           → transform animasyonu yok
❌  rounded-lg, rounded-xl, rounded-2xl        → rounded-[10px] veya rounded-md kullan
❌  shadow-*, drop-shadow-*                    → gölge kullanılmaz, kontrast ile ayrışım sağlanır
❌  light mode renkleri                        → uygulama her zaman dark mode'dadır
```

---

## 10. Hızlı Referans

```
Zemin         #000000
Yüzey         #0A0A0A / zinc-900 (#18181B)
Hover yüzey   zinc-800 (#27272A)
Birincil metin #FFFFFF
İkincil metin  zinc-400 (#A1A1AA)
Kenarlık      zinc-800 (#27272A)
Brand         #EFFF12
Hata          red-400 (#F87171)
Başarı        green-400 (#4ADE80)

Font          Geist / Geist Mono
Başlık weight font-medium (500)
Border radius rounded-[10px] (input/buton) · rounded-md (panel)
Buton yükseklik h-12 (48px)
Input yükseklik h-14 (56px)
```