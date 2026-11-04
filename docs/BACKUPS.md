# Backups

Supabase's free tier has no automated backups you can restore yourself, so take your own. This holds people's work histories, so **encrypt it before it leaves your machine**, and keep backups no longer than 30 days, which is what the privacy page promises.

## Database, nightly

Get the connection string from the Supabase dashboard (Connect > Session pooler), and generate a passphrase you keep only in a password manager.

```bash
#!/usr/bin/env bash
# backup.sh. Requires: pg_dump 17+ matching the server, gpg, and rclone set up with a remote called "backups".
set -euo pipefail
STAMP=$(date -u +%F)
FILE="cvtailor-$STAMP.dump.gpg"
pg_dump "$SUPABASE_DB_URL" --format=custom --schema=public --schema=auth --no-owner \
  | gpg --batch --symmetric --cipher-algo AES256 --passphrase-file ~/.cvtailor-backup-pass -o "/tmp/$FILE"
rclone copy "/tmp/$FILE" backups:cvtailor/
rm -f "/tmp/$FILE"
rclone delete --min-age 30d backups:cvtailor/
```

Schedule it with cron (`0 3 * * * /path/to/backup.sh`) or Windows Task Scheduler. Any object store works; Cloudflare R2 and Backblaze B2 both have free allowances. Check current limits before relying on them.

## Storage (the PDFs)

PDFs can always be re-rendered from `resume_versions`, which is in the database dump. So storage needn't be backed up. After a restore, re-render any PDFs an email needs by setting that match's `tailor_status` to `drafted` and running the worker.

## Restore

**Practise this once before you need it.** An untested backup isn't a backup.

```bash
gpg --batch --decrypt --passphrase-file ~/.cvtailor-backup-pass cvtailor-YYYY-MM-DD.dump.gpg > restore.dump
pg_restore --clean --if-exists --no-owner -d "$TARGET_DB_URL" restore.dump
```

## After a deletion request

A deleted account stays in old backups until they age out. That's why the 30-day rule matters. If you restore an old backup, re-apply any account deletions made since that date.
