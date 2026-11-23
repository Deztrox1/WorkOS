# Known gaps

| ID | Gap | Why |
|---|---|---|
| ST-12 | Settings edits "1 USD = N INR" but `os_settings.fx` keeps USD per unit (INR 1/80), not the literal 80 | The seeded and migrated convention is `{"USD":1,"INR":0.0119,"GBP":1.3}`; the UI converts. Finance totals match the stories |
| NT-02, NT-08 | Pinned notes order by creation (oldest first), unpinned by newest creation | The stories need a new pin to land right after the existing pin, and unpin to restore the old order; `updated_at` moves on every pin |
| CP-15 | The GHL location id (read from `raw.location_id`) is a best guess | Not in the spec; check against a live row. The repo URLs now use the real remotes (`Deztrox1/cold-outreach` and `/workos`) |
| PU-01, PU-12, SH-14, SH-20, SH-22 | Manual stories, not run | Need a phone, the VPS timer, 4G throttling, the real hosts and GitHub Actions |
| PU-02..PU-06, PU-09..PU-11, PU-13, RM-09 (server half), RM-14, RM-18, RM-19, CL-*, IN-02, IN-03, IN-05, IN-06, FU-02, FU-03, FU-05..FU-07, FU-10, SC-01, SC-02, SC-05, ST-07, TK-10 (sql form), CP-01 (sql form) | Server side or SQL stories | Collectors, `push_due.py` and the database are not part of `app/`. The app halves are covered (RM-09 in app by RM-11, TK-10 and CP-01 in the app) |
| SC-03, SC-04, SC-06 | Not tested here | The CSP is an nginx header; `index.html` has the noindex meta only. Grep `dist/` for keys before deploy |
| Live mode | Never run against the real Supabase project | The anon key was not available in this session. The Supabase client code path compiles but is untested |
| Real Web Push | Not exercised | Headless Chromium has no push service. Mock mode saves a stand-in subscription; live mode calls `pushManager.subscribe` |
| Habits best streak | Counts the last 400 days of logs only | The slice query window |
| Capacitor | `cap sync` not run | No platform is added by design |
| Contrast | `--mute` is `#626c75` (design `#8a949c`) and light `--warn` is `#9a5c00` | The design values fail AA for 13 px text |
| Make task twice | A second "Make task" on the same note fails | `os_tasks` is unique on (`source`, `source_ref`), and the note id is now the `source_ref`. The toast shows the error |
| Phone row menu | Tomorrow, Followed up and Open sit in a menu under 768 px | One compact action keeps line 3 whole; wide screens keep the text buttons |
