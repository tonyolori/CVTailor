# Running the worker

`npm run worker` makes one pass: it runs today's pipeline if it hasn't finished, sends any emails that are due, and picks up onboarding tasks. Run it again and it resumes, without paying for finished work twice, so a power or internet cut only delays things.

`npm run worker -- --loop` stays up and repeats that pass each minute. **Prefer this**, because each email goes at the user's own send time only while the worker is up. Otherwise it goes out on the next pass.

Times are controlled by `RUN_START_HOUR_UTC` (default 1, which is 2am in Lagos) and `RUN_ALERT_HOUR_UTC` (default 6).

## Windows Task Scheduler

Create a task that starts the loop at logon and restarts it if it stops:

```powershell
$action = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument '/c cd /d C:\path\to\CVTailor && npm run worker -- --loop >> .local\worker.log 2>&1'
$triggers = @(New-ScheduledTaskTrigger -AtLogOn)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "CV Tailor worker" -Action $action -Trigger $triggers -Settings $settings
```

`-StartWhenAvailable` is the part that catches up after the PC was off overnight. In subscription mode, run this as the same Windows user who ran `npm run claude:login`, since the login is stored per user.

## Linux: systemd

`~/.config/systemd/user/cvtailor.service`:

```ini
[Unit]
Description=CV Tailor worker
After=network-online.target

[Service]
WorkingDirectory=%h/CVTailor
ExecStart=/usr/bin/npm run worker -- --loop
Restart=always
RestartSec=60

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now cvtailor
loginctl enable-linger "$USER"   # keeps it running while you're logged out
journalctl --user -u cvtailor -f
```

If you'd rather not keep a process up, a timer works too, at the cost of emails going out up to one interval late:

```ini
# ~/.config/systemd/user/cvtailor.timer, with Type=oneshot and no --loop in the service
[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
```

## macOS

`launchd` works the same way: a `LaunchAgent` with `RunAtLoad` and `KeepAlive` set to true, running `npm run worker -- --loop` in the repo.

## Docker

```bash
docker compose up -d worker
```

Docker needs `LLM_PROVIDER=anthropic-api`. Subscription mode relies on a Claude login on the host, so it isn't meant for a container.

## When the PC is off

The dashboard, editing and PDF downloads keep working, because they don't touch the worker. Onboarding's AI steps wait in a queue, and users can fill those in by hand. A worker can't alert anyone while it's down, so the web app has its own daily check at `/api/cron/run-check`, called by Vercel Cron, which emails `OWNER_EMAIL` if no run has finished by 06:00 UTC.
