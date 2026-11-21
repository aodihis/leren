# Layout

The app has two layouts that share the same left panel:

- **Full-width chat (default for chat):** sidebar · chat. The chat fills everything to the right of the sidebar, and messages and the composer share one column centred at 760px.
- **Dashboard pages:** sidebar · main, with an optional 400px chat dock on the right for quick questions while you look at the data.

## Column widths

| Column | Width | Token |
| --- | --- | --- |
| Sidebar, expanded | 264px | `sidebar-width` |
| Sidebar, rail (icons only) | 72px | `sidebar-rail` |
| Main | fluid, never below 640px | `content-min` |
| Main content max | 1120px, centred | `content-max` |
| Chat panel | 400px default, user-resizable 360–520px | `chat-width`, `chat-min`, `chat-max` |
| Full-width chat: message and composer column | 760px max, centred | `chat-reading` |
| Full-width chat: side padding | 24px minimum | `space-6` |
| Header and chat header | 56px tall | `header-height` |

**Why 760px for the full-width message column:** a 15px line at that width holds about 85–90 characters, roughly the limit for comfortable reading. Wider and the eye loses its place, so the extra room becomes whitespace on both sides. Cards inside messages, like knowledge drafts and approval lists, use the full 760px.

**Why 400px for the dock:** it fits a 60–70 character line at 14px with padding, holds a knowledge-draft card with two buttons side by side, and still leaves 776px for the dashboard on a 1440px screen. That's enough for four KPI cards in one row.

## Breakpoints

**Full-width chat**

| Window | Sidebar | Chat |
| --- | --- | --- |
| ≥ 1024px | 264px expanded | fills the rest; column centred at 760px |
| 768–1023px | 72px rail | fills the rest; column shrinks to fit with 24px padding |
| < 768px | hidden behind a menu button | full screen |

**Dashboard pages with the dock open**

| Window | Sidebar | Main | Chat |
| --- | --- | --- | --- |
| ≥ 1440px | 264px expanded | fluid | 400px docked |
| 1280–1439px | 72px rail while chat is open; 264px when chat is closed | fluid | 400px docked |
| 1024–1279px | 264px expanded | fluid | 400px **overlay** on the right, `shadow-lg`, closes with Esc |
| < 1024px | hidden behind a menu button | full width | full-screen sheet |

Rule of thumb: when space runs out, **collapse the sidebar first, then overlay the chat**. Never squeeze main below 640px.

CSS classes: `.v-shell` with `.v-chatpage` for full-width chat. On dashboard pages use `.v-shell` (sidebar + main), and add `.v-shell--chat` for the docked chat, `.v-shell--rail` with `.v-sidebar--rail` for the rail, and `.v-shell--overlay` for the overlay chat.

## Chat and history

- **Chat history lives in the left panel** under the CHATS header, below the navigation. The nav stays fixed and the history list scrolls on its own. The account row is pinned to the bottom.
- Clicking a history item or **New chat** opens the chat **full width**. No nav item is highlighted then; the open chat is shown in bold on `bg-subtle`.
- A new chat opens on the welcome screen: a greeting with a one-line summary of the night, four starter cards, and the composer at the bottom.
- In the full-width chat header, the panel icon ("Show dashboard beside chat") switches back to the dashboard with this chat docked on the right. In the dock, **Expand** returns it to full width.
- On dashboard pages, the header's panel-toggle button opens and closes the dock. Remember the choice per user.
- In rail mode the history is hidden. Clicking the chat icon expands the sidebar as a temporary overlay to show it.

## Vertical rhythm

The header and chat header share `header-height`, so their bottom borders form one line across the screen. Inside main: banner → KPI row → queue → activity, `space-5` apart, scrolling inside `.v-content`. The sidebar, main and chat each scroll independently. The page itself never scrolls.
