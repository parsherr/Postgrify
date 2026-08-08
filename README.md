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

> **Windows users:** Native installation is not supported. Use WSL2 instead — run `wsl --install` in PowerShell (requires restart), then open the WSL terminal and run the command below.

### Requirements

- **Linux** (Ubuntu, Debian, Fedora, CentOS, Arch) or **macOS**
- `curl` — everything else (git, Docker) is installed automatically if missing
- `sudo` access for Docker installation

### Single command (Linux / macOS / WSL2)

```bash
curl -fsSL https://raw.githubusercontent.com/parsherr/postgrify/main/install.sh | bash
```

The script will:

1. Install Docker if not present
2. Clone the repo into `~/.postgrify/`
3. Auto-generate all secrets (`JWT_SECRET`, `ADMIN_SECRET`, `PG_PASSWORD`) — no prompts, no interaction
4. Start all services (PostgreSQL, Redis, API, GUI)
5. Print the URL where you finish setup

**After the script finishes**, open http://localhost:5173/setup in your browser and create your admin account. That's the only step that requires user input.

> All generated secrets are saved in `~/.postgrify/packages/.env`. Keep this file safe.

---

## Services

Once installation is complete:

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

```bash
# Stop
cd ~/.postgrify/packages && docker compose down

# Start
cd ~/.postgrify/packages && docker compose up -d

# Follow logs
cd ~/.postgrify/packages && docker compose logs -f

# Update to latest version
cd ~/.postgrify && git pull && cd packages && docker compose up -d --build
```

---

## Configuration

All settings are in `~/.postgrify/packages/.env`. After making changes, run:

```bash
cd ~/.postgrify/packages && docker compose up -d
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PG_PASSWORD` | PostgreSQL password | auto-generated |
| `JWT_SECRET` | Token signing key (>=32 chars) | auto-generated |
| `ADMIN_SECRET` | Admin token password | auto-generated |
| `JWT_EXPIRY` | Token validity duration | `24h` |
| `RATE_LIMIT_GLOBAL` | Requests per minute per IP | `1000` |

For all variables: [`exampleenv.md`](exampleenv.md)

---

## License

MIT