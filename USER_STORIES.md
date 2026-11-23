# WorkOS v1: User Stories (from PRD v3, 2026-10-22)

The owner is the only user. Phone = under 768 px. Laptop = 768 px and up. Column names follow `db/migrations/0001_os_schema.sql` plus migration 0004 in the PRD. "AC n" = PRD section 8 acceptance item n.

## Fixtures used below

| Name | Content |
|---|---|
| FX-CLOCK | Clock pinned to Wed 2026-10-21 10:00 IST. Tomorrow = 2026-10-22. Day 14 = 2026-11-04. Day 15 = 2026-11-05 |
| FX-SEED | Seeded: 24 work tasks, 4 habits, 2 reminders, 44 campaigns (latest rows), 3 heartbeat events, costs, Skillcamp invoice |
| FX-TASKS | One open work task per bucket: due 2026-10-18 (overdue), 10-21, 10-22, 10-23, 11-04, 11-05, no date |
| FX-TODO | Work tasks A, B planned_for 10-21 (A 20 min, B null min); overdue O1..O4 due 10-10, 10-12, 10-14, 10-16 with 10, 15, 5, 8 min, planned_for null |
| FX-EVT3 | 3 unread work events: bad "Instantly bounce high", warn "Invoice behind", info "Heartbeat ok" |
| FX-CAMP | Email campaigns: E1 active sent 150 bounces 9; E2 active sent 99 bounces 50; E3 paused `raw.playbook_status = LIVE`; E4 active with snapshots 10-20 and 10-21 (sent 100, 130; replies 4, 6) |
| FX-SMS | `os_sms_days` for 2026-10-20: ghl-primary sent 120 replies 9 positives 3 stops 8 capped true; ghl-brightpath sent 40 replies 2 positives 1 stops 0 |
| FX-FIN | Oct 2026: costs Anthropic 118, Winnr 69, GoSimless about 16, Google Workspace 23 (no Instantly until Nov 2026); Skillcamp invoice from ledger.json; `profit_target` 1000 USD |

## Sign in

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| SI-01 | to sign in with email and password so that I see my data on phone and laptop | Given a signed-out browser and the one valid user<br>When I submit the correct email and password on `/#/signin`<br>Then I land on `/#/` and a session exists | 5.1, AC 1 | P1 | playwright |
| SI-02 | a clear error on a wrong password so that I know what failed | Given the password "wrong-pass"<br>When I submit<br>Then an error shows under the field, I stay on `/#/signin`, and no mode switch is visible | 5.1, 3 | P2 | playwright |
| SI-03 | to reset a forgotten password so that I am not locked out | Given my email in the field<br>When I tap "Forgot password"<br>Then one Supabase reset mail request is sent and a confirmation shows | 5.1 | P2 | manual |
| SI-04 | the reset link to open a new-password form so that I can finish the reset | Given a link `/#/reset#access_token=T&type=recovery`<br>When I open it<br>Then the token is read before routing and a new-password form shows | 2 Routing, 5.1 | P2 | playwright |
| SI-05 | to stay signed in so that I do not log in every visit | Given I signed in<br>When I reload and later reopen the tab<br>Then I am still signed in through the refresh token | 2 Auth | P1 | playwright |
| SI-06 | no sign-up screen so that nobody else can make an account | Given sign-ups switched off in Supabase<br>When I look for a sign-up link on `/#/signin` and call the Auth sign-up API with a new email<br>Then no link exists and the API refuses | 1 Scope, 2 Auth | P2 | manual |
| SI-07 | a signed-out visit to any page to land on Sign in so that the data stays private | Given no session<br>When I open `/#/tasks`<br>Then I land on `/#/signin` and no `os_*` data is requested | 2 Auth | P1 | playwright |

## Today

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| TD-01 | the greeting to change at 14:00 IST so that it fits the time of day | Given FX-CLOCK set to 13:59 then 14:00<br>When Today is open<br>Then the greeting text differs and the block layout is identical | 5.2 | P3 | playwright |
| TD-03 | to type today's plan in one line so that the day has a headline | Given no `os_days` row for 2026-10-21<br>When I type "Ship WorkOS" in the plan line and blur<br>Then one `os_days` row (day 2026-10-21, plan set) is upserted and survives reload | 5.2, 4 Day rows | P2 | playwright |
| TD-04 | a short To do list ordered by plan then overdue so that I see what matters first | Given FX-TODO<br>When I open Today in Work mode<br>Then rows are A, B, O1, O2, O3 (5 rows), O4 is hidden, "1 more" links to `/#/tasks`, and the footer reads 5 tasks, 50 min (null min counts as 0; A 20, O1 10, O2 15, O3 5) | 5.2 | P1 | playwright |
| TD-07 | to tick a task done from Today so that it leaves the list | Given FX-TODO with task A on Today<br>When I check A<br>Then A has status done and completed_at set, A leaves the list, and O4 moves up into the fifth row (the footer count stays 5) | 5.2, 4 Done | P1 | playwright |
| TD-10 | today's reminders with fired one-offs struck through so that I see what already went off | Given a daily 09:00 active reminder, a one-off with last_fired_at 2026-10-21 08:00, and an inactive daily<br>When Today renders<br>Then the daily shows "09:00", the one-off shows struck through, the inactive one is absent | 5.2 | P2 | playwright |
| TD-11 | a banner for reminders that fired while the app was closed so that I do not miss them | Given os_settings.last_opened_at 2026-10-20 22:00 and a reminder last_fired_at 2026-10-21 06:30<br>When I open Today<br>Then a top banner lists it with "06:30", and a reload shows no banner | 5.2, 5.5 Missed | P1 | playwright |
| TD-13 | a Campaigns block with the day's numbers so that I see the health at a glance | Given FX-CAMP and FX-SMS<br>When Today renders in Work mode<br>Then it shows 3 active email campaigns (E1, E2, E4), summed replies and positives, SMS 160 sent / 11 replies / 4 positives for yesterday, and E1 (6.0% bounce, sent 150) as worst; E2 is excluded (sent under 100) | 5.2 | P1 | playwright |
| TD-16 | the exact empty texts so that blank blocks make sense | Given no tasks, reminders, habits, campaign snapshots or events in the mode<br>When Today renders<br>Then the five texts show: "Nothing planned. Pick tasks on Plan." / "No reminders today." / "No habits today." / "No campaign data yet." / "Feed is clear." | 4 Empty text | P2 | playwright |
| TD-17 | Today to use the IST date after midnight so that the day rolls over by itself | Given Today open and the clock moves from 23:59 to 00:00 IST<br>When the timer fires<br>Then queries re-run with the new IST date literal and os_settings.last_opened_at is written | 2 Time | P1 | playwright |
| TD-18 | Today to show the date in IST so that I know which day it is | Given a device in America/Los_Angeles at 2026-10-21 23:00 (2026-10-22 11:30 IST)<br>When Today renders<br>Then the date line reads "Thu 22 Oct" and queries use the literal 2026-10-22 | 5.2, 2 Time | P2 | playwright |
| TD-19 | a Tomorrow button on a Today row so that I push a task one day | Given FX-TODO with A planned_for 2026-10-21 on Today<br>When I tap Tomorrow on A<br>Then A has planned_for = 2026-10-22, leaves the list, and O4 fills the fifth row | 5.2 | P1 | playwright |
| TD-20 | a task planned for a later day hidden on Today even if overdue so that planning wins | Given FX-TODO plus task Z due 2026-10-08 with planned_for 2026-10-23<br>When Today renders<br>Then Z is not in the list and not counted in "n more"; it still sits under Overdue on Tasks | 5.2 | P2 | playwright |
| TD-21 | an amber line when no email campaign runs so that a dead channel is loud | Given no active email campaign and the latest day an email campaign's sent total rose is 2026-10-18<br>When the Campaigns block renders<br>Then it reads "No email campaign running. Last send 18 Oct" in amber with the warn style, and with 1 active campaign the line is absent | 5.2 | P2 | playwright |
| TD-22 | no worst-campaign line unless bounce is above 3% so that noise stays out | Given E2 (sent 99, bounces 50) and an active campaign with sent 200 and bounces 6 (3.0%)<br>When the Campaigns block renders<br>Then no worst-campaign line shows | 5.2 | P3 | playwright |
| TD-23 | a Refresh button so that I can pull new data now | Given a task inserted from a terminal<br>When I tap Refresh on Today<br>Then the task shows without a page reload | 5.2 | P2 | playwright |
| TD-24 | the Habits block to list only habits scheduled today so that off days are quiet | Given habit M (Mon to Fri, streak 2) and habit S (Sat only) on Wed 2026-10-21<br>When Today renders<br>Then only M shows, with a done toggle and streak 2 | 5.2 | P2 | playwright |
| TD-25 | to toggle a habit on Today so that I log it in one tap | Given habit M not done today<br>When I toggle it on, then off<br>Then a log row (done = true) is created, then deleted | 5.2 | P1 | playwright |
| TD-26 | a tap on a reminder to open its edit sheet so that I can change it | Given a daily 09:00 reminder on Today<br>When I tap it<br>Then the reminder sheet opens with its fields filled | 5.2 | P3 | playwright |
| TD-27 | the Feed block to show the 5 newest unread events so that alerts reach me | Given 7 unread work events<br>When Today renders and I tap the newest one with a url<br>Then 5 rows show with a severity dot, title and relative time; the tapped event is marked read and its url opens | 5.2 | P2 | playwright |
| TD-28 | a tap on a task row to open its detail sheet so that I can see everything | Given task A on Today<br>When I tap its title<br>Then the task detail sheet opens for A | 5.2 | P2 | playwright |
| TD-29 | Today to follow the mode so that Personal shows no work blocks | Given a work and a personal task, and Personal mode<br>When Today renders<br>Then only the personal task shows and the Campaigns block is absent | 3, 5.2 | P2 | playwright |
| TD-30 | opening the app to record the time so that missed reminders are judged right | Given os_settings.last_opened_at 2026-10-20 22:00<br>When I open the app at 2026-10-21 10:00<br>Then last_opened_at is 2026-10-21 10:00 after the missed banner is built | 5.5 Missed, 2 Time | P2 | playwright |
| TD-31 | more planned tasks than rows to show "n more" so that nothing is hidden silently | Given 7 tasks planned for 2026-10-21<br>When Today renders<br>Then 5 rows show and "2 more" links to `/#/tasks` | 5.2 | P2 | playwright |

## Plan

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| PL-01 | two columns on a laptop and one stack on a phone so that the page fits | Given widths 1024 and 390<br>When I open `/#/plan`<br>Then at 1024 two columns show, at 390 the blocks stack | 5.3 | P2 | playwright |
| PL-02 | to write a review and pick a mood so that the day is closed | Given no `os_days` row for today 2026-10-21<br>When I type the review "Shipped the PRD", tap mood 4 and blur<br>Then one row is upserted with day 2026-10-21, review set and mood 4 | 5.3, 4 Day rows | P2 | playwright |
| PL-04 | a Tomorrow toggle on each task so that I pick tomorrow's work | Given three open tasks<br>When I toggle Tomorrow on all three, then off on one<br>Then two have planned_for = 2026-10-22 and one has null | 5.3, AC 3 | P1 | playwright |
| PL-06 | to see today's planned tasks and unplan them so that I can carry over | Given two open tasks with planned_for = 2026-10-21<br>When I tap Unplan on one<br>Then it leaves Carry over and planned_for is null | 5.3 | P2 | playwright |
| PL-07 | the picks to show first on Today after midnight so that the plan works | Given three tasks picked for 2026-10-22 and a mocked IST rollover<br>When Today loads<br>Then the three tasks are the first three rows | AC 3, 5.2 | P1 | playwright |
| PL-08 | to write tomorrow's plan so that tomorrow starts with a headline | Given no `os_days` row for 2026-10-22<br>When I type "Pitch deck" in Tomorrow plan and blur<br>Then one row (day 2026-10-22, plan set) is upserted and shows after reload | 5.3, 4 Day rows | P1 | playwright |
| PL-09 | unsaved text to save to the day it was typed for so that midnight loses nothing | Given Plan open at 23:55 with unsaved "Call bank" in Tomorrow plan (day 2026-10-22)<br>When the clock passes 00:00 IST<br>Then the text saves to day 2026-10-22, and the page now pairs Today = 10-22 with Tomorrow = 10-23 | 5.3 | P2 | playwright |
| PL-10 | a sticky footer with picked count and minutes so that I do not overbook | Given three picked tasks with 20, null and 10 minutes<br>When I scroll the Pick list<br>Then the footer stays visible and reads 3 picked, 30 min | 5.3, 4 Formats | P2 | playwright |

## Tasks

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| TK-01 | to add "Call Sam tomorrow 3pm 20m" in one Enter so that capture is fast | Given FX-CLOCK and Work mode<br>When I type it and press Enter once<br>Then a task has title "Call Sam", due_date 2026-10-22, due_time 15:00, est_minutes 20 | 5.4, AC 2 | P1 | playwright |
| TK-02 | a date word alone to leave time empty so that I do not invent a time | Given "Pay rent on 25 Oct"<br>When parsed<br>Then due_date 2026-10-25, due_time null, title "Pay rent" | 5.4 | P2 | unit |
| TK-03 | a time word alone to mean the next occurrence so that it is never in the past | Given FX-CLOCK 10:00 IST<br>When I type "stretch at 5pm" and then "stretch at 9am"<br>Then the first has due_date 10-21 17:00 and the second 10-22 09:00 | 5.4 | P1 | unit |
| TK-04 | duration, project and priority tokens parsed so that one line sets everything | Given "Draft deck #sales ! 1h" and "Tidy desk !low 45 min"<br>When parsed<br>Then first: project sales, priority 1, est 60; second: priority 3, est 45; default priority is 2; tokens are removed from titles | 5.4 | P2 | unit |
| TK-05 | a preview of every parsed field before Enter so that I can catch a wrong parse | Given I am typing "Call Sam tomorrow 3pm 20m"<br>When I have not pressed Enter<br>Then the preview shows title, due date, time, minutes, project, priority, area, and nothing is saved | 5.4 | P2 | playwright |
| TK-07 | to search title, notes, project and waiting_on so that I find anything | Given task X with "Sam" only in waiting_on<br>When I search "Sam"<br>Then X is listed and tasks without a match are hidden | 5.4 | P2 | playwright |
| TK-08 | tasks grouped by due date so that urgency is visible | Given FX-TASKS<br>When I open Tasks in Work mode<br>Then groups are Overdue (10-18), Today (10-21), Upcoming (10-22 and 10-23 and 11-04), Later (11-05), No date, with Tomorrow merged into Upcoming | 4 Grouping, 5.4 | P1 | playwright |
| TK-09 | Plan to show Tomorrow as its own group so that tomorrow stands out | Given FX-TASKS<br>When I open Plan<br>Then groups are Overdue, Today, Tomorrow (10-22), Next 14 days (10-23 to 11-04), Later (11-05), No date | 4 Grouping, 5.3 | P2 | playwright |
| TK-10 | every open task in exactly one group so that nothing is lost or doubled | Given the 24 seeded work tasks (status open count N)<br>When I sum group counts on Tasks<br>Then the sum equals N and no id appears twice | 4 Grouping | P2 | sql |
| TK-11 | a fixed sort inside groups so that the order is predictable | Given tasks with (due, time, priority, sort_order) = (10-21, null, 1, 0), (10-21, 09:00, 3, 5), (10-21, 09:00, 1, 2), (10-21, 09:00, 1, 1)<br>When Today group renders<br>Then order is 09:00/p1/so1, 09:00/p1/so2, 09:00/p3, then the null-time task | 4 Sort | P2 | unit |
| TK-12 | a three-line task row so that I see the blocker and the next step | Given a task with waiting_on "Sam's yes", next_action "Send quote", due 10-18, est 10, project sales, cost 12.5, updated 9 days ago<br>When the row renders<br>Then line 2 "Sam's yes → Send quote"; line 3 "3 d late · 10 min · sales · $12.50 · idle 9 d"; a 3-line title is cut to 2 lines with ellipsis | 4 Task row, 4 Formats | P1 | playwright |
| TK-13 | due dates in plain words so that I read them fast | Given today 10-21 and dues 10-21, 10-22, 10-25, 10-18, 11-20<br>When rows render<br>Then "Today", "Tomorrow", "Sun", "3 d late" in red, "20 Nov" | 4 Formats | P1 | unit |
| TK-14 | Done to stamp the completion so that history is true | Given an open task<br>When I check it<br>Then status = done and completed_at is within 2 s of now, and it appears under Done | 4 Done | P1 | playwright |
| TK-15 | the Done group collapsed and limited to 30 days so that old work does not clutter | Given done tasks updated 5 and 40 days ago and a dropped one 2 days ago<br>When I expand Done<br>Then the 5-day done and 2-day dropped show, the 40-day one does not, and Done starts collapsed | 4 Grouping, 5.4 | P2 | playwright |
| TK-16 | to uncheck a done task so that a slip is reversible | Given a done task under Done<br>When I uncheck it<br>Then status = open, completed_at = null, and it returns to its date group | 4 Done | P1 | playwright |
| TK-17 | Drop to keep a task without doing it so that history stays honest | Given an open task<br>When I tap Drop in its sheet<br>Then status = dropped, the row is struck through under Done with no checkbox, and its sheet shows Reopen instead of Done and Drop | 4 Drop vs Delete | P1 | playwright |
| TK-19 | Delete behind a confirm so that I never lose a task by accident | Given an open task<br>When I tap Delete, cancel, then Delete and confirm<br>Then the first leaves the row, the second removes it from os_tasks | 4 Drop vs Delete, 5.4 | P2 | playwright |
| TK-20 | a detail sheet that edits all fields and shows source info so that I can fix anything | Given a task<br>When I open its sheet<br>Then title, notes, due date, due time, planned for, priority, est minutes, project, waiting on, next action, cost and area are editable, and source, created, updated are read only | 5.4 | P1 | playwright |
| TK-22 | the exact empty texts on every list so that a blank screen is clear | Given an empty mode and a search with no match<br>When I open Tasks, Plan, Reminders, Habits, Campaigns<br>Then they read "No tasks here.", "No open tasks.", "No reminders.", "No habits yet.", "No campaign data yet." | 4 Empty text | P2 | playwright |
| TK-23 | a "both" toggle so that I can see work and personal together | Given Personal mode, work task W and personal task P<br>When I turn on "both"<br>Then W and P both list | 3, 5.4 | P2 | playwright |
| TK-24 | quick add to use the current mode so that Personal captures stay personal | Given Personal mode<br>When I add "Call mum"<br>Then the task has area = personal | 5.4 | P2 | playwright |
| TK-25 | quick add in "both" to save as work so that the area is never blank | Given "both" is on<br>When I add "Pay vendor"<br>Then the task has area = work | 5.4 | P2 | playwright |
| TK-26 | a date without a year to look forward so that it is never in the past | Given FX-CLOCK<br>When I type "Renew domain 5 Jan"<br>Then due_date = 2027-01-05 | 5.4 | P3 | unit |
| TK-27 | line 2 of the row to show only what exists so that rows stay tight | Given one task with only next_action "Send quote" and one with neither waiting_on nor next_action<br>When rows render<br>Then the first shows "Send quote" on line 2 and the second has no line 2 | 4 Task row | P3 | playwright |
| TK-28 | the idle label only after 7 days so that it means something | Given tasks updated 7 days ago and 8 days ago<br>When rows render<br>Then the 7-day task shows no idle label and the 8-day task shows "idle 8 d" | 4 Task row | P3 | unit |
| TK-29 | an edit in the sheet to save and confirm so that I trust it | Given a task sheet open<br>When I change due time to 16:30 and priority to 1 and close it<br>Then the row shows 16:30, the database holds the change, and a toast reads "Saved" | 5.4, DESIGN Copy | P2 | playwright |
| TK-30 | a dropped task to be reopened so that a change of mind is easy | Given a dropped task under Done<br>When I tap Reopen in its sheet<br>Then status = open and the task returns to its date group, no longer struck through | 4 Drop vs Delete | P2 | playwright |

## Reminders

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| RM-01 | active reminders first with next fire and repeat label so that I see what is coming | Given the 2 seeded reminders plus one inactive<br>When I open `/#/reminders`<br>Then active ones list first, each row shows title, next fire time (24 h IST) and repeat label | 5.5, FX-SEED | P1 | playwright |
| RM-02 | next fire for `none` to be remind_at so that a one-off fires once | Given repeat none, remind_at 2026-10-21 12:00 IST, now 10:00<br>When nextFire runs<br>Then 2026-10-21 12:00; with now 12:01 then no next fire | 5.5, 2 Next fire | P1 | unit |
| RM-03 | daily and weekdays to work so that routines repeat | Given time_local 09:00, now Fri 2026-10-23 10:00<br>When nextFire runs for daily and weekdays<br>Then daily = Sat 10-24 09:00, weekdays = Mon 10-26 09:00 | 5.5 | P1 | unit |
| RM-04 | weekly and custom to use repeat_days so that I choose days | Given weekly with remind_at on a Wednesday and no days chosen; custom with {1,3} at 18:00<br>When nextFire runs from Thu 10-22 10:00<br>Then weekly defaults to Wed 10-28 and custom = Mon 10-26 18:00 | 5.5 | P2 | unit |
| RM-05 | monthly to clamp to the last day so that the 31st still fires | Given monthly, remind_at 2026-10-31, time_local 08:00, now 2026-11-01<br>When nextFire runs<br>Then 2026-11-30 08:00, and a Jan 31 anchor gives 28 Feb 2027 | 5.5, 2 Next fire | P2 | unit |
| RM-07 | to be blocked from saving a reminder that never fires so that I do not make a dead one | Given repeat custom with no days, or none with remind_at in the past<br>When I tap Save<br>Then save is blocked and an error shows | 5.5 | P2 | playwright |
| RM-09 | a one-off to switch itself off after firing so that it does not ring twice | Given a one-off reminder that has fired<br>When push-due or the open app handles it<br>Then active = false and last_fired_at is set | 5.5 End | P1 | sql |
| RM-11 | an in-app banner and Notification when a one-off is due with the app open so that I notice | Given permission granted, app open, a one-off at now + 2 min<br>When its time passes<br>Then within 5 s a banner and a Notification show | AC 4, 5.5 Delivery | P1 | playwright |
| RM-12 | a one-off to take a date and time so that it fires once at that moment | Given the reminder sheet with repeat none<br>When I set remind_at 2026-10-22 15:30 and Save<br>Then only the date and time input shows (no time_local), the row reads next fire "Tomorrow 15:30", and 15:30 is stored as IST | 5.5 | P1 | playwright |
| RM-13 | a monthly reminder on the 31st to show its clamped fire so that I trust it | Given repeat monthly, remind_at 2026-10-31, time_local 08:00, now 2026-11-01<br>When I save and view the list<br>Then the row reads next fire "30 Nov 08:00" and the sheet still shows day 31 | 5.5 | P2 | playwright |
| RM-14 | a reminder linked to a done task to still fire so that closing a task does not cancel it | Given reminder R linked to task T with status done, R due now<br>When push-due runs<br>Then R is sent and last_fired_at is set | 5.5 End | P2 | sql |
| RM-15 | to create a reminder so that I can set one in seconds | Given the Reminders screen<br>When I tap New, enter title "Pay Winnr", mode work, repeat none, remind_at 2026-10-24 10:00, Save<br>Then it lists under Active with next fire "Sat 10:00" and one `os_reminders` row exists | 5.5 | P1 | playwright |
| RM-16 | to switch a reminder off so that it stops without deleting | Given an active daily reminder<br>When I untick active and Save<br>Then it moves under the inactive rows and push-due skips it | 5.5 | P2 | playwright |
| RM-17 | next fire never before remind_at so that a future start is respected | Given daily 09:00 with remind_at 2026-10-30 09:00 and now 2026-10-21 10:00<br>When nextFire runs<br>Then 2026-10-30 09:00 | 5.5 Next fire | P2 | unit |
| RM-18 | a repeat reminder to keep its remind_at after firing so that the anchor holds | Given weekly R with remind_at 2026-10-14<br>When it fires twice<br>Then remind_at is still 2026-10-14 and last_fired_at is updated | 5.5 Next fire | P2 | sql |
| RM-19 | a repeat reminder to stay active after firing so that it keeps going | Given daily R that has fired<br>When push-due finishes<br>Then active is still true | 5.5 End | P2 | sql |
| RM-20 | the sheet to show the fields for each repeat type so that I cannot fill the wrong ones | Given the reminder sheet<br>When I pick none, daily, weekdays, weekly, custom, monthly in turn<br>Then none shows remind_at; daily and weekdays show time_local; weekly and custom show time_local and days; monthly shows time_local and the day of remind_at | 5.5 | P2 | playwright |
| RM-21 | in-app only delivery with no subscription so that I still see reminders | Given 0 push subscriptions and app open<br>When a one-off falls due<br>Then a banner shows, no Notification is made, and Settings reads "Notifications off" | 5.5 Delivery | P2 | playwright |
| RM-22 | next fire strictly after now so that it never fires twice | Given daily 09:00 and now exactly 09:00:00<br>When nextFire runs<br>Then tomorrow 09:00 | 2 Next fire | P3 | unit |
| RM-23 | one shared nextFire for the app and push-due so that they never disagree | Given the six repeat types and a month-end case<br>When the app bundle and the push-due bundle each run the same inputs<br>Then the outputs are identical and both import `shared/nextFire.ts` | 2 Next fire, 7 Testing | P2 | unit |
| RM-24 | an optional task link in the sheet so that a reminder points at its task | Given the reminder sheet<br>When I link task T and Save<br>Then the reminder row stores T and the sheet shows T's title | 5.5 | P3 | playwright |

## Habits

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| HB-01 | a 14-day strip with streaks per habit so that I see consistency | Given the 4 seeded habits<br>When I open `/#/habits`<br>Then each row shows name, 14 day cells, current streak and best streak | 5.6, FX-SEED | P1 | playwright |
| HB-02 | strip states done, missed, open and off so that each day reads right | Given a habit on Mon to Fri created 2026-10-14, logs on 10-14, 10-15, 10-19, today Wed 10-21<br>When the strip renders<br>Then 10-14, 10-15, 10-19 done; 10-16 and 10-20 missed; 10-17, 10-18 off; 10-21 open; days before 10-14 not missed | 5.6 | P2 | unit |
| HB-03 | to tap a day to toggle it so that I can fix the past | Given a missed day<br>When I tap it, then tap it again<br>Then a log row (done = true) is created, then deleted | 5.6 | P2 | playwright |
| HB-04 | the streak to go 0 to 1 on toggle without reload so that the app feels live | Given a habit scheduled today with streak 0<br>When I toggle today done<br>Then streak shows 1 with no page reload | AC 8, 5.6 | P1 | playwright |
| HB-05 | an open today not to break the streak so that I keep credit until the day ends | Given logs done on the 3 previous scheduled days and none today<br>When the row renders<br>Then current streak is 3 | 5.6 | P2 | unit |
| HB-06 | to add a habit so that the list is mine | Given 4 seeded habits<br>When I add "Read 20 min" with days Mon to Fri and time 21:00<br>Then a fifth row shows with an empty strip, streak 0, and the highest sort_order | 5.6 | P2 | playwright |
| HB-07 | to edit a habit so that days and time can change | Given habit "Read 20 min" on Mon to Fri at 21:00<br>When I change days to Mon, Wed, Fri and time to 20:00<br>Then the strip marks Tue and Thu as off and the habit is pushed at 20:00 | 5.6 | P2 | playwright |
| HB-08 | to archive a habit so that it leaves my list but keeps its logs | Given a habit with 5 log rows<br>When I archive it<br>Then it is hidden from Habits and Today, and the 5 log rows remain | 5.6 | P2 | playwright |
| HB-09 | to restore an archived habit so that history returns | Given the archived habit<br>When I restore it<br>Then it returns to Habits with its 5 log rows and its streak | 5.6 | P3 | playwright |
| HB-10 | to reorder habits so that the important ones sit first | Given habits A, B, C<br>When I move C above A<br>Then the order is C, A, B and sort_order follows | 5.6 | P3 | playwright |
| HB-11 | best streak beside current so that I see my record | Given scheduled-day logs forming runs of 5 and 3, the 3 ending today<br>When the row renders<br>Then current streak 3 and best streak 5 | 5.6 | P3 | unit |
| HB-12 | off days not to break a streak so that weekends are free | Given a Mon to Fri habit done Thu, Fri, Mon and today Tue open<br>When the row renders<br>Then current streak is 3 | 5.6 | P2 | unit |

## Campaigns

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| CP-01 | the 44 seeded campaigns listed once each so that nothing is missing | Given FX-SEED<br>When I open `/#/campaigns`<br>Then 44 rows show, one per (account, campaign_id), from `os_campaigns_latest` | 5.7, FX-SEED | P1 | sql |
| CP-02 | an active email count and 24 h deltas so that I see movement | Given FX-CAMP with E4 sent 100 at the baseline and 130 now, replies 4 and 6<br>When the header renders<br>Then deltas are +30 sent and +2 replies (summed over active email campaigns) | 5.7 | P2 | unit |
| CP-04 | SMS yesterday numbers per account with a capped flag so that I see texting health | Given FX-SMS<br>When the header renders<br>Then ghl-primary shows 120 sent, 9 replies, 3 positives, 8 STOPs and a "capped" chip; ghl-brightpath shows 40, 2, 1, 0 and no chip | 5.7, 4 SMS days | P2 | playwright |
| CP-05 | full table columns on a laptop so that I can compare | Given width 1024<br>When the table renders<br>Then columns are name, channel, account, status, mismatch chip, sent, replies, positives, bounce %, leads, taken at; a long name is one line with ellipsis | 5.7 | P2 | playwright |
| CP-06 | a short table on a phone so that it fits | Given width 390<br>When the table renders<br>Then only name, status, sent, replies, bounce % show | 5.7 | P2 | playwright |
| CP-07 | rows sorted by status then name so that live work is on top | Given mixed statuses including GHL "published"<br>When the table renders<br>Then order is active/published, paused, draft, completed, other, and inside each group by name | 5.7 | P2 | playwright |
| CP-08 | bounce % computed safely so that a zero never divides | Given sent 150 bounces 9; sent 0; sent null<br>When rows render<br>Then "6.0%", blank, blank | 4 Bounce % | P2 | unit |
| CP-09 | positives from the right source per channel so that the numbers match their tools | Given an email row positives_total 7 and an SMS account row with `os_sms_days.positives` 3<br>When rendered<br>Then email shows 7, SMS shows 3 | 4 Positives | P2 | playwright |
| CP-10 | SMS rows to show status only, with published counted as active so that I see no fake numbers | Given a GHL row status published<br>When rendered<br>Then bounce % is blank, status reads published, and it counts in the active/published sort group | 4 SMS days, 5.7 | P2 | playwright |
| CP-11 | a sparkline for a campaign with two daily points so that I see a trend | Given E4 with snapshots on 10-20 and 10-21<br>When I open its row detail<br>Then SVG sparklines show for sent, replies and positives; a campaign with 1 point shows the total and "no data" | 5.7, AC 6 | P2 | playwright |
| CP-13 | a mismatch chip when the README disagrees so that stale status stands out | Given E3 status paused with `raw.playbook_status = LIVE`, and E1 active with LIVE<br>When the table renders<br>Then E3 shows the mismatch chip and E1 does not | AC 6, 4 Playbook status | P2 | playwright |
| CP-15 | the right external link per channel so that I jump to the tool | Given an Instantly row (id abc) and a GHL row (id wf1, location L1)<br>When detail opens<br>Then links are `https://app.instantly.ai/app/campaign/abc` and `https://app.gohighlevel.com/v2/location/L1/workflow/wf1` | 4 External link | P2 | unit |
| CP-16 | the screen to be read only so that I cannot break a live campaign | Given any row detail<br>When I look for pause, edit, create<br>Then none exist and the "Request change" slot is hidden | 5.7 Read only | P2 | playwright |
| CP-17 | filter chips for channel, account and status so that I narrow the table | Given mixed rows<br>When I select channel email, account instantly, status paused<br>Then only rows matching all three show and clearing a chip widens the list | 5.7 | P2 | playwright |
| CP-18 | no baseline to show a dash so that I am not misled | Given active campaign E5 with no snapshot at or before now minus 24 h<br>When the header renders<br>Then its delta shows "-" | 5.7 | P2 | unit |
| CP-19 | a negative delta to show 0 so that resets do not scare me | Given E4 sent 130 at the baseline and 100 now<br>When the header renders<br>Then the sent delta shows 0 | 5.7 | P2 | unit |
| CP-20 | one sparkline point per IST day (the last snapshot) so that the line is clean | Given E4 with one snapshot on 10-20 (sent 90) and three on 10-21 (sent 100, 110, 130)<br>When the sent sparkline renders<br>Then it has 2 points, 90 and 130 | 5.7 | P2 | unit |
| CP-21 | the sparkline to use the last 14 days so that it stays readable | Given snapshots on 20 consecutive IST days<br>When the sparkline renders<br>Then it has 14 points | 5.7 | P3 | unit |
| CP-22 | row detail totals so that I see the whole picture | Given E1 with sent 150, replies 6, positives 2, bounces 9, opens 80, leads 300<br>When I open its detail<br>Then the six totals show with those values | 5.7 | P2 | playwright |
| CP-23 | the playbook status and folder link in row detail so that I find the why | Given E1 with playbook_status LIVE<br>When I open its detail<br>Then it shows "LIVE" and a link to its folder in `cold-outreach` | 5.7 | P3 | playwright |
| CP-24 | every number to show when it was taken so that I trust it | Given latest taken_at 06:05<br>When the header and table render<br>Then the header reads "as of 06:05" and each row has a taken at value | 2 Collectors, 5.7 | P2 | playwright |

## Feed

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| FD-01 | to see work events and clear them all so that the badge hits zero | Given FX-EVT3 in Work mode<br>When I open `/#/feed` and tap Mark all read<br>Then three rows list newest first and the nav badge goes from 3 to 0 | AC 7, 5.8 | P1 | playwright |
| FD-03 | a tap to mark read and open the link so that I act in one step | Given one event with url and one without<br>When I tap each<br>Then both get read_at set; only the first opens its url | 5.8 | P2 | playwright |
| FD-04 | filters for unread and kind so that I find what matters | Given 6 events across kinds alert and invoice, 2 read<br>When I turn on unread only, then pick kind invoice<br>Then only unread invoice rows list, and the `news` kind is not offered | 5.8 | P2 | playwright |
| FD-05 | Mark all read to follow mode and filter so that I clear only what I see | Given Work and Personal unread events and filter kind alert<br>When I tap Mark all read in Work<br>Then only Work alert events are marked read | 5.8 | P2 | playwright |
| FD-06 | 50 rows then Load more so that the page stays fast | Given 120 events<br>When I open Feed and tap Load more twice<br>Then 50, then 100, then 120 rows show | 2 Performance, 5.8 | P2 | playwright |
| FD-07 | feed rows with dot, kind, title, body, source and time so that each event reads at a glance | Given a warn event of kind alert, title 3 lines long, source ops_heartbeat<br>When the row renders<br>Then an amber dot with the word warn or an icon, chip "alert", the title cut to 2 lines, body cut to 2 lines, source and relative time show | 5.8, DESIGN Tokens | P2 | playwright |
| FD-08 | the Feed to follow the mode so that Personal shows no work events | Given 3 work and 2 personal events<br>When I switch to Personal and open Feed<br>Then 2 rows list | 3, 5.8 | P2 | playwright |
| FD-09 | the nav badge to count unread in this mode so that I know what waits | Given 3 unread work and 2 unread personal events<br>When I switch modes<br>Then the badge reads 3 in Work and 2 in Personal | 5.8 | P2 | playwright |
| FD-10 | a new event to appear without reload so that alerts are live | Given Feed open<br>When an `os_events` row is inserted<br>Then it shows at the top within 5 s and the badge goes up by 1 | 2 Freshness | P2 | playwright |

## Finance

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| FN-01 | Oct 2026 to show the seeded costs, the Skillcamp invoice and profit vs target in colour so that I see the month | Given FX-FIN<br>When I open `/#/finance` on Oct 2026<br>Then costs list Anthropic, Winnr, GoSimless, Google Workspace (total about $226), Skillcamp shows as revenue, profit = revenue minus costs, coloured green at or above $1,000 and red below | AC 15, 5.9 | P1 | playwright |
| FN-03 | amounts in their own currency plus a USD total so that INR and GBP are comparable | Given a revenue of 840 INR with fx 84 and 100 GBP with fx 1.3<br>When the header renders<br>Then rows show 840 INR and 100 GBP; USD total adds 10 and 130 | 5.9, 9 FX | P2 | unit |
| FN-04 | to add a one-time cost so that the month stays true | Given Oct 2026 with costs totalling $226<br>When I add a one-time cost "Domain" $20<br>Then it lists under Costs and the month costs read $246 | 5.9 Costs | P2 | playwright |
| FN-05 | ledger invoices shown as revenue so that I see all income | Given ledger.json with invoice INV-X (month 2026-10, status sent)<br>When I open Oct 2026<br>Then INV-X lists under Revenue with number, client, amount, currency and status sent | 5.9 Revenue | P2 | playwright |
| FN-06 | a 12-month chart with a target line so that I see the trend | Given entries in each month from Nov 2025 to Oct 2026 and profit_target 1000<br>When the chart renders with the picker on Oct 2026<br>Then 12 month groups show (Nov 2025 to Oct 2026), each with a revenue bar and a costs bar, a profit line across the months, and a horizontal target line at 1,000 USD | 5.9 | P2 | playwright |
| FN-07 | to edit a cost so that mistakes are fixable | Given the one-time cost "Domain" $20<br>When I rename it "Domain renewal" and set $22<br>Then the row and month total update | 5.9 Costs | P2 | playwright |
| FN-08 | to end a recurring cost so that it stops after its end month | Given a recurring cost<br>When I set end month 2026-12<br>Then it shows through Dec 2026 and is absent from Jan 2027 | 5.9 Costs | P2 | playwright |
| FN-09 | to delete a cost behind a confirm so that I never lose one by accident | Given the one-time cost<br>When I tap Delete, cancel, then Delete and confirm<br>Then the first keeps it and the second removes the row | 5.9 Costs | P2 | playwright |
| FN-10 | to mark a ledger invoice paid so that revenue status is true | Given INV-X with status sent<br>When I tap Mark paid<br>Then INV-X shows paid | 5.9 Revenue | P2 | playwright |
| FN-11 | to add a manual revenue entry so that non-invoice income counts | Given Oct 2026<br>When I add revenue "Workshop" 500 GBP<br>Then it lists under Revenue and adds 650 to the USD total at 1 GBP = 1.3 USD | 5.9 Revenue | P2 | playwright |
| FN-12 | to edit a manual revenue entry so that typos are fixable | Given the "Workshop" entry<br>When I change the amount to 600 GBP<br>Then the row shows 600 GBP and the USD total shows 780 | 5.9 Revenue | P3 | playwright |
| FN-13 | a month picker defaulting to now so that I can read past months | Given FX-CLOCK<br>When I open Finance, then pick Sep 2026<br>Then Oct 2026 shows first, then the Sep 2026 revenue, costs and profit | 5.9 | P2 | playwright |
| FN-14 | profit against the target in green or red with a word so that colour is not alone | Given costs $226 and revenue $900, then revenue $1,226<br>When the header renders<br>Then profit $674 shows red with "under target"; profit $1,000 shows green with "on target" | 5.9, DESIGN Tokens | P2 | playwright |
| FN-15 | recurring costs to start in their first month so that history is right | Given Instantly $107 from Nov 2026<br>When I view Oct 2026, then Nov 2026<br>Then Oct costs total $226 and Nov costs total $333 | 5.9 Costs | P3 | playwright |
| FN-16 | the USD total to use the FX rate from Settings so that a rate change flows through | Given revenue 840 INR and Settings fx INR 84, then fx INR 80<br>When the header renders each time<br>Then USD total reads 10, then 10.5 | 5.9, 9 Pending | P2 | playwright |

## Notes

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| NT-01 | a floating button on Today and Notes so that I jot anything in seconds | Given Today and Notes open<br>When I tap the button, type title "Idea" and body, and save<br>Then an `os_notes` row exists with area = current mode, pinned false | 5.10 | P1 | playwright |
| NT-02 | pinned notes first, then newest so that key notes stay on top | Given notes N1 (old, pinned), N2 (new), N3 (newer)<br>When Notes renders<br>Then order is N1, N3, N2 | 5.10 | P2 | playwright |
| NT-03 | to edit a note so that it can grow | Given a note "Idea"<br>When I change the body and save<br>Then the row updates and updated_at moves forward | 5.10 | P2 | playwright |
| NT-04 | to turn a note into a task so that ideas become work | Given note "Send quote"<br>When I tap "Make task"<br>Then a task titled "Send quote" exists with the note linked in `notes` | 5.10 | P2 | playwright |
| NT-05 | to search notes so that I find an old one | Given notes with "quote" in one title and another body only<br>When I search "quote"<br>Then both list and a note without it is hidden | 5.10 | P2 | playwright |
| NT-06 | a phone note to reach the laptop and Pin to keep it first so that devices agree | Given a note created on the phone<br>When the laptop refetches within 5 min and I tap Pin<br>Then the note shows on the laptop and sorts first | AC 16, 2 Freshness | P2 | playwright |
| NT-07 | notes to follow the mode so that Personal is separate | Given a work and a personal note<br>When I switch to Personal<br>Then only the personal note shows | 3, 5.10 | P2 | playwright |
| NT-08 | to pin and unpin a note so that key notes stay on top | Given note N2 unpinned and N1 pinned<br>When I pin N2, then unpin it<br>Then N2 sorts right after N1 first, then back to by newest | 5.10, AC 16 | P2 | playwright |
| NT-09 | line breaks and bullets only so that notes stay simple | Given a body "- one\n- two\n<b>x</b>"<br>When the note renders<br>Then two bullets show and "<b>x</b>" shows as plain text | 5.10 | P3 | playwright |
| NT-10 | the floating button only on Today and Notes so that other screens stay clean | Given Tasks and Plan<br>When I look for the floating add button<br>Then it is absent there and present on Today and Notes | 5.10 | P3 | playwright |

## Settings

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| ST-01 | my email and Sign out so that I control my session | Given I am signed in<br>When I open `/#/settings` and tap Sign out<br>Then my email shows on the page before I tap, I land on `/#/signin`, and `/#/` no longer loads data | 5.11 | P2 | playwright |
| ST-02 | a default mode and a fixed timezone so that first visits and times are right | Given os_settings.default_mode = personal and empty localStorage<br>When I first open the app<br>Then Personal mode is active; Timezone shows Asia/Kolkata as read-only | 3, 5.11 | P2 | playwright |
| ST-03 | Enable notifications so that push is under my control | Given permission default<br>When I tap Enable and name the device "Pixel"<br>Then the service worker registers and one `os_push_subscriptions` row has label "Pixel" | 5.11, 2 Push | P1 | playwright |
| ST-05 | balance tiles with value, limit and age so that I see credits | Given balances.consulti value 3,200 limit 10,000 taken_at 5 h ago<br>When Settings renders<br>Then the tile shows 3,200 of 10,000 and its taken_at | 4 Balances, 5.11 | P2 | playwright |
| ST-06 | a tile under 10% of its limit in red so that low credit is loud | Given vendor A value 900 limit 10,000 and vendor C value 1,000 limit 10,000<br>When tiles render<br>Then A is red with a word ("low"); C (exactly 10%) is not red | 4 Balances, 5.11 | P2 | playwright |
| ST-07 | consulti credits fresh within 26 h so that I trust the number | Given the daily collector ran<br>When I open Settings Balances<br>Then the consulti tile taken_at is within 26 h of now | AC 12 | P2 | sql |
| ST-08 | to change my password so that I can rotate it | Given I am signed in<br>When I set a new password and sign out and in<br>Then the new password works and the old one fails | 5.11 | P2 | playwright |
| ST-09 | the last collector run and last heartbeat so that I know jobs run | Given snapshots latest taken_at 06:05 and heartbeat_state.updated_at 07:00<br>When Settings renders<br>Then it shows the app version, last collector run 06:05 and last heartbeat 07:00 | 5.11 | P2 | playwright |
| ST-10 | a "push late" sign so that I notice a dead timer | Given push_last_run 6 minutes ago, then 2 minutes ago<br>When Settings renders<br>Then "push late" shows for the first and not for the second | 5.11, 2 Push | P2 | playwright |
| ST-11 | Export all my data so that I own it | Given rows in every `os_*` table<br>When I tap Export<br>Then a JSON file downloads containing every table's rows | 5.11 | P3 | playwright |
| ST-12 | to set the FX rates in Settings so that finance totals match my rate | Given defaults 1 USD = 84 INR and 1 GBP = 1.3 USD<br>When I change INR to 80 and Save<br>Then `os_settings.fx` holds 80 and Finance uses it | 5.9, 9 Pending | P2 | playwright |
| ST-13 | a Links block so that I reach my tools in one tap | Given Settings<br>When I open the Links block<br>Then four links show: Claude app Code tab (Remote Control), claude.ai/code, the `cold-outreach` repo, root `STATE.md`, each opening in a new tab | 5.11 | P3 | playwright |
| ST-14 | to remove a subscribed device so that a lost phone stops getting push | Given device "Pixel" listed<br>When I tap Remove<br>Then its `os_push_subscriptions` row is deleted and it leaves the list | 5.11 | P2 | playwright |
| ST-15 | "no total" when a vendor has no limit so that unknown stays unknown | Given vendor B value 50 and no limit<br>When the tile renders<br>Then it reads "no total", is not red, and raises no alert | 4 Balances | P2 | playwright |

## Push

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| PU-01 | a push for a one-off with the app closed so that I never miss it | Given the phone app closed, a one-off at now + 3 min<br>When the time passes<br>Then a push arrives within 90 s (recorded in the release note) | AC 5, 2 Push | P1 | manual |
| PU-02 | push-due to send each reminder once so that I get no duplicates | Given a daily 09:00 reminder and push-due runs every minute for 3 min after 09:00<br>When the runs finish<br>Then exactly one send occurred and last_fired_at is set | 2 Push | P1 | sql |
| PU-03 | a habit push at its time, once, skipped when done so that nudges are earned | Given habit H at 20:00 with today's log done and habit G at 20:00 not done<br>When push-due runs at 20:00 and again at 20:01<br>Then G is pushed once (last_pushed_on = today) and H is skipped | 2 Push | P2 | sql |
| PU-04 | one 08:00 IST push listing due tasks so that I start with the list | Given 3 tasks with due_date at or before 2026-10-21<br>When push-due runs at 08:00 IST<br>Then one push lists all 3 and none at 08:01 | 2 Push | P2 | sql |
| PU-05 | a push for an unread bad event once per key per 24 h so that alerts are loud but not spammy | Given unread bad event K (source ops, title "Instantly bounce high", IST date 10-20) pushed at 10-20 23:00, and a new unread bad event with the same source and title on IST date 10-21<br>When push-due runs at 10-21 08:00 (9 h later), then at 10-21 23:30 (24.5 h later)<br>Then no push at 08:00; one push at 23:30 and pushed_at is set on the new event | 4 Alerts, 2 Push | P2 | sql |
| PU-06 | push-due to still mark fires with no subscriptions so that the DB stays correct | Given 0 subscriptions and a due reminder<br>When push-due runs<br>Then last_fired_at is set and no send is attempted | 2 Push | P2 | sql |
| PU-08 | a clear state when I deny notifications so that I know why nothing arrives | Given the browser permission is denied<br>When I open Settings and tap Enable<br>Then no subscription is saved, status reads "Notifications off" with a hint to allow it, and reminders still show in-app | 5.5 Delivery, 5.11 | P2 | playwright |
| PU-09 | a task push at its due_time, once so that I am nudged on time | Given task T due_time 15:00<br>When push-due runs at 15:00 and 15:01<br>Then T is pushed once and pushed_at is set | 2 Push | P2 | sql |
| PU-10 | a dead subscription to be deleted so that the list stays clean | Given a subscription whose endpoint returns 404, and another returning 410<br>When push-due sends<br>Then both rows are deleted | 2 Push | P2 | sql |
| PU-11 | old unread bad events not to push after migration so that day one is quiet | Given 3 unread bad events from before migration 0004<br>When push-due first runs<br>Then pushed_at was backfilled to the migration time and no push is sent | 1 Migration 0004 | P2 | sql |
| PU-12 | push-due to run every minute so that timing is tight | Given the systemd timer enabled<br>When 10 minutes pass<br>Then push_last_run changed at least 9 times and never lags more than 70 s | 2 Push | P2 | manual |
| PU-13 | an already read bad event not to push so that I am not told twice | Given an unread bad event I mark read at 07:55<br>When push-due runs at 08:00<br>Then no push is sent for it | 4 Alerts | P3 | sql |

## Collectors

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| CL-01 | the invoice-behind event once per month so that I am not nagged per run | Given the heartbeat ran 6 times in a month with the invoice still behind<br>When I count events<br>Then one "Invoice behind" event exists for that month | AC 13 | P2 | sql |
| CL-03 | events deduped by source, title and IST date so that a rerun adds nothing | Given an event (ops_heartbeat, "Modal job late", 2026-10-21)<br>When the collector inserts the same key twice that day, then once on 10-22<br>Then 1 row for 10-21 and 1 for 10-22 | 4 Alerts | P2 | sql |
| CL-04 | yesterday's SMS counts per account written once a day so that Today and Campaigns have data | Given the first run after 02:00 IST on 2026-10-21<br>When campaign_pulse runs<br>Then `os_sms_days` has day 2026-10-20 per GHL account with sent, replies, positives, negatives, stops, capped; a second run that day writes no new rows | 4 SMS days | P2 | sql |
| CL-05 | STOP replies counted by a fixed pattern so that the rate is right | Given inbound bodies "STOP", " unsubscribe now", "Please stop texting", "stopwatch"<br>When counted with the pattern for stop, unsubscribe, cancel, end, quit at the start of the body<br>Then the first, second count; "Please stop texting" and "stopwatch" do not | 4 SMS days | P2 | unit |
| CL-06 | a bad event when STOPs pass 5% of 20 or more sends so that a risky list is flagged | Given (sent 120, stops 8), (sent 19, stops 3), (sent 40, stops 2)<br>When the collector checks<br>Then only the first raises a bad event (6.7%); the second is under 20 sent; the third is 5.0%, not above | 4 SMS days | P2 | unit |
| CL-08 | vendor balances written daily so that credits are visible | Given the daily balance step runs once<br>When it finishes<br>Then `balances.<vendor>` holds value, limit and taken_at for numlookup, consulti, MillionVerifier and AnyMailFinder, and a second run the same day adds no extra event | 4 Balances | P2 | sql |
| CL-09 | the invoice ledger read into finance revenue so that the screen stays true | Given ledger.json with the Skillcamp invoice<br>When the collector runs twice<br>Then the Skillcamp entry is in `os_finance_entries` as revenue exactly once | 5.9 | P2 | sql |
| CL-10 | an alert under 10% of the limit so that low credit reaches me | Given MillionVerifier 900 of limit 10,000<br>When the balance step runs<br>Then one `alert` event is raised | 4 Balances | P2 | sql |
| CL-11 | no alert for a vendor with no limit so that unknown credit is quiet | Given AnyMailFinder with no readable limit<br>When the balance step runs<br>Then `limit` is null, the tile reads "no total" and no event is raised | 4 Balances | P2 | sql |
| CL-12 | the playbook status copied into snapshots so that the chip works | Given a campaign README with status LIVE<br>When campaign_pulse runs<br>Then that campaign's snapshot has `raw.playbook_status = LIVE` | 4 Playbook status | P2 | sql |
| CL-13 | the numlookup balance read from headers so that it costs nothing | Given the balance step<br>When it runs<br>Then numlookup value comes from response headers and no validate call is made | 4 Balances | P3 | sql |
| CL-14 | replies classified positive, negative or automated so that the counts are real | Given 5 replies classified 2 positive, 1 negative, 1 automated, 1 neutral<br>When yesterday's row is written<br>Then positives = 2 and negatives = 1 | 4 SMS days | P2 | sql |
| CL-15 | capped set when the walk hits 800 conversations so that partial counts are marked | Given an account with 800 conversations in the window<br>When campaign_pulse runs<br>Then that day's row has capped = true | 4 SMS days | P2 | sql |

## Intake

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| IN-01 | a terminal command to add a task that shows up in the app so that Claude sessions can hand me work | Given Tasks open and `os_task.py add "Reply to Sam" --area work --due 2026-10-25 --ref sam-reply`<br>When up to 5 min pass with no reload<br>Then the task appears with that due date | AC 11, 4 Intake | P1 | playwright |
| IN-02 | the same --ref to leave one row so that reruns are safe | Given the same command run twice<br>When I count rows with source = claude and source_ref = sam-reply<br>Then there is exactly 1 | AC 11, 4 Intake | P2 | sql |
| IN-03 | intake never to touch a done or dropped task so that finished work stays finished | Given the task marked done<br>When the command runs again with a new title<br>Then status, title and completed_at are unchanged | 4 Intake | P2 | sql |
| IN-05 | the one-line rule in CLAUDE.md, the directive and HIERARCHY.md so that sessions use the tool | Given the three files<br>When I grep "a session that leaves an item waiting on the user writes it with os_task.py"<br>Then all three contain it | 4 Intake | P3 | manual |
| IN-06 | every flag stored so that a session hands over full context | Given `os_task.py add "Reply to Sam" --waiting-on "Sam's yes" --next "Send quote" --minutes 10 --cost 12 --ref r1`<br>When I open the task<br>Then waiting_on, next_action, est_minutes 10 and cost_usd 12 are set and the row reads "Sam's yes → Send quote" | 4 Intake | P2 | sql |

## Follow-ups

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| FU-01 | each imported follow-up exactly once, past-due under Overdue so that nothing doubles | Given the Follow-ups tab imported<br>When I open Tasks in Work mode on phone and laptop<br>Then each follow-up (source master_sheet) appears once and past-due ones sit under Overdue | AC 1, 4 Follow-ups | P1 | playwright |
| FU-02 | a new Master sheet row to become a task after the next run so that the sheet feeds the app | Given a new row in the Follow-ups tab with Pipeline key K and a due date<br>When sheet_pulse.py runs<br>Then one task exists with project sales, source master_sheet, source_ref K | AC 14, 4 Follow-ups | P1 | sql |
| FU-03 | changed due dates to update open tasks only so that finished ones stay finished | Given K open and K2 done, both with changed due dates in the sheet<br>When sheet_pulse.py runs<br>Then K's due_date updates and K2 is unchanged | 4 Follow-ups | P2 | sql |
| FU-04 | a Followed up button on follow-ups so that one tap closes the loop | Given a follow-up row<br>When I tap Followed up on 2026-10-21<br>Then status = done, completed_at set, notes contains "2026-10-21", and the button is absent on non-follow-up rows | 4 Follow-ups | P1 | playwright |
| FU-05 | a ticked follow-up never to come back so that the sheet cannot reopen it | Given K is done in the app and still on the sheet<br>When sheet_pulse.py runs again<br>Then K stays done and no second row exists | AC 14, 4 Follow-ups | P1 | sql |
| FU-06 | the sheet never to be written so that my Master sheet is safe | Given a sheet_pulse run<br>When I count write calls to the Sheets API<br>Then there are 0 and the service account has reader access only | 4 Follow-ups | P2 | sql |
| FU-07 | a dropped follow-up to stay dropped so that the sheet cannot revive it | Given K dropped in the app and still due on the sheet<br>When sheet_pulse runs<br>Then K stays dropped | 4 Follow-ups | P2 | sql |
| FU-08 | Followed up to keep my notes so that nothing is lost | Given a follow-up with notes "Called twice"<br>When I tap Followed up on 2026-10-21<br>Then notes holds "Called twice" and the date 2026-10-21 | 4 Follow-ups | P2 | playwright |
| FU-09 | the Followed up button on Today rows too so that I close loops from the morning view | Given a follow-up on Today<br>When I tap Followed up<br>Then it is done and leaves Today | 4 Follow-ups, 5.2 | P2 | playwright |
| FU-10 | one task per source and source_ref so that imports never double | Given a task with source master_sheet and source_ref K<br>When a second insert with the same pair is tried<br>Then the unique index refuses it | 1 Migration 0004 | P2 | sql |

## Offline

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| OF-01 | Today to render from cache offline so that I can look at my day anywhere | Given one successful load, then network off and reload<br>When Today opens<br>Then tasks, reminders, days, habits, logs, up to 50 events and latest campaign rows show with "offline, last synced HH:MM" | AC 9, 2 Offline | P1 | playwright |
| OF-02 | writes disabled offline so that I do not queue edits that vanish | Given offline Today<br>When I try to check a task, toggle a habit and edit the plan line<br>Then the controls are disabled and no request is sent | 2 Offline | P2 | playwright |
| OF-03 | the app to refetch on window focus so that it stays current | Given Tasks open and a task added from another device<br>When the window regains focus<br>Then the task appears without a reload | 2 Freshness | P2 | playwright |
| OF-04 | a failed write to retry once, then revert with a toast so that the screen never lies | Given PostgREST returns 500 for the first two attempts<br>When I check a task<br>Then it shows done at once, one retry happens, then it reverts to open and a toast shows | 4 Writes | P2 | playwright |
| OF-05 | "Could not load." with Retry on a failed read so that errors are recoverable | Given the tasks query returns 500<br>When I open Tasks, then fix the server and tap Retry<br>Then "Could not load." and Retry show, then the list loads | 4 Empty and error text | P2 | playwright |
| OF-06 | a refetch every 5 minutes so that an idle tab stays fresh | Given Tasks open and a task added elsewhere<br>When 5 minutes pass without focus change<br>Then the task appears | 2 Freshness | P2 | playwright |
| OF-07 | a campaign snapshot insert to refetch the view so that numbers are live | Given Campaigns open<br>When a row is inserted into `os_campaign_snapshots`<br>Then `os_campaigns_latest` is refetched and the new numbers show | 2 Freshness | P2 | playwright |

## Security

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| SC-01 | anon to read nothing so that the public key leaks nothing | Given the anon key<br>When I GET each `os_*` table and `os_campaigns_latest`<br>Then every call returns no rows or a permission error | AC 10, 7 Security | P1 | sql |
| SC-02 | RLS on every table for authenticated only so that the policy is real | Given the 12 `os_*` tables (incl. 0004 additions)<br>When I query pg_policies and grants<br>Then each has RLS on and one authenticated policy, and anon has no grants | 7 Security | P1 | sql |
| SC-03 | no service key in the client bundle so that the bundle is safe | Given the built `dist/`<br>When I grep for the service key and the VAPID private key<br>Then neither is present | 7 Security | P2 | manual |
| SC-04 | a tight CSP so that nothing talks to other hosts | Given the served page<br>When I read the CSP header<br>Then `connect-src` lists only the Supabase host | 7 Security | P2 | manual |
| SC-05 | the view to run as the caller so that RLS applies | Given `os_campaigns_latest`<br>When I read its options<br>Then it uses security_invoker and the anon key sees no rows | 7 Security | P2 | sql |
| SC-06 | the site to be noindex so that it is not found | Given the live host<br>When I fetch `/`<br>Then a robots noindex header or meta is present | 2 URL and host | P3 | manual |

## Shell (modes, navigation, theme, copy)

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| SH-01 | bottom tabs and a top mode switch on a phone so that one thumb reaches everything | Given width 390<br>When I open Today<br>Then tabs Today, Tasks, Plan, Notes, More show at the bottom, the mode switch is pinned top, and More lists Reminders, Habits, Campaigns, Finance, Feed, Settings | 6, 3 | P1 | playwright |
| SH-02 | a left rail on a laptop so that I see all items | Given width 1024<br>When I open Today<br>Then a left rail lists all items with the mode switch at its bottom and content is at most 880 px wide | 6 | P1 | playwright |
| SH-03 | Personal and Work modes to filter tasks, reminders, habits and feed so that each mode is clean | Given a work and a personal row in each of tasks, reminders, habits and feed<br>When I switch to Personal<br>Then only the personal rows show in those four lists | 3 | P1 | playwright |
| SH-04 | dark and light themes from the system setting so that the app is readable anywhere | Given prefers-color-scheme dark, then light<br>When I open Today<br>Then each theme applies, text contrast is AA, no unstyled flash | 7 Accessibility | P2 | playwright |
| SH-05 | 44 px touch targets so that taps are easy | Given width 390<br>When I measure every button, tab, checkbox and row on Today<br>Then each is at least 44 by 44 px | 7 Accessibility, DESIGN Layout | P2 | playwright |
| SH-06 | the rail to start at 768 px so that the breakpoint is exact | Given widths 767 and 768<br>When I open Today<br>Then 767 shows bottom tabs and 768 shows the left rail | 6 | P2 | playwright |
| SH-07 | sheets to slide up from the bottom on a phone so that one hand works | Given width 390 and a task<br>When I open its sheet<br>Then it rises from the bottom, is at most 90% tall, and shows a drag handle | DESIGN Layout | P2 | playwright |
| SH-08 | sheets as a 420 px right panel on a laptop so that the list stays visible | Given width 1024 and a task<br>When I open its sheet<br>Then a panel 420 px wide opens on the right and the list stays visible | DESIGN Layout | P2 | playwright |
| SH-09 | a loading state of three grey rows so that waiting looks calm | Given a slow tasks query<br>When Tasks opens<br>Then three grey rows show with no shimmer, then the list | 10 States | P2 | playwright |
| SH-10 | a focus ring so that keyboard use is clear | Given Today at width 1024<br>When I press Tab through the controls<br>Then each focused control shows a 2 px accent ring with a 2 px offset and the order follows the page | 7 Accessibility, DESIGN Layout | P2 | playwright |
| SH-11 | no CDN fonts so that nothing leaks and it loads fast | Given Today loading<br>When I record the network<br>Then Bricolage Grotesque, Hanken Grotesk and JetBrains Mono load from the same origin and no request goes to a font CDN | 7 Privacy, DESIGN Tokens | P2 | playwright |
| SH-12 | my mode to be remembered per device so that each device keeps its habit | Given default_mode work; on the phone I switch to Personal<br>When I reload the phone, then open the laptop<br>Then the phone is Personal and the laptop is Work | 3 | P2 | playwright |
| SH-13 | Campaigns and Finance to leave the nav in Personal so that the mode is clean | Given Personal mode<br>When I open the nav and More<br>Then Campaigns and Finance are absent | 3 | P2 | playwright |
| SH-14 | first paint under 1 s on 4G so that the morning check is fast | Given a 4G throttled phone<br>When I open Today<br>Then first paint is under 1 s | 2 Performance | P2 | manual |
| SH-15 | hash routes to deep link so that bookmarks work | Given a signed-in session<br>When I open `/#/finance`<br>Then Finance loads and reload keeps it | 2 Routing | P2 | playwright |
| SH-16 | plain copy so that it reads fast | Given every UI string in the build<br>When a script scans them<br>Then none holds an em dash or an exclamation mark | 2 Copy | P2 | unit |
| SH-17 | toasts that say what happened so that I know the result | Given a save that works, then one that fails twice<br>When each ends<br>Then toasts read "Saved" and "Could not save. Retry." | DESIGN Copy | P2 | playwright |
| SH-18 | status colours always with a word or icon so that colour is not alone | Given an overdue task, a mismatch chip and a bad event<br>When they render<br>Then each shows a word or icon ("3 d late", "mismatch", a kind chip), not colour alone | DESIGN Tokens | P2 | playwright |
| SH-19 | no motion with reduced-motion so that the app is calm | Given prefers-reduced-motion<br>When I open a sheet and tick a box<br>Then there is no transition; without it the transition is 150 ms | DESIGN Motion | P3 | playwright |
| SH-20 | the site to answer on both hosts so that I can use it today | Given the VPS<br>When I open `https://contoso.example.net` and, after the A record, `https://os.example.com`<br>Then both serve the app over a valid certificate | 2 URL and host | P2 | manual |
| SH-21 | times in 24 h IST so that no zone maths is needed | Given a device in America/Los_Angeles and a reminder at 15:00 IST<br>When it renders<br>Then it reads "15:00" | 2 Time | P2 | playwright |
| SH-22 | a green build on push so that releases are safe | Given a push to main<br>When Actions runs<br>Then `npm run build` passes and Playwright acceptance 2, 3, 4, 7, 8 pass with the pinned clock | 7 Build, 7 Testing | P3 | manual |
| SH-23 | icons from Lucide and no emoji so that the look is steady | Given the built UI<br>When I scan strings and the bundle<br>Then no emoji and no icon font exist | DESIGN Icons | P3 | unit |

## Roadmap placeholders (phase 2)

| ID | As the owner I want ... so that ... | Given / When / Then | PRD ref | Priority | Test type |
|---|---|---|---|---|---|
| RD-01 | suggested follow-ups sent by email or SMS on my tap so that follow-up is quick | Phase 2, not specified for v1 | R1, phase: 2 | P3 | manual |
| RD-02 | a sorted Inbox with summary, attention list and reply drafts so that mail is handled | Phase 2, not specified for v1 | R2, phase: 2 | P3 | manual |
| RD-03 | daily News lines with "so what for us" so that I stay informed | Phase 2, not specified for v1 | R3, phase: 2 | P3 | manual |
| RD-04 | today's calendar blocks and booked calls so that I see meetings | Phase 2, not specified for v1 | R4, phase: 2 | P3 | manual |
| RD-05 | to request campaign pause, resume, edit or create as approvable changes so that I act from the app | Phase 2, not specified for v1 | R5, phase: 2 | P3 | manual |
| RD-06 | a chat box that turns free text into task, reminder, habit log or note so that capture is easy | Phase 2, not specified for v1 | R6, phase: 2 | P3 | manual |
| RD-07 | API-only jobs moved to the cloud with their status in Settings so that the laptop is not needed | Phase 2, not specified for v1 | R7, phase: 2 | P3 | manual |
| RD-08 | YouTube cadence, views and a content task list so that I track the channel | Phase 2, not specified for v1 | R8, phase: 2 | P3 | manual |


## Counts

| Area | Stories |
|---|---|
| Sign in (SI) | 7 |
| Today (TD) | 23 |
| Plan (PL) | 8 |
| Tasks (TK) | 27 |
| Reminders (RM) | 21 |
| Habits (HB) | 12 |
| Campaigns (CP) | 21 |
| Feed (FD) | 9 |
| Finance (FN) | 15 |
| Notes (NT) | 10 |
| Settings (ST) | 14 |
| Push (PU) | 12 |
| Collectors (CL) | 13 |
| Intake (IN) | 5 |
| Follow-ups (FU) | 10 |
| Offline (OF) | 7 |
| Security (SC) | 6 |
| Shell (SH) | 23 |
| Roadmap placeholders (RD) | 8 |
| **Total** | **251** |

| Priority | Stories |
|---|---|
| P1 | 49 |
| P2 | 168 |
| P3 | 34 |
