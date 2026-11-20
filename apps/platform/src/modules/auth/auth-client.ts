import { emailOTPClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * The Better Auth client. Requests go to the same origin and reach the API through the
 * development proxy in `vite.config.ts` or through the production reverse proxy under `/api`.
 * The additional user fields mirror the ones declared by the API's Better Auth configuration.
 */
export const authClient = createAuthClient({
  plugins: [
    emailOTPClient(),
    inferAdditionalFields({
      user: {
        firstName: { type: "string", required: false },
        lastName: { type: "string", required: false },
      },
    }),
  ],
});
