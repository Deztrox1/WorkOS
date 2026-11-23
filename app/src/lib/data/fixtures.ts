// Sample data in the shape of the seeded database, dated relative to now (IST). Every name and number is invented.
import { addDays, istDate, istToMs } from '../../shared/ist';
import type { Row, TableName } from './types';

export type MockState = Record<TableName, Row[]>;

let n = 0;
const uid = (p: string) => `${p}-${String(++n).padStart(4, '0')}-0000-4000-8000-000000000000`;

export function emptyState(): MockState {
  return {
    os_tasks: [], os_reminders: [], os_days: [], os_habits: [], os_habit_logs: [], os_events: [],
    os_campaign_snapshots: [], os_campaign_daily: [], os_campaign_baseline24: [], os_campaigns_latest: [], os_settings: [], os_notes: [],
    os_finance_entries: [], os_push_subscriptions: [], os_sms_days: [], os_claude_requests: [],
    os_calendar_events: [], os_calendar_state: [],
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

export function baseTask(over: Partial<Row> & { title: string }, nowMs: number): Row {
  return {
    id: uid('t'), notes: null, area: 'work', status: 'open', due_date: null, due_time: null, planned_for: null,
    priority: 2, est_minutes: null, project: null, source: 'user', source_ref: null, waiting_on: null,
    next_action: null, cost_usd: null, sort_order: 0, completed_at: null,
    created_at: iso(nowMs), updated_at: iso(nowMs), pushed_at: null, ...over,
  };
}

// Invented rows in the shape of the real seed. Nothing here is real: this file ships in a public chunk, so it never holds a
// client, a person, an invoice or an amount from the live database (QA r4 R4S01). Absolute dates, as in the database.
// [title, project, waiting_on, next_action, est_minutes, cost_usd, due_date, priority, source_ref, sort_order, notes]
type SeedTask = [string, string | null, string | null, string | null, number | null, number | null, string | null, number, string, number, string];
const SEED_TASKS: SeedTask[] = [
  ["Harbor Lane Bakery 3-month check-in", "sales", "you send the check-in note", "Send the check-in email from the template", 10, null, "2026-10-10", 1, "1", 1, "Waiting since 2026-07-07; 94 days idle (as of 2026-10-09)."],
  ["florists-spring: 6 drafts + 340 shops held", "cold-email", "a go or stop on the plan", "Decide: launch one version now, or park it", 10, null, null, 2, "2", 2, "Waiting since 2026-08-06; 64 days idle (as of 2026-10-09)."],
  ["bookshops_midwest list: 9,120 emails, no campaign", "cold-email", "a check it was not already sent", "Say check it against the sent list, then queue it, or drop it", 2, null, null, 2, "3", 3, "Waiting since 2026-08-06; 64 days idle (as of 2026-10-09)."],
  ["yoga-studios draft + movers draft", "cold-email", "launch or delete; 0 leads loaded", "Say launch or delete; check the leads first", 10, null, null, 2, "4", 4, "Waiting since 2026-08-09; 61 days idle (as of 2026-10-09)."],
  ["New-opening list (180 primary / 520 contacts) + $2.40 test", "cold-email", "a yes on $2.40, then an industry", "Approve or stop the $2.40 test", 5, 2.4, null, 2, "5", 5, "Waiting since 2026-08-18; 52 days idle (as of 2026-10-09)."],
  ["Three-step launch plan (8 open items)", "cold-email", "a go or stop; copy rewrite, 30 inbox limit edits", "Decide go or shelve; if go, name an owner for items 2, 4, 7", 20, null, null, 2, "6", 6, "Waiting since 2026-08-18; 52 days idle (as of 2026-10-09)."],
  ["Partner offer, trade price", "ops", "a price (you write it)", "Write one trade price, or drop the idea", 15, null, null, 2, "7", 7, "Waiting since 2026-08-25; 45 days idle (as of 2026-10-09)."],
  ["Maple Court Hotels follow-up draft", "sales", "you send the draft, or mark it lost", "Open the draft and send, else mark it lost", 5, null, "2026-10-06", 1, "8", 8, "Waiting since 2026-08-31; 39 days idle (as of 2026-10-09)."],
  ["Cedar & Pine: check-in + September invoice", "sales", "you make the invoice; two months not billed", "Make the September invoice, then October", 10, null, "2026-09-01", 1, "9", 9, "Waiting since 2026-09-01; 38 days idle (as of 2026-10-09)."],
  ["Paused August campaigns: Cafes, 2x Trade fair", "cold-email", "resume or stop after the read-out", "Read the 5 reply counts and pick resume or stop", 15, null, null, 2, "10", 10, "Waiting since 2026-09-07; 32 days idle (as of 2026-10-09)."],
  ["Riverstone Plumbing call (~15 Sep)", "sales", "you confirm whether the call happened", "Message Nina, write down what happened", 5, null, "2026-09-15", 1, "11", 11, "Waiting since 2026-09-15; 24 days idle (as of 2026-10-09)."],
  ["Side project: not set up yet", "ops", "you supply the five documents, or park it", "Park it, or drop the five documents in the folder", 5, null, null, 2, "12", 12, "Waiting since 2026-09-15; 24 days idle (as of 2026-10-09)."],
  ["tidewaterbooks.example plan waiting for a yes", "sales", "a go or stop before a proposal", "Say go or drop; the demo already exists", 5, null, null, 2, "13", 13, "Waiting since 2026-09-17; 22 days idle (as of 2026-10-09)."],
  ["Subject line test on a warm list", "ops", "you run a 30 min test", "Run it, or leave it out of the offer", 30, null, null, 2, "14", 14, "Waiting since 2026-09-23; 16 days idle (as of 2026-10-09)."],
  ["Three data sources: what is left to spend (ads ~$12, directory ~$3, pilot ~$2, data $40)", "ops", "picks over the $5 gate", "Tick which of the 4 you want; default none", 5, 57, null, 2, "15", 15, "Waiting since 2026-09-29; 10 days idle (as of 2026-10-09)."],
  ["Email finder test (120 firms, ~10 trial accounts)", "ops", "a yes to open trial accounts", "Say yes or no", 5, 19, null, 2, "16", 16, "Waiting since 2026-09-30; 9 days idle (as of 2026-10-09)."],
  ["Review mining next step: pitch, message timing, pilot, first campaign", "ops", "4 picks + money ($2 to $4 pilot, $20 to $30 list)", "Answer the 4 questions in the brief", 10, 30, null, 2, "17", 17, "Waiting since 2026-10-01; 8 days idle (as of 2026-10-09)."],
  ["Reply sorter returned nothing in the 28 Sep run", "ops", "someone to check the model name", "Agent: check the model name in the reply sorter", 20, null, null, 2, "18", 18, "Waiting since 2026-10-01; 8 days idle (as of 2026-10-09)."],
  ["Bakeries SMS: 840 imported 10-02, 0 sent last week", "cold-email", "you write the message templates", "Finish the SMS message and turn the flow on", 30, null, null, 2, "19", 19, "Waiting since 2026-10-02; 7 days idle (as of 2026-10-09)."],
  ["Change the shared password, then tell the two places", "ops", "you change it, then update both", "Change the password, then update the two places", 10, null, null, 2, "20", 20, "Waiting since 2026-10-05; 4 days idle (as of 2026-10-09)."],
  ["Print shops list 1,210 named people", "cold-email", "you write the copy", "Write email 1, then build the draft", 90, null, null, 2, "21", 21, "Waiting since 2026-10-07; 2 days idle (as of 2026-10-09)."],
  ["Ohio 410 new cafes not yet phone-checked", "cold-email", "a phone check; free tier ~120 left", "Approve the spend or use the free 120", 5, null, null, 2, "22", 22, "Waiting since 2026-10-09; 0 days idle (as of 2026-10-09)."],
  ["Oakline Movers (Tom Becker): call", "sales", "Call Mon 19 / Tue 20 Oct", "Call Mon 19 / Tue 20 Oct (call booked)", null, null, "2026-10-20", 2, "t3-oakline", 111, "Not due yet (from the follow-ups list)."],
  ["Bluebird Yoga (Mira Holt): reconnect gently", "sales", "Reconnect gently", "Reconnect gently (call done)", null, null, "2026-11-02", 3, "t3-bluebird", 109, "Not due yet (from the follow-ups list)."],
];

export function seed(nowMs: number): MockState {
  n = 0;
  const s = emptyState();
  const today = istDate(nowMs);
  const day = (k: number) => addDays(today, k);
  const ago = (days: number) => iso(nowMs - days * 86_400_000);

  SEED_TASKS.forEach(([title, project, waiting, next, min, cost, due, priority, ref, sort, notes], i) => {
    s.os_tasks.push(baseTask({
      title, project, waiting_on: waiting, next_action: next, est_minutes: min, cost_usd: cost, due_date: due, priority, notes,
      source: 'idle_inventory', source_ref: ref, sort_order: sort, created_at: ago(30), updated_at: ago(ref === '11' ? 18 : 1 + (i % 6)),
    }, nowMs));
  });
  // A sample Google Calendar day: fixed blocks around the tasks, one all-day row, one Free row.
  const block = (id: string, title: string, from: string, to: string, over: Row = {}) => s.os_calendar_events.push({
    id, title, starts_at: iso(istToMs(today, from)), ends_at: iso(istToMs(today, to)), all_day_from: null, all_day_to: null, busy: true,
    html_link: `https://www.google.com/calendar/event?eid=${id}`, meet_link: null, task_id: null, ...over,
  });
  block('cal-1', 'Client call: Harbor Lane', '11:30', '12:00', { meet_link: 'https://meet.google.com/abc-defg-hij' });
  block('cal-2', 'Lunch', '13:00', '13:45');
  block('cal-3', 'Gym ready', '16:45', '17:00', { busy: false });
  block('cal-4', 'Gym', '17:00', '18:00');
  block('cal-5', 'Walk', '21:30', '22:00');
  s.os_calendar_state.push({ id: true, linked: true, last_ok_at: iso(nowMs), problem: null, updated_at: iso(nowMs) });
  // Two rows planned for today, so the sample morning shows a plan first.
  for (const i of [17, 18]) s.os_tasks[i].planned_for = today;

  const habits: Array<[string, number[], string | null]> = [
    ['Gym', [1, 2, 3, 4, 5, 6], '14:15'],
    ['Walk', [0, 1, 2, 3, 4], '21:30'],
    ['Guitar practice', [0, 1, 2, 3, 4, 5, 6], '19:00'],
    ['Food log', [0, 1, 2, 3, 4, 5, 6], '13:00'],
  ];
  habits.forEach(([name, days, time], i) => {
    const id = uid('h');
    s.os_habits.push({ id, name, area: 'personal', days, time_local: time, active: true, sort_order: i, created_at: ago(30), last_pushed_on: null });
    if (i < 2) for (let k = 1; k <= 5; k++) {
      const d = day(-k);
      if (days.includes(new Date(d + 'T00:00:00Z').getUTCDay())) s.os_habit_logs.push({ habit_id: id, day: d, done: true, note: null, created_at: ago(k) });
    }
  });

  s.os_reminders.push(
    { id: uid('r'), title: 'Plan tomorrow', notes: null, area: 'personal', remind_at: null, time_local: '21:15', repeat: 'daily', repeat_days: [], active: true, last_fired_at: null, task_id: null, snooze_of: null, created_at: ago(20), updated_at: ago(20) },
    { id: uid('r'), title: 'Morning look', notes: null, area: 'work', remind_at: null, time_local: '08:30', repeat: 'daily', repeat_days: [], active: true, last_fired_at: null, task_id: null, snooze_of: null, created_at: ago(20), updated_at: ago(20) },
  );

  // 44 campaigns: 30 email (instantly) + 8 + 6 sms (ghl)
  const STATUS = ['active', 'active', 'active', 'paused', 'paused', 'draft', 'completed', 'active', 'paused', 'active'];
  let snapId = 0;
  const snap = (over: Row): Row => ({ id: ++snapId, taken_at: iso(nowMs - 2 * 3600_000), opens_total: null, leads_total: null, raw: {}, ...over });
  for (let i = 0; i < 30; i++) {
    const status = STATUS[i % STATUS.length];
    const sent = status === 'draft' ? 0 : 80 + i * 37;
    s.os_campaign_snapshots.push(snap({
      channel: 'email', account: 'instantly', campaign_id: `inst-${i + 1}`, campaign_name: `${['Bakeries', 'Florists', 'Bookshops', 'Yoga studios', 'Movers', 'Printers'][i % 6]} US wave ${Math.floor(i / 6) + 1}`,
      status, sent_total: sent, replies_total: Math.floor(sent / 40), positives_total: Math.floor(sent / 120), bounces_total: Math.floor(sent / (i % 7 === 0 ? 25 : 90)),
      opens_total: Math.floor(sent * 0.5), leads_total: sent * 2,
      raw: { playbook_status: i === 4 ? 'active' : status },
    }));
  }
  for (let i = 0; i < 14; i++) {
    const acct = i < 8 ? 'ghl-primary' : 'ghl-second';
    s.os_campaign_snapshots.push(snap({
      channel: 'sms', account: acct, campaign_id: `ghl-${i + 1}`, campaign_name: `${acct === 'ghl-primary' ? 'Primary' : 'Second'} SMS flow ${i + 1}`,
      status: i % 3 === 0 ? 'draft' : 'published', sent_total: null, replies_total: null, positives_total: null, bounces_total: null,
      raw: { location_id: acct === 'ghl-primary' ? 'LOC-PRIMARY' : 'LOC-SECOND' },
    }));
  }
  // 14 days of history for 3 email campaigns (inst-1, inst-2, inst-8 are active)
  for (const idx of [1, 2, 8]) {
    const base = s.os_campaign_snapshots.find((r) => r.campaign_id === `inst-${idx}`)!;
    for (let d = 14; d >= 1; d--) {
      const f = (14 - d + 1) / 14;
      s.os_campaign_snapshots.push(snap({
        ...base, id: ++snapId, taken_at: iso(nowMs - d * 86_400_000 - 3600_000),
        sent_total: Math.floor((base.sent_total as number) * f), replies_total: Math.floor((base.replies_total as number) * f),
        positives_total: Math.floor((base.positives_total as number) * f), bounces_total: Math.floor((base.bounces_total as number) * f),
      }));
    }
  }
  const sms = (account: string, sent: number, replies: number, positives: number, stops: number, capped: boolean): Row =>
    ({ day: day(-1), account, sent, replies, positives, negatives: 1, stops, capped, created_at: ago(0) });
  s.os_sms_days.push(sms('ghl-primary', 120, 9, 3, 4, false), sms('ghl-second', 40, 2, 1, 0, false));

  const ev = (kind: string, title: string, body: string, severity: string, minAgo: number): Row => ({
    id: uid('e'), kind, title, body, severity, area: 'work', source: 'ops_heartbeat', url: null,
    occurred_at: iso(nowMs - minAgo * 60_000), read_at: null, created_at: iso(nowMs - minAgo * 60_000), pushed_at: iso(nowMs),
  });
  s.os_events.push(
    ev('alert', 'Bounces are high', 'Bakeries US wave 1 is at 4.2% bounce.', 'bad', 30),
    ev('invoice', 'Invoice not sent', 'The Cedar & Pine invoice for this month is not sent.', 'warn', 90),
    ev('system', 'Scheduled jobs are running', 'All jobs ran in the last 24 hours.', 'info', 240),
  );

  const month = istDate(nowMs).slice(0, 7) + '-01';
  const cost = (slug: string, label: string, amount: number, from: string): Row => ({
    id: uid('f'), kind: 'cost', label, amount, currency: 'USD', recurrence: 'monthly', month: from, end_month: null,
    source: 'seed', source_ref: slug, notes: null, created_at: ago(5), updated_at: ago(5),
  });
  s.os_finance_entries.push(
    cost('ai-tools', 'AI tools', 95, '2026-10-01'), cost('sending', 'Email sending', 80, '2026-10-01'),
    cost('inboxes', 'Inboxes', 45, '2026-10-01'), cost('sim', 'SIM plan', 12, '2026-10-01'),
    cost('mail', 'Work mail', 6, '2026-10-01'),
  );
  // Invented invoices, mapped the way finance_pulse.py maps ledger rows: amount and currency as issued, month = issue month,
  // notes = sent when emailed else draft.
  const inv = (no: string, label: string, amount: number, currency: string, issued: string, sent: boolean): Row => ({
    id: uid('f'), kind: 'revenue', label, amount, currency, recurrence: 'one_time', month: `${issued.slice(0, 7)}-01`, end_month: null,
    source: 'ledger', source_ref: no, notes: sent ? 'sent' : 'draft', created_at: ago(5), updated_at: ago(5),
  });
  s.os_finance_entries.push(
    inv('INV-CP-00001', 'Cedar & Pine', 1800, 'GBP', '2026-04-02', true),
    inv('INV-HL-00001', 'Harbor Lane Bakery', 650, 'GBP', '2026-04-09', true),
    inv('INV-CP-00002', 'Cedar & Pine', 400, 'GBP', '2026-05-03', true),
    inv('INV-CP-00003', 'Cedar & Pine', 900, 'GBP', '2026-06-04', true),
    inv('INV-CP-00004', 'Cedar & Pine', 400, 'GBP', '2026-07-01', true),
    inv('INV-CP-00005', 'Cedar & Pine', 400, 'GBP', '2026-08-01', false),
    inv('INV-MC-00001', 'Maple Court Hotels', 60000, 'INR', '2026-10-21', false),
  );
  void month;

  s.os_notes.push(
    { id: uid('n'), title: 'Pricing idea', body: '- three tiers\n- annual discount', area: 'work', pinned: true, created_at: ago(6), updated_at: ago(6) },
    { id: uid('n'), title: 'Gift ideas', body: 'Book\nWatch strap', area: 'personal', pinned: false, created_at: ago(2), updated_at: ago(2) },
  );

  const ask = (t: Row, over: Row): Row => ({
    id: uid('c'), area: 'work', task_id: t.id, title: t.title, brief: `Task: ${t.title}\nNext action: ${t.next_action}`, status: 'sent',
    session_url: 'https://claude.ai/code/session_mock', result: null, error: null, sent_at: iso(nowMs - 40 * 60_000), finished_at: null,
    attempts: 1, seen_at: null, handoff: 'routine', created_by: 'mock-owner', created_at: iso(nowMs - 41 * 60_000), updated_at: iso(nowMs - 40 * 60_000), ...over,
  });
  s.os_claude_requests.push(
    ask(s.os_tasks[8], {}),
    ask(s.os_tasks[7], {
      status: 'done', result: 'The follow-up draft is in Gmail. Read it and send.', sent_at: iso(nowMs - 3 * 3600_000),
      finished_at: iso(nowMs - 25 * 60_000), created_at: iso(nowMs - 3 * 3600_000), updated_at: iso(nowMs - 25 * 60_000),
    }),
  );

  const set = (key: string, value: unknown) => s.os_settings.push({ key, value, updated_at: iso(nowMs) });
  set('default_mode', 'work');
  set('timezone', 'Asia/Kolkata');
  set('profit_target', 1500);
  set('fx', { USD: 1, INR: 1 / 84, GBP: 1.3 });
  set('last_opened_at', iso(istToMs(addDays(today, -1), '22:00')));
  set('heartbeat_state', { updated_at: iso(nowMs - 3 * 3600_000) });
  set('push_last_run', iso(nowMs - 60_000));
  set('balances', {
    consulti: { value: 4100, limit: 10000, taken_at: iso(nowMs - 5 * 3600_000) },
    millionverifier: { value: 6200, limit: 10000, taken_at: iso(nowMs - 5 * 3600_000) },
    numlookup: { value: 9000, limit: 50000, taken_at: iso(nowMs - 5 * 3600_000) },
    anymailfinder: { value: 65, limit: null, taken_at: iso(nowMs - 5 * 3600_000) },
  });
  return s;
}
