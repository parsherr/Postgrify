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

### Requirements

- Linux or macOS
- `curl` and `git` (Docker is installed automatically if missing)
- A fresh server or local machine

### Single command

```bash
curl -fsSL https://raw.githubusercontent.com/parsherr/postgrify/main/install.sh | bash
```

The script will:
1. Install Docker if not present
2. Create `~/.postgrify/` and set up required files
3. Auto-generate `JWT_SECRET` and `ADMIN_SECRET`
4. Ask only for a PostgreSQL password (the only interactive step)
5. Start all services and print the URLs + Admin Secret

> **Note:** Save the `ADMIN_SECRET` printed at the end of installation — it will not be shown again. It is also stored in `~/.postgrify/.env`.

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
curl -X POST http://localhost:3000/auth/token/admin   -H "Content-Type: application/json"   -d '{"secret": "YOUR_ADMIN_SECRET"}'
```

### Add a database

```bash
curl -X POST http://localhost:3000/admin/databases   -H "Authorization: Bearer ADMIN_TOKEN"   -H "Content-Type: application/json"   -d '{"name": "myproject"}'
```

### Get a DB token and use it

```bash
# Get a scoped token
curl -X POST http://localhost:3000/auth/token   -H "Content-Type: application/json"   -d '{"database": "myproject", "secret": "YOUR_ADMIN_SECRET", "scopes": ["read","write"]}'

# List tables
curl http://localhost:3000/db/myproject/tables   -H "Authorization: Bearer DB_TOKEN"
```

For all endpoints: **http://localhost:3000/api-docs**

---

## Update & Management

```bash
# Stop
cd ~/.postgrify && docker compose down

# Start
cd ~/.postgrify && docker compose up -d

# Follow logs
cd ~/.postgrify && docker compose logs -f

# Rebuild (after updating source code)
cd ~/.postgrify && docker compose up -d --build
```

---

## Configuration

All settings are in `~/.postgrify/.env`. After making changes, run `docker compose up -d`.

| Variable | Description | Default |
|----------|-------------|---------|
| `PG_PASSWORD` | PostgreSQL password | set during installation |
| `JWT_SECRET` | Token signing key (>=32 chars) | auto-generated |
| `ADMIN_SECRET` | Admin token password | auto-generated |
| `JWT_EXPIRY` | Token validity duration | `24h` |
| `RATE_LIMIT_GLOBAL` | Requests per minute per IP | `1000` |

For all variables: [`exampleenv.md`](exampleenv.md)

---

## License

MIT