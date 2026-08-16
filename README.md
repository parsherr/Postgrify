<p align="center">
  <img src="images/mid-size-logo.png.png" alt="Postgrify Logo" style="width:100%;max-width:100%;" />
</p>

<p align="center">
  A multi-database PostgreSQL REST API gateway that installs with a single command.
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#services">Services</a> •
  <a href="#quick-api-usage">API Usage</a> •
  <a href="#update--management">Management</a>
</p>

---

## What is it?

Postgrify manages multiple PostgreSQL databases through a single HTTP/REST API. Each project uses its own isolated database — no direct PostgreSQL connection required.

- Multi-database support — single API, per-request DB selection
- JWT-based auth — per-DB scoped tokens + admin token
- Web GUI — table editor, schema management, SQL editor
- Automatically restarts after reboot

---

## Installation

No configuration files to edit. All secrets are auto-generated. The only user input happens in the browser after installation.

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/parsherr/postgrify/main/install.sh | bash
```

**Requirements:** `curl` (everything else — git, Docker — is installed automatically if missing), `sudo` access.

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/parsherr/postgrify/main/install.ps1 | iex
```

**Requirements:** Windows 10/11, PowerShell 5.1+. Docker Desktop and git are installed automatically via winget.

> **Note:** If Docker Desktop needs to be installed, a system restart may be required. After restarting, run the command again — the existing installation will be detected and the process will continue.

> **WSL2 alternative:** If you have WSL2 installed, you can use the Linux command inside WSL instead — it is faster and more reliable.

### What the installer does

1. Checks for Docker (installs if missing)
2. Clones the repo into `~/.postgrify/` (Linux/macOS) or `%USERPROFILE%\.postgrify\` (Windows)
3. Auto-generates all secrets (`JWT_SECRET`, `ADMIN_SECRET`, `PG_PASSWORD`) — no prompts
4. Starts all services (PostgreSQL, Redis, API, GUI)
5. Opens http://localhost:5173/setup in your browser

**After installation**, create your admin account at http://localhost:5173/setup. That is the only step requiring user input.

> All generated secrets are saved in `packages/.env` inside the install directory. Keep this file safe — deleting it will break the installation.

---

## Services

| Service  | URL                            |
|----------|--------------------------------|
| GUI      | http://localhost:5173          |
| API      | http://localhost:3000          |
| API Docs | http://localhost:3000/api-docs |

---

## Quick API Usage

### Get an admin token

```bash
curl -X POST http://localhost:3000/auth/token/admin \
  -H "Content-Type: application/json" \
  -d '{"secret": "YOUR_ADMIN_SECRET"}'
```

### Add a database

```bash
curl -X POST http://localhost:3000/admin/databases \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "myproject"}'
```

### Get a DB token and use it

```bash
# Get a scoped token
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"database": "myproject", "secret": "YOUR_ADMIN_SECRET", "scopes": ["read","write"]}'

# List tables
curl http://localhost:3000/db/myproject/tables \
  -H "Authorization: Bearer DB_TOKEN"
```

For all endpoints: **http://localhost:3000/api-docs**

---

## Update & Management

### Linux / macOS

```bash
# First-time start (or after code update)
cd ~/.postgrify/packages && docker compose up -d --build

# Restart (config change, no rebuild needed)
cd ~/.postgrify/packages && docker compose restart

# Stop (keep all data)
cd ~/.postgrify/packages && docker compose down

# Fresh start — WIPES ALL DATA (databases, users, setup)
cd ~/.postgrify/packages && docker compose down -v && docker compose up -d --build

# Follow logs
cd ~/.postgrify/packages && docker compose logs -f

# Update to latest version
cd ~/.postgrify && git pull && cd packages && docker compose up -d --build
```

### Windows (PowerShell)

```powershell
# First-time start (or after code update)
cd "$env:USERPROFILE\.postgrify\packages"; docker compose up -d --build

# Restart (config change, no rebuild needed)
cd "$env:USERPROFILE\.postgrify\packages"; docker compose restart

# Stop (keep all data)
cd "$env:USERPROFILE\.postgrify\packages"; docker compose down

# Fresh start — WIPES ALL DATA (databases, users, setup)
cd "$env:USERPROFILE\.postgrify\packages"; docker compose down -v; docker compose up -d --build

# Follow logs
cd "$env:USERPROFILE\.postgrify\packages"; docker compose logs -f

# Update to latest version
cd "$env:USERPROFILE\.postgrify"; git pull; cd packages; docker compose up -d --build
```

> **Note:** `docker compose down -v` removes all volumes — this permanently deletes your PostgreSQL data, user accounts, and setup configuration. You will need to run the setup wizard again. Use this only to start completely fresh.

---

## Configuration

All settings are in `packages/.env` inside the install directory. After making changes, restart the services:

```bash
# Linux/macOS
cd ~/.postgrify/packages && docker compose up -d

# Windows
cd "$env:USERPROFILE\.postgrify\packages"; docker compose up -d
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PG_PASSWORD` | PostgreSQL password | auto-generated |
| `JWT_SECRET` | Token signing key (32+ chars) | auto-generated |
| `ADMIN_SECRET` | Admin token password | auto-generated |
| `JWT_EXPIRY` | Token validity duration | `24h` |
| `RATE_LIMIT_GLOBAL` | Requests per minute per IP | `1000` |

For all variables: [`exampleenv.md`](exampleenv.md)

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code standards, and how to submit a pull request.

---

## License

MIT