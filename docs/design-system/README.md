# I'm on Vacation

An AI assistant handles your work email while you're away. This design system covers its web dashboard: a left panel for navigation and chat history, a main area for the overview and work queues, and a chat panel docked on the right.

The look is calm, neutral and professional. Most of the screen is greyscale. One coffee-brown brand colour marks actions and the active state, on warm neutral greys. A light sand colour appears once per screen to say "you're away".

## Principles

1. **The user stays in control.** Nothing goes out without approval in the MVP. Every send action names the outcome ("Approve and send"), and the composer footer says "Draft-only mode · nothing is sent without your approval".
2. **Show the reasoning.** Every AI decision shows its intent, the rule it matched (`R-07`) and the knowledge it used (`KN-0142`) as citation chips. If there was no knowledge, the assistant says so and does not guess.
3. **Quiet by default.** Use colour only for meaning: brand for action, signal colours for status. No gradients, no decorative illustrations, no emoji.
4. **Chat gets the room it needs.** Chats open full width next to the left panel, with a 760px reading column. On dashboard pages a 400px dock is there for quick "why did you do that?" questions. See the Layout section for widths.

## Content fundamentals

- **Voice:** plain, short, first person for the assistant ("I escalated it to Priya"), second person for the user ("You're on vacation until Tuesday, December 2").
- **Sentence case** for everything: buttons, titles, nav items. Only `overline` sidebar headers are uppercase (`CHATS`).
- **Buttons are verbs:** Approve and send, Edit, Reject, Review, Simulate email. Never "OK" or "Submit".
- **Dates:** "Nov 18 – Dec 2" in lists, "Tuesday, December 2" in sentences. Always show the vacation timezone next to the dates.
- **IDs** (rules, knowledge, contacts) are set in `mono`: `R-07`, `KN-0142`, `CT-04`.
- **Status words are fixed:** Reply drafted, Awaiting approval, Sent, Delegated, Escalated, Ignored, No answer found. Don't invent synonyms.
- **Emails are untrusted.** Quote incoming email text in a `bg-subtle` block, visibly separate from what the assistant wrote.

## Visual foundations

**Colour.** `bg-canvas` behind everything, `bg-surface` for cards, the header and the chat panel, `bg-sidebar` for the left panel. Text is `ink`, secondary text `ink-muted`. Both pass 4.5:1 on every background in both themes. `brand` is the one accent: primary buttons, the active nav item (`brand` on `brand-soft`), links, progress and the send button. `sand` is reserved for the vacation banner, the away card and avatars.

**Status colours** each come as a pair. Put the text colour on its `-soft` background:
`success` Sent · `warning` Awaiting approval, low confidence · `danger` Escalated, urgent, Reject · `info` Question, Delegated. A neutral badge (`bg-subtle` + `ink-muted`) is used for Task, Informational and Ignored. Status badges also carry a dot, so they never depend on colour alone.

**Type.** Inter for the UI, JetBrains Mono for IDs. Body text is 14/20. Card titles use `title-sm` (15/22 semibold), the header title uses `title` (17/24) and KPI numbers use `display` (28/36). Use tabular numerals for figures.

**Shape and depth.** Hairline `border` outlines on cards, with `radius-lg` (12px) for cards, chat bubbles and the composer, and `radius-md` (8px) for buttons, inputs and nav items. Pills (`radius-full`) are for badges, chips and counters. Surfaces are flat. `shadow-lg` is used only when the chat panel overlays content.

**Spacing.** 4px base. Main content is padded by `space-6`. Sections are separated by `space-5`. Cards are padded by `space-4`. Stat cards and sidebar groups use `space-3`.

**Focus.** A 2px `focus` ring with a 2px offset on every button, nav item, history item and chip. The composer shows a `brand` border plus a 3px `brand-soft` halo.

## Iconography

Outline icons on a 24px grid with a 1.75 stroke, round caps and joins, drawn at 18px (16px inside badges, chips and stat labels). They inherit `currentColor`. Icons always come with a label, except in the header and chat toolbar, where icon buttons carry an `aria-label` (Expand to full page, Close panel, Attach file, Send).

Nav icon set: home (Overview), check-square (Approvals), inbox (Inbox), book (Knowledge), sliders (Rules), people (Contacts), calendar (Schedule), pulse (Activity log). A four-point sparkle marks the assistant.

**Logo.** A placeholder mark: a `sun` disc over an `on-brand` wave inside a `brand` rounded square, followed by the name in semibold. Replace it with a real logo when one exists.

## Screens the MVP needs

| Nav item | What's on it | Key components |
| --- | --- | --- |
| Overview | Away banner, four KPIs, approval queue, recent activity | VacationBanner, StatCard, ApprovalQueue, ActivityTable |
| Approvals | Full queue; opening an item shows the draft review | ApprovalQueue, DraftReview |
| Inbox | Every processed email with intent and outcome | ActivityTable, Badge |
| Knowledge | Approved and pending items, validity dates, uploaded files | table + extract card |
| Rules | Conditions → action, priority, validity | table + Badge |
| Contacts | Delegates and escalation contacts | table |
| Schedule | Start, end, timezone, mode | form |
| Activity log | Decisions with trace IDs | ActivityTable |

Chats open full width (ChatHome for a new chat, ChatFullPage for a conversation). On dashboard pages they can also be docked on the right. Chat history lives in the left panel under **Chats**, grouped by Today, Yesterday and Previous 7 days.
