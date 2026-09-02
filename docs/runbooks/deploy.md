# Deploy runbook (self-hosted, single always-on host)

Phase 1 target: a Docker-capable machine you control (per the PRD's
"self-hosted first" principle). No cloud deployment is configured yet.

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
6. Visit `http://<host>:8080`, sign in with the bootstrap admin credentials.
7. `curl http://<host>:8080/health/ready` should report `"status": "ok"`.

This should complete well within the PRD's 20-minute fresh-install target
(release acceptance criteria, PRD SS18) — if it doesn't, that's a bug.

## Exposing it beyond localhost

The stack binds `web` to port 8080 with no TLS by default. To expose it on
the internet:

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

## Switching adapters (Phase 2+)

Set `INGEST_ADAPTER` in `.env` once a real adapter exists. Do not switch
away from `simulator` until docs/data-source-register.md's capture and
licence review are complete for that source.
