import { useState } from "react";

/**
 * Whether the assistant panel is open, remembered for each user in the browser so that the choice
 * survives a reload. Storage that cannot be read or written leaves the panel closed.
 */
export function useChatOpen(userId: string): [boolean, (open: boolean) => void] {
  const key = `leren:assistant-open:${userId}`;

  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  });

  function update(next: boolean) {
    setOpen(next);

    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      return;
    }
  }

  return [open, update];
}
