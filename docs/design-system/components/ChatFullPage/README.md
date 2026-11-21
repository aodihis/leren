# ChatFullPage

The default chat view: the left panel stays, and the conversation fills the rest of the screen.

- Use `.v-shell` with `.v-sidebar` and `.v-chatpage`. Messages (`.v-chatpage__col`) and the composer share one column, centred at `chat-reading` (760px), with at least `space-6` padding on the sides.
- Messages are larger here: 15/24. User bubbles go up to 70% of the column; assistant text and cards use the whole column.
- The header shows the chat title, a Draft-only badge, "Show dashboard beside chat" (switches to the dashboard with this chat docked) and More.
- Assistant answers can include compact lists (`.v-mini`) with a Review action on each row, and always end with citation chips for the rules, knowledge or pages they used.
