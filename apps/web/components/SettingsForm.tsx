"use client";

import { useActionState } from "react";
import { cancelNotifyChange, resendNotifyConfirm, updateSettings } from "@/app/actions";

interface SettingsProfile {
  tz: string;
  send_time: string;
  daily_cap: number;
  notify_email: string | null;
  notify_email_pending: string | null;
  email: string;
  active: boolean;
  email_paused: boolean;
}

export function SettingsForm({ profile, zones }: { profile: SettingsProfile; zones: string[] }) {
  const [state, action, pending] = useActionState(updateSettings, null);
  return (
    <form className="card" action={action}>
      <h2>Daily email</h2>
      <div className="grid2">
        <label>
          Send time
          <input type="time" name="send_time" defaultValue={profile.send_time.slice(0, 5)} required />
        </label>
        <label>
          Time zone
          <select name="tz" defaultValue={profile.tz}>
            {zones.includes(profile.tz) ? null : <option value={profile.tz}>{profile.tz}</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label>
          Most matches per day
          <input type="number" name="daily_cap" min={1} max={10} defaultValue={profile.daily_cap} required />
        </label>
        <label>
          <span>
            Send to <span className="opt">(if not {profile.email})</span>
          </span>
          <input type="email" name="notify_email" defaultValue={profile.notify_email_pending ?? profile.notify_email ?? ""} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" name="email_paused" defaultChecked={profile.email_paused} />
        Pause email. Results still appear here.
      </label>
      <label className="check">
        <input type="checkbox" name="paused" defaultChecked={!profile.active} />
        Pause my search entirely.
      </label>
      {profile.notify_email_pending && !state ? (
        <div className="notice warn" role="status">
          Waiting for you to confirm {profile.notify_email_pending}. Open the link we sent there. Until then, emails go to {profile.notify_email ?? profile.email}.
          <span className="acts" style={{ marginTop: 8 }}>
            <button className="sm" type="submit" formAction={resendNotifyConfirm} formNoValidate>
              Send the link again
            </button>
            <button className="sm quiet" type="submit" formAction={cancelNotifyChange} formNoValidate>
              Keep the current address
            </button>
          </span>
        </div>
      ) : null}
      {state?.message ? <div className={`notice ${state.ok ? "ok" : "bad"}`}>{state.message}</div> : null}
      <div>
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
