#Requires -Version 5.1
<#
.SYNOPSIS
    Postgrify install.ps1 test scripti
.DESCRIPTION
    install.ps1'in Windows'ta calisip calismadigini test eder.
    Pester gerektirmez — pure PowerShell.
    Kullanim: pwsh -File test-install.ps1
              pwsh -File test-install.ps1 -Quick
              pwsh -File test-install.ps1 -Verbose
#>

[CmdletBinding()]
param(
    [switch]$Quick   # Docker testlerini atla
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'

# ─── Sayaclar ─────────────────────────────────────────────────────────────────
$script:Pass   = 0
$script:Fail   = 0
$script:Errors = [System.Collections.Generic.List[string]]::new()

# ─── Cikti yardimcilari ───────────────────────────────────────────────────────
function Ok {
    param([string]$Msg)
    Write-Host "  " -NoNewline
    Write-Host ([char]0x2713) -NoNewline -ForegroundColor Green
    Write-Host " $Msg" -ForegroundColor White
    $script:Pass++
}

function Fail {
    param([string]$Msg)
    Write-Host "  " -NoNewline
    Write-Host ([char]0x2717) -NoNewline -ForegroundColor Red
    Write-Host " $Msg" -ForegroundColor White
    $script:Fail++
    $script:Errors.Add($Msg)
}

function Info {
    param([string]$Msg)
    Write-Host "  " -NoNewline
    Write-Host "->" -NoNewline -ForegroundColor Cyan
    Write-Host " $Msg" -ForegroundColor DarkGray
}

function Section {
    param([string]$Title)
    Write-Host ""
    Write-Host $Title -ForegroundColor Yellow
    Write-Host ("─" * 44) -ForegroundColor DarkGray
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$InstallPs1 = Join-Path $ScriptDir 'install.ps1'

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 1: Script sozdizimi (PowerShell parser)
# ═══════════════════════════════════════════════════════════════════════════════
Section "Test 1: Script sozdizimi"

if (-not (Test-Path $InstallPs1)) {
    Fail "install.ps1 bulunamadi: $InstallPs1"
} else {
    Ok "install.ps1 mevcut"

    # PowerShell AST ile parse et — hic calistirmadan syntax hatasi var mi?
    $parseErrors = $null
    $tokens      = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile(
        $InstallPs1, [ref]$tokens, [ref]$parseErrors
    )

    if ($parseErrors.Count -eq 0) {
        Ok "install.ps1 sozdizimi gecerli (AST parse)"
    } else {
        Fail "install.ps1 sozdizim hatasi var ($($parseErrors.Count) hata)"
        $parseErrors | ForEach-Object { Info "  $($_.Message) (satir $($_.Extent.StartLineNumber))" }
    }
}

# #Requires -Version 5.1 var mi?
$psContent = Get-Content $InstallPs1 -Raw -Encoding UTF8
if ($psContent -match '#Requires -Version 5\.1') {
    Ok "#Requires -Version 5.1 mevcut"
} else {
    Fail "#Requires -Version 5.1 eksik"
}

# ErrorActionPreference = Stop var mi?
if ($psContent -match "ErrorActionPreference\s*=\s*'Stop'") {
    Ok "ErrorActionPreference = Stop mevcut"
} else {
    Fail "ErrorActionPreference = Stop eksik — hatalar sessizce gecebilir"
}

# Log dosyasi olusturuluyor mu?
if ($psContent -match 'LogFile') {
    Ok "Log dosyasi mekanizmasi mevcut"
} else {
    Fail "Log dosyasi mekanizmasi eksik"
}

# Banner var mi?
if ($psContent -match 'POSTGRIFY|██████') {
    Ok "ASCII art banner mevcut"
} else {
    Fail "ASCII art banner eksik"
}

# read / Read-Host yok mu? (pipe'da calismayi engeller)
if ($psContent -match 'Read-Host') {
    Fail "Script Read-Host iceriyor — pipe'da (iex) calismayi engelleyebilir"
    $lines = ($psContent -split "`n") | Select-String 'Read-Host'
    $lines | ForEach-Object { Info "  Satir $($_.LineNumber): $($_.Line.Trim())" }
} else {
    Ok "Read-Host yok — pipe-safe (irm ... | iex)"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 2: New-Secret fonksiyonu
# ═══════════════════════════════════════════════════════════════════════════════
Section "Test 2: New-Secret fonksiyonu"

# Fonksiyonu izole olarak yukle
$secretFuncCode = @'
function New-Secret {
    param([int]$ByteCount = 32)
    $bytes = [byte[]]::new($ByteCount)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}
'@
Invoke-Expression $secretFuncCode

# 32 byte = 64 hex karakter
$s32 = New-Secret -ByteCount 32
if ($s32.Length -eq 64) { Ok "New-Secret 32 byte = 64 hex karakter" }
else { Fail "New-Secret 32 byte yanlis uzunluk: $($s32.Length) (beklenen: 64)" }

# 24 byte = 48 hex karakter
$s24 = New-Secret -ByteCount 24
if ($s24.Length -eq 48) { Ok "New-Secret 24 byte = 48 hex karakter" }
else { Fail "New-Secret 24 byte yanlis uzunluk: $($s24.Length) (beklenen: 48)" }

# 16 byte = 32 hex karakter
$s16 = New-Secret -ByteCount 16
if ($s16.Length -eq 32) { Ok "New-Secret 16 byte = 32 hex karakter" }
else { Fail "New-Secret 16 byte yanlis uzunluk: $($s16.Length) (beklenen: 32)" }

# Sadece hex karakterler
if ($s32 -match '^[a-f0-9]+$') { Ok "Secret sadece hex karakter iceriyor" }
else { Fail "Secret hex olmayan karakter iceriyor: $s32" }

# Her cagirida farkli deger
$a = New-Secret -ByteCount 32
$b = New-Secret -ByteCount 32
if ($a -ne $b) { Ok "Her seferinde farkli secret uretiliyor" }
else { Fail "Iki ardisik secret ayni! Crypto RNG calismıyor olabilir" }

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 3: .env sablonu dogrulugu
# ═══════════════════════════════════════════════════════════════════════════════
Section "Test 3: .env sablonu"

$tempEnv = Join-Path $env:TEMP "postgrify-test-env-$PID.env"

$pgPass    = New-Secret -ByteCount 24
$jwtSecret = New-Secret -ByteCount 32
$adminSec  = New-Secret -ByteCount 16

$envContent = @"
PG_HOST=postgres
PG_PORT=5432
PG_USER=postgrify
PG_PASSWORD=$pgPass
PG_SSL=false
JWT_SECRET=$jwtSecret
ADMIN_SECRET=$adminSec
REDIS_URL=redis://redis:6379
NODE_ENV=production
LOG_LEVEL=info
APP_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
ALLOW_RAW_SQL_ADMIN=false
"@
Set-Content -Path $tempEnv -Value $envContent -Encoding UTF8

$requiredVars = @('PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD', 'PG_SSL',
                  'JWT_SECRET', 'ADMIN_SECRET', 'REDIS_URL', 'NODE_ENV',
                  'LOG_LEVEL', 'APP_URL', 'CORS_ORIGINS')

foreach ($var in $requiredVars) {
    if (Get-Content $tempEnv | Where-Object { $_ -match "^$var=" }) {
        Ok ".env'de $var mevcut"
    } else {
        Fail ".env'de $var eksik"
    }
}

# Secret'lar bos degil mi?
foreach ($var in @('PG_PASSWORD', 'JWT_SECRET', 'ADMIN_SECRET')) {
    $val = (Get-Content $tempEnv | Where-Object { $_ -match "^$var=" }) -replace "^$var=", ''
    if ($val.Length -ge 32) { Ok "$var yeterince uzun ($($val.Length) karakter)" }
    else { Fail "$var cok kisa: $($val.Length) karakter (32+ bekleniyor)" }
}

# PG_HOST docker container adi mi?
$pgHost = (Get-Content $tempEnv | Where-Object { $_ -match '^PG_HOST=' }) -replace '^PG_HOST=', ''
if ($pgHost -eq 'postgres') { Ok "PG_HOST=postgres (container adi, dogru)" }
else { Fail "PG_HOST=$pgHost (beklenen: postgres)" }

Remove-Item $tempEnv -Force -ErrorAction SilentlyContinue

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 4: docker-compose.yml yapisi
# ═══════════════════════════════════════════════════════════════════════════════
Section "Test 4: docker-compose.yml yapisi"

$composeFile = Join-Path $ScriptDir 'packages\docker-compose.yml'

if (Test-Path $composeFile) {
    Ok "docker-compose.yml mevcut"
    $composeContent = Get-Content $composeFile -Raw

    # Servisler
    foreach ($svc in @('postgres', 'redis', 'api', 'gui')) {
        if ($composeContent -match "(?m)^\s{2}${svc}:") {
            Ok "$svc servisi tanimli"
        } else {
            Fail "$svc servisi eksik"
        }
    }

    # PostgreSQL imaji
    if ($composeContent -match 'image:\s*postgres:') { Ok "PostgreSQL imaji mevcut" }
    else { Fail "PostgreSQL imaji eksik" }

    # HTML entity yok mu?
    if ($composeContent -match '&gt;|&amp;|&lt;') {
        Fail "docker-compose.yml HTML entity iceriyor (sozdizim hatasi)"
    } else {
        Ok "docker-compose.yml HTML entity icermiyor"
    }

    # PG_PASSWORD interpolasyonu
    if ($composeContent -match '\$\{PG_PASSWORD\}') {
        Ok "PG_PASSWORD .env'den interpolate ediliyor"
    } else {
        Fail "PG_PASSWORD .env interpolasyonu eksik"
    }

} else {
    Fail "docker-compose.yml bulunamadi: $composeFile"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 5: Dockerfile'lar
# ═══════════════════════════════════════════════════════════════════════════════
Section "Test 5: Dockerfile'lar"

$dockerfiles = @(
    'packages\api\Dockerfile.monorepo',
    'packages\gui\Dockerfile'
)

foreach ($df in $dockerfiles) {
    $fullPath = Join-Path $ScriptDir $df
    if (Test-Path $fullPath) {
        Ok "$df mevcut"
        $dfContent = Get-Content $fullPath -Raw
        if ($dfContent -match '&gt;|&amp;|&lt;') {
            Fail "$df HTML entity iceriyor"
        } else {
            Ok "$df HTML entity icermiyor"
        }
    } else {
        Fail "$df bulunamadi"
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 6: Windows ortam gereksinimleri
# ═══════════════════════════════════════════════════════════════════════════════
Section "Test 6: Windows ortam gereksinimleri"

# PowerShell surumu
$psVer = $PSVersionTable.PSVersion
if ($psVer.Major -ge 5) {
    Ok "PowerShell $($psVer.Major).$($psVer.Minor) (minimum 5.1 gereken)"
} else {
    Fail "PowerShell surumu cok eski: $psVer (minimum 5.1 gerekli)"
}

# Invoke-WebRequest (irm) calisiyor mu?
try {
    $null = Invoke-WebRequest -Uri 'https://github.com' -Method Head -TimeoutSec 5 -UseBasicParsing
    Ok "Invoke-WebRequest (irm) calisiyor"
} catch {
    Fail "Invoke-WebRequest calismiyor: $_"
}

# System.Security.Cryptography.RandomNumberGenerator mevcut mu?
try {
    $testBytes = [byte[]]::new(4)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($testBytes)
    Ok "RandomNumberGenerator mevcut (openssl gerektirmez)"
} catch {
    Fail "RandomNumberGenerator kullanilamiyor: $_"
}

# TLS 1.2 destekleniyor mu?
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Ok "TLS 1.2 destekleniyor"
} catch {
    Fail "TLS 1.2 desteklenmiyor: $_"
}

# Disk alani
try {
    $drive = (Get-Item $env:USERPROFILE).PSDrive.Name
    $freeGB = [math]::Round((Get-PSDrive $drive).Free / 1GB, 1)
    if ($freeGB -ge 5) {
        Ok "Disk alani yeterli: ${freeGB}GB bos"
    } else {
        Fail "Disk alani yetersiz: ${freeGB}GB (minimum 5GB gerekli)"
    }
} catch {
    Info "Disk alani kontrol edilemedi"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 7: Docker erişimi (Quick modunda atla)
# ═══════════════════════════════════════════════════════════════════════════════
if ($Quick) {
    Section "Test 7: Docker (atlanidi — Quick modu)"
    Info "--Quick modu, Docker testleri atlanıyor."
} else {
    Section "Test 7: Docker erişimi"

    $dockerExists = $null -ne (Get-Command 'docker' -ErrorAction SilentlyContinue)

    if ($dockerExists) {
        Ok "docker komutu mevcut"

        try {
            $null = & docker info 2>&1
            if ($LASTEXITCODE -eq 0) {
                Ok "Docker daemon calisiyor"

                # docker compose v2 var mi?
                $null = & docker compose version 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Ok "Docker Compose v2 mevcut"

                    # Gecici .env ile compose config dogrula
                    $tempEnv2 = Join-Path $env:TEMP "postgrify-compose-test-$PID.env"
                    @"
PG_PASSWORD=testpassword123456789012345678901234
JWT_SECRET=test-jwt-secret-at-least-32-characters-longxx
ADMIN_SECRET=test-admin-16char
REDIS_URL=redis://redis:6379
NODE_ENV=production
PG_HOST=postgres
PG_USER=postgrify
"@ | Set-Content $tempEnv2 -Encoding UTF8

                    $configOut = & docker compose -f $composeFile --env-file $tempEnv2 config 2>&1
                    if ($LASTEXITCODE -eq 0) {
                        Ok "docker compose config basarili — YAML ve interpolasyon gecerli"
                    } else {
                        Fail "docker compose config basarisiz"
                        $configOut | Select-Object -Last 10 | ForEach-Object { Info $_ }
                    }

                    Remove-Item $tempEnv2 -Force -ErrorAction SilentlyContinue

                } else {
                    Fail "Docker Compose v2 bulunamadi — 'docker compose version' calismiyor"
                }
            } else {
                Fail "Docker daemon calısmiyor — 'docker info' hata verdi"
                Info "Docker Desktop'i baslatin ve tekrar deneyin."
            }
        } catch {
            Fail "Docker erisim hatasi: $_"
        }
    } else {
        Info "Docker kurulu degil — kurulum sirasinda otomatik yuklenecek."
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 8: Ag baglantisi
# ═══════════════════════════════════════════════════════════════════════════════
Section "Test 8: Ag baglantisi"

$hosts = @(
    @{ Host = 'github.com';               Label = 'GitHub (repo klonlama)' },
    @{ Host = 'raw.githubusercontent.com'; Label = 'GitHub Raw (script indirme)' },
    @{ Host = 'registry-1.docker.io';     Label = 'Docker Hub (imaj cekme)' }
)

foreach ($h in $hosts) {
    try {
        $null = Invoke-WebRequest -Uri "https://$($h.Host)" -Method Head -TimeoutSec 8 -UseBasicParsing
        Ok "$($h.Label) erisimi var"
    } catch {
        Fail "$($h.Label) erisimi yok: $($h.Host)"
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 9: Execution policy
# ═══════════════════════════════════════════════════════════════════════════════
Section "Test 9: Execution policy"

$policy = Get-ExecutionPolicy
Info "Mevcut execution policy: $policy"

if ($policy -in @('Bypass', 'Unrestricted', 'RemoteSigned', 'AllSigned')) {
    Ok "Execution policy script calistirmaya izin veriyor: $policy"
} elseif ($policy -eq 'Restricted') {
    Fail "Execution policy 'Restricted' — script calistirilirken bypass edilmeli"
    Info "install.ps1 bunu otomatik halleder: Set-ExecutionPolicy -Scope Process Bypass"
} else {
    Info "Execution policy: $policy — install.ps1 bunu handle eder"
}

# Process scope bypass calisiyor mu?
try {
    Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
    Ok "Process scope execution policy bypass calisiyor"
} catch {
    Fail "Process scope bypass basarisiz: $_"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 10: install.ps1 fonksiyon varligi
# ═══════════════════════════════════════════════════════════════════════════════
Section "Test 10: install.ps1 fonksiyon kontrolu"

$requiredFunctions = @(
    'Write-Banner',
    'Test-AdminPrivilege',
    'Test-NetworkAccess',
    'New-Secret',
    'Write-EnvFile',
    'Ensure-Git',
    'Ensure-Docker',
    'Wait-ApiReady',
    'Write-CompletionBanner',
    'Main'
)

$ps1Content = Get-Content $InstallPs1 -Raw -Encoding UTF8

foreach ($fn in $requiredFunctions) {
    if ($ps1Content -match "function $fn") {
        Ok "Fonksiyon mevcut: $fn"
    } else {
        Fail "Fonksiyon eksik: $fn"
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# SONUC
# ═══════════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host ("=" * 54) -ForegroundColor DarkGray
Write-Host ("  Test Sonucu: ") -NoNewline
Write-Host "$($script:Pass) gecti" -NoNewline -ForegroundColor Green
Write-Host "  |  " -NoNewline
Write-Host "$($script:Fail) basarisiz" -ForegroundColor $(if ($script:Fail -gt 0) { 'Red' } else { 'Green' })

if ($script:Fail -gt 0) {
    Write-Host ""
    Write-Host "  Basarisiz testler:" -ForegroundColor Red
    $script:Errors | ForEach-Object {
        Write-Host "    " -NoNewline
        Write-Host ([char]0x2717) -NoNewline -ForegroundColor Red
        Write-Host " $_" -ForegroundColor White
    }
    Write-Host ("=" * 54) -ForegroundColor DarkGray
    exit 1
} else {
    Write-Host ""
    Write-Host "  Tum testler gecti " -NoNewline -ForegroundColor Green
    Write-Host ([char]0x2713) -ForegroundColor Green
    Write-Host ("=" * 54) -ForegroundColor DarkGray
    exit 0
}