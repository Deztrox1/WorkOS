---
name: WorkOS
description: A shift handover sheet. The app tells the owner what to do today, in order, on one ruled sheet.
colors:
  ground: "#e9eded"
  paper: "#fbfcfc"
  paper-2: "#f1f4f4"
  ink: "#17211f"
  ink-2: "#46524f"
  mute: "#5c6866"
  rule: "#cfd8d6"
  rule-soft: "#e1e7e6"
  rule-input: "#84918e"
  sea-glass: "#0f6e66"
  sea-glass-soft: "#d9ebe8"
  sea-glass-deep: "#0c5e57"
  now-red: "#ad2f27"
  now-tint: "#f6e3e0"
  today-amber: "#845305"
  today-tint: "#f5ead3"
  plan-green: "#1b6b3e"
  plan-tint: "#dfefe4"
  night-ground: "#0f1413"
  night-paper: "#161c1b"
  night-paper-2: "#1b2221"
  night-ink: "#e6ecea"
  night-ink-2: "#a9b5b2"
  night-mute: "#7f8b88"
  night-rule: "#2a3533"
  night-rule-soft: "#202b29"
  night-rule-input: "#5e6c69"
  night-sea-glass: "#7fbdb3"
  night-sea-glass-soft: "#1a2f2c"
  night-key: "#1f3532"
  night-now-red: "#f0756b"
  night-now-tint: "#2a1c1b"
  night-today-amber: "#e2a93f"
  night-today-tint: "#2b2416"
  night-plan-green: "#58c98a"
  night-plan-tint: "#163a28"
  badge-red: "#c94a40"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.015em"
  now-title:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.3
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0.1em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.1
rounded:
  chip-tag: "4px"
  control: "6px"
  segment: "8px"
  sheet: "8px"
  pill: "10px"
  capsule: "16px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "20px"
  band-phone: "6px"
  band-desk: "6px"
  spine-phone: "52px"
  spine-desk: "60px"
  rail: "232px"
  sheet-w: "760px"
  target: "44px"
components:
  button-primary:
    backgroundColor: "{colors.sea-glass}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.sea-glass-deep}"
  button-primary-night:
    backgroundColor: "{colors.night-key}"
    textColor: "{colors.night-sea-glass}"
    rounded: "{rounded.control}"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.sea-glass}"
    rounded: "{rounded.control}"
    height: "44px"
  button-default:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  input-ruled:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "8px 0"
    height: "44px"
  segment-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
    height: "44px"
  chip:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "0 8px"
  band-now:
    backgroundColor: "{colors.now-tint}"
    textColor: "{colors.now-red}"
    width: "6px"
  band-today:
    backgroundColor: "{colors.today-tint}"
    textColor: "{colors.today-amber}"
    width: "6px"
  sheet-paper:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sheet}"
    padding: "20px"
    width: "760px"
---

# Design System: WorkOS

## Overview

**Creative North Star: "The Handover Sheet"**

The owner opens the app the way a day nurse takes a ward from the night shift: one ruled sheet that says what to do now and what comes after. One line is marked: Now, a highlighted band edge to edge on the sheet. A time spine runs down the left in mono, ruled rows follow in order, and a drawn stamp names the shift (Morning, Day, Evening, Night). Everything else in the app (Plan, Tasks, Campaigns, Finance, Claude, Settings) sits on the same paper, under the same rules.

Density is calm and ledger-like. There are no cards stacked on a grey page, no KPI header, no greeting over a heap of equal sections. Rank comes from position, weight, case and a tinted rule, never from size jumps or decoration. Day is clinical off-white paper over a pale grey-green ground. Night is a lit viewing box: near-black green ground, a slightly lighter sheet. One accent, sea-glass teal, carries action and "now".

The story is two sentences the sheet can say. Morning opens on Now, the first thing to do. Night closes on "Tomorrow is set. It starts with ...". The design exists so those two lines can be trusted.

**Key Characteristics:**
- One ruled sheet per screen, capped at 760 px on a laptop, full bleed on a 390 px phone.
- Time and numbers are always JetBrains Mono. Titles are Hanken Grotesk. Bricolage is only for the date, the Now title, the stamp and the evening heading.
- State is carried by line form as well as colour: a dashed left rule means "with Claude, waiting"; a half-tone row means stale; a strike means done.
- Light and dark are equal citizens, switched by a capsule toggle, with "system" kept in Settings.

## Colors

A cool, desaturated paper palette with one teal accent and three priority hues that appear only as words and tints on bands.

### Primary
- **Sea-glass teal** (#0f6e66 day, #7fbdb3 night): the one accent, and the colour of Now. Links, the filled primary button (day), checked ticks, focus rings, the NOW and NEXT words, the dashed rule for rows with Claude. Hover fill #0c5e57 day.
- **Sea-glass wash** (#d9ebe8 day, #1a2f2c night): the Now band, selected rail item, ghost-button hover, the WITH CLAUDE band, pressed chips.

### Secondary (priority bands, a closed set of three plus grey)
- **Needs-a-look red** (#ad2f27 day, #f0756b night, tint #f6e3e0 / #2a1c1b): things that need a look, error text, the unread badge. Never Now, and never a past date: older groups read "Earlier" in plain ink.
- **Today amber** (#845305 day, #e2a93f night, tint #f5ead3 / #2b2416): the TODAY band, warnings, queued status.
- **Plan green** (#1b6b3e day, #58c98a night, tint #dfefe4 / #163a28): the plan band, good status.
- Reminder, habit, pulse, older: grey tint (#f1f4f4 / #1b2221) with muted ink.

### Neutral
- **Ground** (#e9eded day, #0f1413 night): the page behind the sheet.
- **Paper** (#fbfcfc day, #161c1b night): the sheet, rail, tab bar, inputs. **Paper-2** (#f1f4f4 / #1b2221): segment trough, chips, quiet bands.
- **Ink** (#17211f / #e6ecea), **ink-2** (#46524f / #a9b5b2), **mute** (#5c6866 / #7f8b88): primary, secondary, tertiary text.
- **Rule** (#cfd8d6 / #2a3533) for structural lines, **rule-soft** (#e1e7e6 / #202b29) between rows, **rule-input** (#84918e / #5e6c69) only for the underline of ruled inputs (3:1 against paper).

### Named Rules
**The Three-Words Rule.** Teal is Now. Red, amber and green mean NEEDS A LOOK, TODAY and PLAN and nothing else. They never decorate a chart, an icon or a button.

**The One Ink Rule.** Teal is the only accent. If a second accent hue is wanted, the answer is weight, case or a rule, not a colour.

**The Night Key Rule.** At night the primary button is not a bright slab: it is a dark teal key (#1f3532) with a teal outline and teal ink, and the selected segment is the teal wash with an inset teal ring. The one exception is inside Now: on the wash a dark key disappears, so Done is a filled teal key with dark ink (8.7:1), and it outranks Not now.

## Typography

**Display Font:** Bricolage Grotesque 600 (fallback Hanken Grotesk, system-ui)
**Body Font:** Hanken Grotesk 400/500/600 (fallback system-ui, Segoe UI)
**Mono Font:** JetBrains Mono 400/500 (fallback ui-monospace, SF Mono, Menlo)

**Character:** a plain grotesque for reading and a mono for everything that is a time, a count or an amount, so columns line up. Bricolage appears only where the sheet speaks in its own voice. All three load from `@fontsource` packages bundled in `main.tsx`; there is no CDN. `tnum` is on for the whole body. `font-synthesis-weight: none`: only loaded weights show (Hanken 400/500/600, JetBrains 400/500), so nothing is ever faux bold.

### Hierarchy
- **Display** (Bricolage 600, 22px phone / 26px laptop on the war room, 30px / 38px on Plan, line-height 1, -0.015em): the date.
- **Now title** (Bricolage 600, 28px phone / 34px laptop, 22px under 360 px, line-height 1.12, at most 4 lines): the thing to do. The eye lands here first, so it outranks the date.
- **Headline** (Hanken 600, 26px phone / 30px laptop, line-height 1.1, -0.02em): page titles on other screens.
- **Title** (Hanken 500, 15px, line-height 1.3): the row title. One body size in rows; rank is by weight and case, not size.
- **Body** (Hanken 400, 15px, 1.4): general text. Inputs are 16px on a phone (no iOS zoom) and 15px on a laptop. Greeting 14px, max 62ch.
- **Label** (Hanken 600, 13px, 0.1em, uppercase): the section rule heading on a sheet (TODAY, REMINDERS). Smaller secondary text is 13px, hints 13px, field labels 12px 600.
- **Mono** (JetBrains 500, 12.5px spine, 12 to 13px counts and tallies, 21px ledger figures): time spine, due dates, tally line, status words, band words (11px, 0.06em, uppercase).
- **Evening heading** (Bricolage 600, 22px) and **closing line** (Bricolage, 17px): the evening sheet's own voice.

### Named Rules
**The Mono Numbers Rule.** Any time, date, count, price or duration is JetBrains Mono. Prose around it stays Hanken.

**The Fixed Size Rule.** Row text does not change size to show importance. Weight 500 for titles, 400 for notes, and position and rules do the ranking. The Now title is the one exception: it is not a row, it is the sheet speaking.

## Layout

A fixed pattern of one column of paper. On a laptop (768 px and up) a 232 px rail sits left, the content is capped at 920 px and the sheet at `--sheet-w` 760 px, centred. From 1180 px the war room widens to 1120 px with a 300 px day panel beside the sheet: fixed blocks and Now only, in lanes when they overlap, with the now line in view. From 1200 px Plan widens to 1280 px with the day block beside a 360 px evening column. On a phone (under 768 px) there is a sticky top bar (brand, add, theme capsule), the sheet runs full bleed with 14 px sides, and a four-tab bar sits at the bottom. A task sheet beside the page never crushes the paper: the day panel steps aside, and under 1180 px the sheet floats over the page with a backdrop.

The war room row is a four-column grid: time 52 px with a 1 px right rule, tick 44 px, content, side actions. A tilde hangs left of an estimate so digits line up, and estimates show to the next 5 minutes. Rows are at least 54 px. An ink rule sits under Next (not when Next is the last row), and the folds start under one ink rule (gone when there are no folds), so the sheet reads in three parts: Now, Next, the rest. The Plan row is band, spine, content, side: the band is a 6 px tinted rule at every width (its word is for a screen reader), the spine 52 px on a phone and 60 px on a laptop, and a row with nothing for the spine drops the column. Spacing is a loose 4 / 8 / 12 / 16 / 20 px rhythm; sections start 18 px apart.

Every touch target is at least 44 px (buttons, icon buttons, inputs, selects, chips, ticks, tabs, rail items), including text links that carry `.tap`. The first viewport on a 390 px phone is: top bar, date with the one-line count and the stamp, any calendar or needs-a-look line, Now, Next, then three rows. The rest of the day folds into one line.

## Elevation & Depth

Flat by default. Depth is a 1 px line and a change of paper, never a shadow. The one shadow (`0 8px 24px -12px rgba(23,33,31,.35)` day, `rgba(0,0,0,.7)` night) belongs to floating sheets: the Add and Ask Claude panels on a laptop, which also slide up over 180 ms. The sheet itself is separated from the ground by a 1 px rule and an 8 px radius on a laptop, and by a bottom rule only on a phone.

### Named Rules
**The Rule Not Shadow Rule.** Structure is drawn with 1 px lines (ink for section heads and the top of a ledger, rule for dividers, rule-soft between rows). A shadow is only for something that floats above the sheet.

## Shapes

Controls are 6 px rectangles: buttons, inputs, chips, icon buttons, rail items. The segment trough and the laptop sheet and tomorrow panel are 8 px. Tags are 4 px, badges 10 px, and the theme switch is the only capsule (64 by 32, 16 px radius) with a 24 px chip that glides 32 px on `cubic-bezier(.22,1,.36,1)` over 0.4 s. Ticks are 22 px squares with 5 px radius. Inputs on Today, Tomorrow and Settings are not boxes: they are written on a line (see Components).

## Components

### Buttons
- **Shape:** 6 px rectangle, 44 px tall, 16 px side padding, 1 px border.
- **Primary:** teal fill (#0f6e66), white ink, weight 600; hover #0c5e57. At night the dark teal key described above.
- **Default:** paper fill, rule border, border darkens to ink-2 on hover.
- **Ghost:** transparent, teal ink 600, teal wash on hover. **Danger:** red ink only.
- **Icon button:** 44 by 44, 6 px radius, hover paper-2. The "Ask Claude" glyph is mute until the row is hovered or focused.

### Ruled inputs
- **Style:** transparent, no box, a 1 px bottom border in `--rule-in`. Used for the situation line, plan line, review lines and Settings fields. Review is a 28 px ruled-lined textarea. Boxed inputs (1 px rule, 6 px radius, paper fill) are for sheets and forms.
- **Focus:** the underline turns teal and thickens to 2 px; boxed inputs get a 2 px teal outline. Placeholders are mute; plan and review placeholders are italic.

### The ruled row (signature)
- On the war room: time, rule, tick, title. On Plan: band, spine, content, side. The time spine shows a time, a due date or an estimate, mute when past or estimated.
- **Now:** not a row and not a card. A wash band, square, edge to edge on the paper, 2 px ink rule above and 1 px below. On a laptop NOW sits in the spine column and the title starts on the row title column, so every title shares one left edge. The text swaps in 180 ms at a held height, and the buttons stay put.
- **Next:** the word sits above the time in the spine, weight 600 on the title, ink rule below.
- **With Claude:** a 2 px dashed teal left rule. **Stale:** secondary ink. **Done:** strike and mute.
- **Tick:** a 22 px square in a 44 px target. Ticking holds the strike for 600 ms, then the row fades and folds over 200 ms and cannot be tapped, so the next row never slides under a thumb; with reduced motion it just stays, no animation. Done on Now holds for 600 ms, so a double tap closes one task.

### Stamp
A drawn SVG seal, 118 px wide on phone and 136 px on laptop, teal, tilted about -2.6 degrees in the path, with a double uneven rule, dry-ink breaks cut by a mask, and the shift name set in Bricolage on two lines (MORNING SHIFT; on Plan, PLAN TOMORROW or CLOSE TODAY). It carries no clock, and it leaves the screen under 360 px.

### Navigation
The nav does not follow the mode. Phone: 58 px tab bar with four tabs (Today, Plan, Tasks, More), 11 px labels, the current tab teal 600 with a 2 px teal rule at its top; a red mono badge for counts and a teal dot for a waiting Claude result. No Refresh on a phone: the app refetches on focus and every 5 minutes. Laptop: a 232 px paper rail, always every item in its group, items 44 px, current item on the teal wash, group labels in 11 px caps, an Add button outlined in teal at the top. Opening Campaigns or Finance sets the mode to Work, opening Habits sets Personal.

### Ledger line
One ruled row of totals: ink rule above, rule below, cells split by hairlines, mono 21px values (17px on phone) over 11px caps labels. Never cards.

### Mode and theme controls
The mode switch is a 44 px segmented control, selected segment ink-filled by day and teal wash at night. It sits at the top of the four screens it filters (Tasks, Reminders, Notes, Activity) and nowhere else. The theme capsule is described in Shapes.

## Do's and Don'ts

### Do:
- **Do** put the answer first: Now is the thing to do, and the first thing the eye lands on.
- **Do** rank by band, weight and case on one text size.
- **Do** keep every target at 44 px and every time, count or amount in mono.
- **Do** use line form (dashed, half-tone, strike) as well as colour for state.
- **Do** write in plain third-grade words. Copy rules: no em dashes, no exclamation marks, no guilt words ("overdue" pressure, "missed", "behind", "failed you"), no developer words ("sync", "payload", "query", "error code").
- **Do** build both themes together and keep the toggle on every screen.

### Don't:
- **Don't** stack equal cards on a grey page or open with a KPI header.
- **Don't** use red, amber or green for anything but NEEDS A LOOK, TODAY, PLAN and their status meanings.
- **Don't** add a second accent hue or a gradient.
- **Don't** put a shadow on something that sits on the sheet.
- **Don't** nag: no escalating colours, no auto-dropping, no streak shame.
- **Don't** return to the old cobalt-on-grey system; it was rejected as generic.

## Divergences recorded

- The direction contract names the night accent #5ecfc1 and ground #eef1f1; the build uses #7fbdb3 and #e9eded. The build is recorded.
- The band is a 6 px rule with no word at every width; the contract's word column is gone, and the war room has no band at all: TODAY and DUE mean nothing in a time order.
