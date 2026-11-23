---
version: 1
slug: "src-screens-today-tsx"
primary_target: "src/screens/Today.tsx"
related_targets: ["src/components/Shell.tsx","src/styles.css"]
---

# Surface brief: Today (`/#/`) and the app shell

Scope: Operate. The whole app inherits this world; Today is the first surface. Redesign (replacement world), code-led.
Audience: one owner, 08:30 on a phone, 21:30 on a laptop. Job: know what to do now, in order; in the evening, hand tomorrow to the sheet.
Must stay: product truth in PRODUCT.md, every PRD behaviour (lists, states, rules), 44 px targets, both themes, third-grade copy.
Would feel wrong: cards everywhere, a SaaS KPI header, cobalt on grey, anything that reads as generated.

## Direction contract

THESIS: Today is a shift handover sheet. The product hands the day to the owner the way a night nurse hands a ward to the day nurse: a time spine down the left, a priority word in a fixed column, the ruled rows beneath, a stamp that says when the sheet was drawn. It refuses the category default of a greeting over a stack of same-size sections (To do, Reminders, Habits, Campaigns, Feed).

OWN-WORLD: clinical off-white ruled paper by day (#eef1f1 ground, #f9fbfb sheet, #cfd8d6 rules), a lit viewing box by night (#0f1413 ground, #161c1b sheet). One ink accent, teal (#0f6e66 day, #5ecfc1 night). Three priority words with their own hue and tint: NOW red, TODAY amber, PLAN green; grey for later. One grotesque family for UI (Hanken Grotesk 400/500/600), Bricolage Grotesque 600 only for the date and the stamp, JetBrains Mono for every time and number. Rows ruled by 1 px lines; the time column has its own vertical rule. Controls are 6 px rectangles; the theme switch is a capsule whose chip glides on an exponential ease-out. State on a row is also carried by line form: a dashed left rule for "sent to Claude, waiting", a half-tone row for stale. The stamp is a drawn SVG seal.

STORY: the owner opens the sheet and sees the date, a one-line situation, then the rows ranked NOW, TODAY, PLAN. Each row names the next action. He ticks, moves to tomorrow, or hands a row to Claude with one tap. After 18:00 the sheet turns to tomorrow: a plan line, the picked rows, a review line and a mood. He trusts the order because the sheet drew it.

FIRST VIEWPORT (phone 390): top bar with mode segmented control and the theme capsule; the date in Bricolage at 30 px with the greeting beneath at 13 px; the stamp at the right ("MORNING SHEET · 08:30"); the situation line as a ruled input; one summary line in mono ("2 now · 4 today · 3 reminders"); then the ruled rows begin, NOW first. Desktop (1280): rail left, the sheet column at 760 px, the stamp larger, the evening block beside the day block from 18:00.

FORM: candidate 7 of 7 on the ordered grounded list (call sheet, cricket scorecard, broadsheet markets page, pilot kneeboard, departures board, practice notebook, shift handover sheet). Seed key 490affa9, assigned index 7. Raises: from the emission-line rail (competitive), state by line form, not hue alone; from the design annual (declined), one drawn human mark, the stamp; from the timetable rack (declined), one body size in rows, rank by weight and case; from the zoo map (declined), the capsule control with a travelling chip.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
