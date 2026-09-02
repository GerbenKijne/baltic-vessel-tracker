# Backup and restore runbook

PRD SS16.2 requires documented `pg_dump`/`pg_restore` backup/restore with a
quarterly restore-test recommendation. This covers the Postgres database
only — Redis holds no data that isn't safe to lose (sessions, dedupe
markers, the vessel-updates stream) and is not backed up.

## Backup

```bash
docker compose -f infra/compose/docker-compose.yml exec postgres \
  pg_dump -U baltic -d baltic --format=custom --file=/tmp/backup.dump
docker compose -f infra/compose/docker-compose.yml cp postgres:/tmp/backup.dump ./backup-$(date +%Y%m%d).dump
```

Store the resulting `.dump` file somewhere off the host (it contains vessel
history and any watchlist/geofence data users have created).

## Restore

Onto a fresh `postgres` volume (e.g. disaster recovery, or standing up a
second instance):

```bash
docker compose -f infra/compose/docker-compose.yml cp ./backup-YYYYMMDD.dump postgres:/tmp/backup.dump
docker compose -f infra/compose/docker-compose.yml exec postgres \
  pg_restore -U baltic -d baltic --clean --if-exists /tmp/backup.dump
```

Run the `migrate` service afterward in case the backup predates a schema
change:

```bash
docker compose -f infra/compose/docker-compose.yml run --rm migrate
```

## Recovery objectives (PRD SS14, availability)

- RPO ≤ 24h: back up at least daily once this is live with real data (no
  automated backup schedule is wired up yet — cron it on the host, or add a
  scheduled task, before going beyond local/personal use).
- RTO ≤ 2h: the restore steps above should complete in minutes; the budget
  is mostly for provisioning a replacement host if the original is lost.

## Testing this runbook

Quarterly: run a backup, restore it into a scratch Postgres container, and
confirm `SELECT count(*) FROM vessels;` (or similar) returns the expected
data. An untested backup is not a backup.
