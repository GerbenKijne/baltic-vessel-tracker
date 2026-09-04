# Deploy runbook (self-hosted, single always-on host)

Phase 1 target: a Docker-capable machine you control (per the PRD's
"self-hosted first" principle). No cloud deployment is configured yet.

For a Synology NAS specifically, see [Synology NAS](#synology-nas) below —
read that section instead of (in addition to) "Fresh install."

## Fresh install

1. Install Docker Engine + Compose plugin on the host.
2. Clone this repo onto the host.
3. `cp .env.example .env` and fill in real values — a strong
   `POSTGRES_PASSWORD`, and `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD`
   for the first admin account (only used if the `users` table is empty).
4. From the repo root:
   ```bash
   docker compose -f infra/compose/docker-compose.yml --env-file .env up -d --build
   ```
5. Check `docker compose -f infra/compose/docker-compose.yml ps` — `postgres`
   and `redis` should be healthy, `migrate` should have exited 0, `api` and
   `worker-ingest` should be running.
6. Visit `http://<host>:8090` (or whatever `WEB_PORT` you set in `.env`),
   sign in with the bootstrap admin credentials.
7. `curl http://<host>:8090/health/ready` should report `"status": "ok"`.

This should complete well within the PRD's 20-minute fresh-install target
(release acceptance criteria, PRD SS18) — if it doesn't, that's a bug.

## Exposing it beyond localhost

The stack binds `web` to `WEB_PORT` (default 8090) with no TLS by default.
To expose it on the internet:

1. Point a domain's DNS at the host.
2. Edit `infra/compose/Caddyfile`, replacing the placeholder `:80` block
   with `your-domain.example { reverse_proxy web:80 }`.
3. Start the `proxy` profile: `docker compose -f infra/compose/docker-compose.yml --env-file .env --profile proxy up -d`.
4. Set `COOKIE_SECURE=true` in `.env` (the default) so session cookies
   require HTTPS.

Do not expose the stack to the internet without authentication configured
(`BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` set) — see PRD SS15
(security threat model), "unauthorized remote access."

## Updating

```bash
git pull
docker compose -f infra/compose/docker-compose.yml --env-file .env up -d --build
```

The `migrate` service re-runs on every `up`; Alembic migrations are
idempotent (it's a no-op if already at `head`).

## Switching adapters

Add, edit, enable, or disable a data source from **Admin -> Data
sources** in the running app — this is no longer a `.env` setting. The
worker notices the change (checked every 20s) and restarts itself to
apply it; no Compose command needed for this specific change. Do not
enable `aisstream` until docs/data-source-register.md's capture and
terms review are complete for that source, and you've made your own call
on the terms gap it documents (see `workers/ingest/README.md`).

**Always include `--env-file .env` on every Compose command**, including
one-off single-service rebuilds. Without it, Compose silently falls back
to hardcoded defaults instead of erroring — a service can end up running
the wrong password or the `simulator` adapter instead of a real one,
with no warning. If a service is behaving as if `.env` doesn't exist
even though it does, this is the first thing to check:
`docker compose -f infra/compose/docker-compose.yml --env-file .env config | grep <VAR>`
to confirm what's actually being resolved.

## Synology NAS

### 0. Prerequisites

- **Container Manager** installed (Package Center → search "Container
  Manager"; on older DSM it's called "Docker"). If it's not offered in
  Package Center, this model/DSM version doesn't support it — check
  Synology's compatibility list.
- **SSH enabled**: Control Panel → Terminal & SNMP → check "Enable SSH
  service." Note the port (default 22).
- Confirm CPU architecture over SSH — every image this stack uses
  (`postgis/postgis`, `redis`, `python`, `node`, `nginx`, `caddy`) publishes
  both, so either is fine:
  ```bash
  uname -m   # x86_64 or aarch64 — both supported
  ```

### 1. Get the code onto the NAS

The repo is private, so a plain `git clone` needs credentials. The
cleanest option is a **read-only deploy key**:

1. On the NAS: `ssh-keygen -t ed25519 -f ~/.ssh/baltic_deploy_key -N ""`
   (run as the user you'll deploy as).
2. `cat ~/.ssh/baltic_deploy_key.pub` and add it on GitHub under
   the repo's Settings → Deploy keys → Add deploy key (read-only is
   enough — this key should never need write access).
3. Clone using that key:
   ```bash
   GIT_SSH_COMMAND="ssh -i ~/.ssh/baltic_deploy_key" \
     git clone git@github.com:GerbenKijne/baltic-vessel-tracker.git \
     /volume1/docker/baltic-vessel-tracker
   ```
   (Adjust the destination path to a Shared Folder you've created for
   Docker projects, e.g. via File Station.)

If `git` isn't available over SSH, install the **Git Server** package
from Package Center (it installs the `git` binary NAS-wide even if you
don't use its hosting feature) — or, as a fallback with no git at all,
download the repo as a zip from GitHub (in your own logged-in browser)
and extract it into that folder via File Station.

### 2. Configure and start

```bash
cd /volume1/docker/baltic-vessel-tracker
cp .env.example .env
vi .env   # set POSTGRES_PASSWORD, BOOTSTRAP_ADMIN_EMAIL/PASSWORD
sudo docker compose -f infra/compose/docker-compose.yml --env-file .env up -d --build
```

Synology usually requires `sudo` for Docker commands unless your user is
in the relevant admin group. If `docker compose` (the v2 plugin syntax)
isn't recognized, try the older `docker-compose` (hyphenated) — which
binary is present depends on the Container Manager/Docker package version.

### 3. Access it

- LAN: `http://<nas-ip>:8090` (the default `WEB_PORT`).
- On a NAS already running other Docker services, a port collision here is
  common — a Synology running Unifi Network Application, for instance,
  already claims 8080. If `up` fails with "port is already allocated" or
  "address already in use", check what's already bound
  (`sudo docker ps -a` for other containers, `sudo netstat -tlnp | grep <port>`
  for anything else) and set a free `WEB_PORT` in `.env` instead of editing
  the compose file.

### 4. Exposing it beyond the LAN (optional)

Skip this repo's Caddy profile on a Synology — DSM already has a mature
reverse proxy with automatic Let's Encrypt certs, which is the more
idiomatic fit here:

1. Control Panel → Login Portal → Advanced → Reverse Proxy → Create.
2. Source: your chosen subdomain, HTTPS, port 443.
3. Destination: `localhost`, your `WEB_PORT` (8090 by default).
4. Control Panel → Security → Certificate to issue/attach a Let's Encrypt
   cert for that subdomain, if DSM hasn't already offered to.
5. Set `COOKIE_SECURE=true` in `.env` (the default) once it's served over
   HTTPS.

Don't port-forward `WEB_PORT` directly from your router — go through
DSM's reverse proxy so it's TLS-terminated.

### 5. Survives reboots?

Yes — the compose file sets `restart: unless-stopped` on every service,
and Synology's Container Manager keeps the Docker daemon running as a
system service, so containers come back up automatically after a NAS
reboot. No extra Task Scheduler entry needed.

### 6. Updating

```bash
cd /volume1/docker/baltic-vessel-tracker
git pull
sudo docker compose -f infra/compose/docker-compose.yml --env-file .env up -d --build
```
