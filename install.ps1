#Requires -Version 5.1
<#
.SYNOPSIS
    Postgrify Windows Installer
.DESCRIPTION
    Tek komutla Postgrify kurulumu yapar.
    Kullanim: irm https://raw.githubusercontent.com/parsherr/postgrify/main/install.ps1 | iex
.NOTES
    Desteklenen: Windows 10/11, PowerShell 5.1+
    Gereksinim : Internet baglantisi (docker, git otomatik kurulur)
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # Invoke-WebRequest progress bar'i gizle

# ─── Log dosyasi ──────────────────────────────────────────────────────────────
$LogFile = Join-Path $env:TEMP ("postgrify-install-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Write-Log {
    param([string]$Level, [string]$Message)
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'HH:mm:ss'), $Level.ToUpper(), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# ─── Cikti yardimcilari ───────────────────────────────────────────────────────
function Info    { param([string]$Msg) Write-Host "  [postgrify] $Msg" -ForegroundColor Cyan;    Write-Log 'INFO'    $Msg }
function Success { param([string]$Msg) Write-Host "  [postgrify] $Msg" -ForegroundColor Green;   Write-Log 'SUCCESS' $Msg }
function Warn    { param([string]$Msg) Write-Host "  [postgrify] $Msg" -ForegroundColor Yellow;  Write-Log 'WARN'    $Msg }
function Fail    {
    param([string]$Msg)
    Write-Host ""
    Write-Host "  [postgrify] HATA: $Msg" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Log dosyasi: $LogFile" -ForegroundColor DarkGray
    Write-Log 'ERROR' $Msg
    exit 1
}

# ─── Banner ───────────────────────────────────────────────────────────────────
function Write-Banner {
    Write-Host ""
    Write-Host "  ██████╗  ██████╗ ███████╗████████╗ ██████╗ ██████╗ ██╗███████╗██╗   ██╗" -ForegroundColor Cyan
    Write-Host "  ██╔══██╗██╔═══██╗██╔════╝╚══██╔══╝██╔════╝ ██╔══██╗██║██╔════╝╚██╗ ██╔╝" -ForegroundColor Cyan
    Write-Host "  ██████╔╝██║   ██║███████╗   ██║   ██║  ███╗██████╔╝██║█████╗   ╚████╔╝ " -ForegroundColor Cyan
    Write-Host "  ██╔═══╝ ██║   ██║╚════██║   ██║   ██║   ██║██╔══██╗██║██╔══╝    ╚██╔╝  " -ForegroundColor Cyan
    Write-Host "  ██║     ╚██████╔╝███████║   ██║   ╚██████╔╝██║  ██║██║██║        ██║   " -ForegroundColor Cyan
    Write-Host "  ╚═╝      ╚═════╝ ╚══════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝        ╚═╝  " -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Multi-database PostgreSQL Gateway" -ForegroundColor White
    Write-Host ""
}

# ─── Admin yetkisi kontrolu ───────────────────────────────────────────────────
function Test-AdminPrivilege {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ─── Ag baglantisi testi ──────────────────────────────────────────────────────
function Test-NetworkAccess {
    try {
        $null = Invoke-WebRequest -Uri 'https://github.com' -Method Head -TimeoutSec 10 -UseBasicParsing
        return $true
    } catch {
        return $false
    }
}

# ─── Komut var mi? ────────────────────────────────────────────────────────────
function Has {
    param([string]$Cmd)
    return $null -ne (Get-Command $Cmd -ErrorAction SilentlyContinue)
}

# ─── Disk alani kontrolu ──────────────────────────────────────────────────────
function Test-DiskSpace {
    param([long]$RequiredGB = 5)
    try {
        $drive = (Get-Item $env:USERPROFILE).PSDrive.Name
        $free  = (Get-PSDrive $drive).Free
        $freeGB = [math]::Round($free / 1GB, 1)
        if ($free -lt ($RequiredGB * 1GB)) {
            Fail "Yetersiz disk alani. Gereken: ${RequiredGB}GB, Mevcut: ${freeGB}GB"
        }
        Info "Disk alani yeterli: ${freeGB}GB bos"
    } catch {
        Warn "Disk alani kontrol edilemedi, devam ediliyor..."
    }
}

# ─── WSL2 kontrolu ────────────────────────────────────────────────────────────
function Test-Wsl2Available {
    try {
        $wslOutput = & wsl --status 2>&1
        return ($LASTEXITCODE -eq 0 -or ($wslOutput -match 'Default Distribution'))
    } catch {
        return $false
    }
}

# ─── Kriptografik secret uretimi ─────────────────────────────────────────────
# [System.Security.Cryptography.RandomNumberGenerator] kullanir — openssl gerektirmez
function New-Secret {
    param([int]$ByteCount = 32)
    $bytes = [byte[]]::new($ByteCount)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

# ─── winget ile kurulum ───────────────────────────────────────────────────────
function Install-WithWinget {
    param([string]$PackageId, [string]$FriendlyName)
    Info "$FriendlyName kuruluyor (winget)..."
    Write-Log 'INFO' "winget install $PackageId"
    try {
        $result = & winget install --id $PackageId --silent --accept-source-agreements --accept-package-agreements 2>&1
        Write-Log 'INFO' ($result -join "`n")
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335135) {
            # -1978335135 = zaten kurulu
            throw "winget exit code: $LASTEXITCODE"
        }
        return $true
    } catch {
        Write-Log 'WARN' "winget hatasi: $_"
        return $false
    }
}

# ─── Chocolatey ile kurulum (fallback) ────────────────────────────────────────
function Install-WithChoco {
    param([string]$PackageName, [string]$FriendlyName)

    # Choco yoksa once choco'yu kur
    if (-not (Has 'choco')) {
        Info "Chocolatey kuruluyor..."
        try {
            Set-ExecutionPolicy Bypass -Scope Process -Force
            [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
            $chocoScript = Invoke-WebRequest 'https://community.chocolatey.org/install.ps1' -UseBasicParsing
            Invoke-Expression $chocoScript.Content
            # PATH'i guncelle
            $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                        [System.Environment]::GetEnvironmentVariable('PATH', 'User')
        } catch {
            Write-Log 'WARN' "Chocolatey kurulum hatasi: $_"
            return $false
        }
    }

    Info "$FriendlyName kuruluyor (Chocolatey)..."
    try {
        $result = & choco install $PackageName -y --no-progress 2>&1
        Write-Log 'INFO' ($result -join "`n")
        return ($LASTEXITCODE -eq 0)
    } catch {
        Write-Log 'WARN' "choco hatasi: $_"
        return $false
    }
}

# ─── Git kurulumu ─────────────────────────────────────────────────────────────
function Ensure-Git {
    # PATH'i yenile (kurulum sonrasi PATH degisebilir)
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('PATH', 'User')

    if (Has 'git') {
        $ver = & git --version 2>&1
        Success "git bulundu: $ver"
        return
    }

    Info "git bulunamadi, kuruluyor..."

    $ok = $false
    if (Has 'winget') { $ok = Install-WithWinget 'Git.Git' 'Git' }
    if (-not $ok)     { $ok = Install-WithChoco  'git'     'Git' }
    if (-not $ok)     {
        Fail ("git kurulamiyor. Manuel kurun: https://git-scm.com/download/win`n" +
              "Kurduktan sonra PowerShell'i yeniden acip bu scripti tekrar calistirin.")
    }

    # PATH'i yenile
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('PATH', 'User')

    if (-not (Has 'git')) {
        Fail "git kuruldu ama PATH'te bulunamadi. PowerShell'i yeniden acip tekrar deneyin."
    }
    Success "git kuruldu."
}

# ─── Docker kurulumu ve kontrolu ──────────────────────────────────────────────
function Ensure-Docker {
    # PATH'i yenile
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('PATH', 'User')

    # Docker var mi?
    $dockerExists = Has 'docker'

    if (-not $dockerExists) {
        Info "Docker Desktop bulunamadi, kuruluyor..."
        Info "Bu islem birkaç dakika surebilir..."

        $ok = $false
        if (Has 'winget') { $ok = Install-WithWinget 'Docker.DockerDesktop' 'Docker Desktop' }
        if (-not $ok)     { $ok = Install-WithChoco  'docker-desktop'        'Docker Desktop' }

        if (-not $ok) {
            Write-Host ""
            Write-Host "  Docker Desktop otomatik kurulamiyor." -ForegroundColor Yellow
            Write-Host "  Lutfen asagidaki linkten manuel kurun:" -ForegroundColor Yellow
            Write-Host "  https://docs.docker.com/desktop/install/windows-install/" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "  Kurulumdan sonra Docker Desktop'i acip bu scripti tekrar calistirin." -ForegroundColor White
            Write-Log 'ERROR' 'Docker Desktop kurulamiyor'
            exit 1
        }

        Write-Host ""
        Write-Host "  ================================================================" -ForegroundColor Yellow
        Write-Host "  Docker Desktop kuruldu." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  ONEMLI: Sistem yeniden baslatmasi gerekebilir." -ForegroundColor Yellow
        Write-Host "  1. Bilgisayarinizi yeniden baslatin." -ForegroundColor White
        Write-Host "  2. Docker Desktop'i acin ve 'Engine running' goruncaya kadar bekleyin." -ForegroundColor White
        Write-Host "  3. Bu komutu tekrar calistirin:" -ForegroundColor White
        Write-Host ""
        Write-Host "     irm https://raw.githubusercontent.com/parsherr/postgrify/main/install.ps1 | iex" -ForegroundColor Cyan
        Write-Host "  ================================================================" -ForegroundColor Yellow
        Write-Host ""
        Write-Log 'INFO' 'Docker Desktop kuruldu, restart gerekebilir'
        exit 0
    }

    # Docker daemon calisiyor mu?
    $dockerRunning = $false
    try {
        $info = & docker info 2>&1
        $dockerRunning = ($LASTEXITCODE -eq 0)
    } catch {
        $dockerRunning = $false
    }

    if (-not $dockerRunning) {
        Info "Docker daemon calısmiyor, baslatiliyor..."

        # Docker Desktop'i baslat
        $dockerDesktopPaths = @(
            "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
            "$env:LOCALAPPDATA\Programs\Docker\Docker\Docker Desktop.exe"
        )

        $launched = $false
        foreach ($path in $dockerDesktopPaths) {
            if (Test-Path $path) {
                Start-Process $path
                $launched = $true
                break
            }
        }

        if (-not $launched) {
            Fail ("Docker Desktop yuklu gorunuyor ama baslatılamiyor.`n" +
                  "Docker Desktop'i manuel acin ve 'Engine running' goruncaya kadar bekleyin,`n" +
                  "sonra bu scripti tekrar calistirin.")
        }

        Info "Docker Desktop baslatiliyor, hazir olmasini bekliyorum..."
        $maxWait = 120
        $elapsed = 0
        while ($elapsed -lt $maxWait) {
            Start-Sleep -Seconds 5
            $elapsed += 5
            try {
                $null = & docker info 2>&1
                if ($LASTEXITCODE -eq 0) {
                    $dockerRunning = $true
                    break
                }
            } catch {}
            Write-Host "." -NoNewline
        }
        Write-Host ""

        if (-not $dockerRunning) {
            Fail ("Docker $maxWait saniyede hazir olmadi.`n" +
                  "Docker Desktop'i manuel acin, 'Engine running' goruncaya kadar bekleyin`n" +
                  "ve bu scripti tekrar calistirin.")
        }
    }

    # Docker Compose v2 var mi?
    $composeOk = $false
    try {
        $null = & docker compose version 2>&1
        $composeOk = ($LASTEXITCODE -eq 0)
    } catch {}

    if (-not $composeOk) {
        Fail ("Docker Compose bulunamadi. Docker Desktop'i guncelleyin:`n" +
              "https://docs.docker.com/desktop/release-notes/")
    }

    $ver = (& docker --version 2>&1) -replace 'Docker version ', ''
    Success "Docker hazir: $ver"
}

# ─── .env dosyasi olustur ─────────────────────────────────────────────────────
function Write-EnvFile {
    param(
        [string]$Path,
        [string]$PgPassword,
        [string]$JwtSecret,
        [string]$AdminSecret
    )

    $timestamp = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'
    $content = @"
# Postgrify -- otomatik olusturuldu: $timestamp
# Bu dosyayi silmeyin -- tum servisler buraya bagli.

# -- PostgreSQL (container) --------------------------------------------------
PG_HOST=postgres
PG_PORT=5432
PG_USER=postgrify
PG_PASSWORD=$PgPassword
PG_SSL=false

# -- Guvenlik ----------------------------------------------------------------
JWT_SECRET=$JwtSecret
ADMIN_SECRET=$AdminSecret

# -- Redis -------------------------------------------------------------------
REDIS_URL=redis://redis:6379

# -- Uygulama ----------------------------------------------------------------
NODE_ENV=production
LOG_LEVEL=info
APP_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173

# -- Ozellikler --------------------------------------------------------------
ALLOW_RAW_SQL_ADMIN=false
"@
    Set-Content -Path $Path -Value $content -Encoding UTF8 -NoNewline
}

# ─── API hazir olana kadar bekle ─────────────────────────────────────────────
function Wait-ApiReady {
    param([int]$TimeoutSeconds = 120)
    Info "API hazir olana kadar bekleniyor (max ${TimeoutSeconds}s)..."
    $elapsed = 0
    while ($elapsed -lt $TimeoutSeconds) {
        try {
            $resp = Invoke-WebRequest -Uri 'http://localhost:3000/health' -TimeoutSec 3 -UseBasicParsing -ErrorAction SilentlyContinue
            if ($resp.StatusCode -eq 200) {
                Write-Host ""
                return $true
            }
        } catch {}
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 3
        $elapsed += 3
    }
    Write-Host ""
    return $false
}

# ─── Tamamlandi banneri ───────────────────────────────────────────────────────
function Write-CompletionBanner {
    param([string]$InstallDir, [string]$AdminSecret)
    Write-Host ""
    Write-Host "  ==============================================================" -ForegroundColor Green
    Write-Host "  Postgrify kurulumu tamamlandi!" -ForegroundColor Green
    Write-Host "  ==============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Web arayuzu : " -NoNewline -ForegroundColor White
    Write-Host "http://localhost:5173" -ForegroundColor Cyan
    Write-Host "  API         : " -NoNewline -ForegroundColor White
    Write-Host "http://localhost:3000" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Ilk adim: http://localhost:5173/setup adresini acin" -ForegroundColor Yellow
    Write-Host "            ve admin hesabinizi olusturun." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Komutlar (PowerShell):" -ForegroundColor White
    Write-Host "    Durdur  : " -NoNewline -ForegroundColor DarkGray
    Write-Host "cd `"$InstallDir\packages`"; docker compose down" -ForegroundColor Gray
    Write-Host "    Baslat  : " -NoNewline -ForegroundColor DarkGray
    Write-Host "cd `"$InstallDir\packages`"; docker compose up -d" -ForegroundColor Gray
    Write-Host "    Guncelle: " -NoNewline -ForegroundColor DarkGray
    Write-Host "cd `"$InstallDir`"; git pull; cd packages; docker compose up -d --build" -ForegroundColor Gray
    Write-Host "    Loglar  : " -NoNewline -ForegroundColor DarkGray
    Write-Host "cd `"$InstallDir\packages`"; docker compose logs -f" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Kurulum dizini : $InstallDir" -ForegroundColor DarkGray
    Write-Host "  Log dosyasi    : $LogFile"    -ForegroundColor DarkGray
    Write-Host ""
}

# ═══════════════════════════════════════════════════════════════════════════════
# ANA KURULUM
# ═══════════════════════════════════════════════════════════════════════════════
function Main {

    Write-Banner

    Write-Log 'INFO' "Postgrify Windows installer baslatildi"
    Write-Log 'INFO' "PowerShell surumu: $($PSVersionTable.PSVersion)"
    Write-Log 'INFO' "Windows surumu: $([System.Environment]::OSVersion.VersionString)"

    # ── Execution policy ──────────────────────────────────────────────────────
    try {
        Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
    } catch {
        Write-Log 'WARN' "Execution policy ayarlanamadi: $_"
    }

    # ── Platform kontrolu ─────────────────────────────────────────────────────
    if ($env:OS -ne 'Windows_NT') {
        Fail "Bu script yalnizca Windows icin tasarlanmistir.`nLinux/macOS icin: curl -fsSL https://raw.githubusercontent.com/parsherr/postgrify/main/install.sh | bash"
    }

    # ── Admin yetkisi ─────────────────────────────────────────────────────────
    if (-not (Test-AdminPrivilege)) {
        Warn "Admin yetkisi yok. Bazi adimlar (Docker kurulumu) basarisiz olabilir."
        Warn "Sorunla karsilasirsaniz scripti 'Yonetici olarak calistir' ile tekrar deneyin."
        Write-Log 'WARN' 'Admin yetkisi yok'
    } else {
        Info "Admin yetkisi dogrulandi."
    }

    # ── Ag baglantisi ─────────────────────────────────────────────────────────
    Info "Ag baglantisi kontrol ediliyor..."
    if (-not (Test-NetworkAccess)) {
        Fail "Internet baglantisi yok. github.com'a erisim saglayip tekrar deneyin."
    }
    Success "Ag baglantisi tamam."

    # ── Disk alani ────────────────────────────────────────────────────────────
    Test-DiskSpace -RequiredGB 5

    # ── WSL2 oneri ────────────────────────────────────────────────────────────
    if (Test-Wsl2Available) {
        Write-Host ""
        Write-Host "  Bilgi: WSL2 tespit edildi." -ForegroundColor Cyan
        Write-Host "  WSL2 terminali uzerinden Linux scripti daha hizli calisabilir:" -ForegroundColor DarkGray
        Write-Host "    wsl bash -c `"curl -fsSL https://raw.githubusercontent.com/parsherr/postgrify/main/install.sh | bash`"" -ForegroundColor Gray
        Write-Host "  Bu mesaji gormezden gelerek Windows kurulumuna devam edebilirsiniz." -ForegroundColor DarkGray
        Write-Host ""
        Write-Log 'INFO' 'WSL2 tespit edildi, kullanici bilgilendirildi'
    }

    # ── git ───────────────────────────────────────────────────────────────────
    Ensure-Git

    # ── Docker ────────────────────────────────────────────────────────────────
    Ensure-Docker

    # ── Kurulum dizini ────────────────────────────────────────────────────────
    $installDir = Join-Path $env:USERPROFILE '.postgrify'
    $packagesDir = Join-Path $installDir 'packages'

    Info "Kurulum dizini: $installDir"

    if (Test-Path (Join-Path $packagesDir 'docker-compose.yml')) {
        Warn "Postgrify zaten kurulu: $installDir"
        Warn "Guncellemek icin:"
        Write-Host "    cd `"$installDir`"; git pull; cd packages; docker compose up -d --build" -ForegroundColor Gray
        Write-Host ""
        Warn "Sifirdan kurmak icin: Remove-Item -Recurse -Force `"$installDir`" ve tekrar calistirin."
        exit 0
    }

    if (Test-Path $installDir) {
        Info "Eski eksik kurulum temizleniyor..."
        Remove-Item -Recurse -Force $installDir
    }

    # ── Repo klonla ───────────────────────────────────────────────────────────
    Info "Postgrify indiriliyor..."
    try {
        $cloneOutput = & git clone --depth 1 https://github.com/parsherr/postgrify.git $installDir 2>&1
        Write-Log 'INFO' ($cloneOutput -join "`n")
        if ($LASTEXITCODE -ne 0) { throw "git clone basarisiz: exit $LASTEXITCODE" }
    } catch {
        Fail "Repo indirilemedi: $_`nInternet baglantisinizi kontrol edin."
    }
    Success "Indirildi: $installDir"

    # ── Secret uret ───────────────────────────────────────────────────────────
    Info "Guvenlik anahtarlari olusturuluyor..."
    $pgPassword  = New-Secret -ByteCount 24
    $jwtSecret   = New-Secret -ByteCount 32
    $adminSecret = New-Secret -ByteCount 16

    # ── .env yaz ──────────────────────────────────────────────────────────────
    $envPath = Join-Path $packagesDir '.env'
    try {
        Write-EnvFile -Path $envPath -PgPassword $pgPassword -JwtSecret $jwtSecret -AdminSecret $adminSecret
    } catch {
        Fail ".env dosyasi olusturulamiyor: $_"
    }
    Success ".env olusturuldu: $envPath"

    # ── Docker servisleri baslat ──────────────────────────────────────────────
    Info "Docker imajlari derleniyor ve servisler baslatiliyor..."
    Info "(Bu islem ilk seferinde 3-10 dakika surebilir)"
    Write-Host ""

    Push-Location $packagesDir
    try {
        $composeOutput = & docker compose up -d --build 2>&1
        Write-Log 'INFO' ($composeOutput -join "`n")
        if ($LASTEXITCODE -ne 0) {
            Pop-Location
            Write-Host ""
            Write-Host "  docker compose ciktisi:" -ForegroundColor Red
            $composeOutput | Select-Object -Last 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
            Fail "Docker Compose basarisiz. Detaylar icin log dosyasina bakin: $LogFile"
        }
    } catch {
        Pop-Location
        Fail "Docker Compose hatasi: $_"
    }
    Pop-Location

    # ── API hazir olana kadar bekle ───────────────────────────────────────────
    $apiReady = Wait-ApiReady -TimeoutSeconds 120

    if (-not $apiReady) {
        Warn "API 120 saniye icinde hazir olmadi."
        Warn "Loglar icin: cd `"$packagesDir`"; docker compose logs api"
    }

    # ── Tamamlandi ────────────────────────────────────────────────────────────
    Write-CompletionBanner -InstallDir $installDir -AdminSecret $adminSecret

    # Tarayicida setup sayfasini ac
    try {
        Start-Process 'http://localhost:5173/setup'
    } catch {
        Write-Log 'WARN' "Tarayici acilamiyor: $_"
    }

    Write-Log 'SUCCESS' "Kurulum tamamlandi"
}

# Tum hatalari yakala ve guzel hata mesaji goster
try {
    Main
} catch {
    Write-Host ""
    Write-Host "  [postgrify] Beklenmeyen hata: $_" -ForegroundColor Red
    Write-Host "  Log dosyasi: $LogFile" -ForegroundColor DarkGray
    Write-Log 'ERROR' "Beklenmeyen hata: $_"
    Write-Log 'ERROR' $_.ScriptStackTrace
    exit 1
}