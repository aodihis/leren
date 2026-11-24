import type { Auth } from "@leren/api/client";
import { emailOTPClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** The Better Auth client. */
export const authClient = createAuthClient({
  plugins: [emailOTPClient(), inferAdditionalFields<Auth>()],
});
