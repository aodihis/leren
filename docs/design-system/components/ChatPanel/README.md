# ChatPanel

The assistant docked at 400px on the right of dashboard pages, for quick questions while looking at the data. Full width (ChatFullPage) is the default chat view.

- Header: the chat title (truncated), then New chat, Expand to full page and Close.
- User messages are right-aligned `bg-subtle` bubbles. Assistant messages carry the sparkle avatar and no bubble.
- Back every claim with citation chips (`.v-cite`): rule, knowledge or contact IDs in mono.
- Knowledge the user types is shown as a `.v-extract` draft with Approve and Edit. It is never saved silently.
- The footer always states the operating mode. Expand switches to ChatFullPage.
