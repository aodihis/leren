# Sidebar

The left panel: brand, away status, New chat, navigation, chat history and account.

- The nav is fixed and the history list (`.v-history`) scrolls. The account row is pinned to the bottom.
- Mark the current page with `aria-current="page"` (`brand` on `brand-soft`) and the open chat with `aria-current="true"`.
- Counters: `.v-count--brand` for items that need action (Approvals), neutral for the rest.
- Group history by Today, Yesterday and Previous 7 days. Titles are one line, truncated with an ellipsis.
- Rail variant: add `.v-sidebar--rail`. Labels, the away card and history hide, and counters move to the icon corner.
