# Running the worker

The worker finds jobs, scores them for each person and sends their emails. CVs and onboarding's AI steps run on the web host as people ask, not here.

`npm run worker` makes one pass: it runs today's pipeline if it hasn't finished and sends any emails that are due. Run it again and it resumes, without paying for finished work twice, so a power or internet cut only delays things.

`npm run worker -- --loop` stays up and repeats that pass each minute. **Prefer this**, because each email goes at the user's own send time only while the worker is up. Otherwise it goes out on the next pass.

Times are controlled by `RUN_START_HOUR_UTC` (default 1, which is 2am in Lagos) and `RUN_ALERT_HOUR_UTC` (default 6).

## Which database

| Command | Reads settings from | Writes to |
| --- | --- | --- |
| `npm run worker` | `.env` | Local Supabase, for development |
| `npm run worker:live` | `.env.production` | The live Supabase project behind the deployed site |

Either way the work happens on your Mac. With `LLM_PROVIDER=claude-subscription`, the AI steps use your own Claude login, and only the results are written to the database. Subscription mode does AI work only for `OWNER_EMAIL` and the synthetic personas, so other people who sign up get no matches until you move to an API key.

Before the first live run, load the employer boards to scan with `npm run seed:companies:live`. The run also needs you signed up on the deployed site with your preferences saved, because it keeps only the postings someone wants.

The worker fetches every job board and feed whoever is signed up, and stores only the postings at least one person could want.

## Keep it running on macOS

A LaunchAgent starts the live worker's loop when you log in and restarts it if it stops. Run these from the repo root. For the local database instead, change `worker:live` to `worker` in the setup below.

**Set it up** (once):

```bash
mkdir -p .local ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/com.cvtailor.worker.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.cvtailor.worker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string><string>cd "$PWD" &amp;&amp; npm run worker:live -- --loop</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$PWD/.local/worker.log</string>
  <key>StandardErrorPath</key><string>$PWD/.local/worker.log</string>
</dict>
</plist>
EOF
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cvtailor.worker.plist
```

`$PWD` is filled in with the repo's path when you run this, so run it from the repo root. `zsh -lc` loads your shell profile, which gives the worker the same `npm` and `node` you use in Terminal.

**Day to day:**

```bash
tail -f .local/worker.log                                          # watch it
launchctl print gui/$(id -u)/com.cvtailor.worker | grep -E "state|pid"   # is it running?
launchctl kickstart -k gui/$(id -u)/com.cvtailor.worker            # restart, e.g. after pulling new code
launchctl bootout gui/$(id -u)/com.cvtailor.worker                 # stop until next login
```

To stop it for good, run the `bootout` line, then `rm ~/Library/LaunchAgents/com.cvtailor.worker.plist`.

In subscription mode the worker uses the Claude login of the macOS user who ran `npm run claude:login`, so set the agent up as that same user.

## When the Mac is off or asleep

The worker can't run while the Mac sleeps. When it wakes, the next pass catches up on a missed run. To get runs at 2am, keep the Mac plugged in and stop it sleeping on its own.

Everything people do themselves keeps working, because none of it touches the worker: signing up, onboarding, writing CVs, editing and downloads. Only new matches and the morning emails wait for it. A worker can't alert anyone while it's down, so the web app has its own daily check at `/api/cron/run-check`, called by Vercel Cron, which emails `OWNER_EMAIL` if no run has finished by 06:00 UTC.
