import { createVerificationCodeEmail } from "@leren/email";
import type { EmailSender } from "@leren/email";
import { accounts, sessions, users, verifications } from "@leren/db";
import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";

import type { UpdateProfileInput } from "./schema";

const CODE_LENGTH = 6;
const CODE_LIFETIME_SECONDS = 10 * 60;
const CODE_MAX_ATTEMPTS = 3;

export type CreateAuthOptions = {
  db: Db;
  emailSender: EmailSender;
  logger: Logger;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
};

/**
 * Joins a first and last name into the display name Better Auth stores in `name`. Missing parts
 * are skipped, so a user with only a first name gets that name.
 */
export function formatDisplayName(firstName?: string | null, lastName?: string | null): string {
  return [firstName ?? "", lastName ?? ""].flatMap((part) => part.trim() || []).join(" ");
}

function textOrFallback(value: unknown, fallback: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return typeof fallback === "string" ? fallback : "";
}

/**
 * Creates the Better Auth instance. Users register and sign in the same way: they enter an email
 * address, receive a one-time code and submit it. An unknown address becomes a new user when its
 * code is verified. There are no passwords.
 *
 * The code email is sent without awaiting delivery, so the response time does not reveal whether
 * an address is deliverable. A delivery failure is logged, and the API checks the email transport
 * at startup so a misconfigured SMTP server is reported before a user waits for a code.
 *
 * A partial profile update keeps the stored half of the display name.
 */
export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    appName: "Leren",
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    advanced: { database: { generateId: "uuid" } },
    user: {
      additionalFields: {
        firstName: { type: "string", required: false, input: true },
        lastName: { type: "string", required: false, input: true },
        replyInstruction: { type: "string", required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        update: {
          before: async (data, context) => {
            const { firstName, lastName } = data;

            if (firstName === undefined && lastName === undefined) {
              return { data };
            }

            const current = context?.context.session?.user;

            return {
              data: {
                ...data,
                name: formatDisplayName(
                  textOrFallback(firstName, current?.firstName),
                  textOrFallback(lastName, current?.lastName),
                ),
              },
            };
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: CODE_LENGTH,
        expiresIn: CODE_LIFETIME_SECONDS,
        allowedAttempts: CODE_MAX_ATTEMPTS,
        sendVerificationOTP: async ({ email, otp }) => {
          options.emailSender.send(createVerificationCodeEmail(email, otp)).catch((error) => {
            options.logger.error("Could not send the sign-in code", { error });
          });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const profileColumns = {
  id: users.id,
  email: users.email,
  firstName: users.firstName,
  lastName: users.lastName,
  replyInstruction: users.replyInstruction,
};

/**
 * Returns the public profile of a user, or `null` when the user does not exist. The query is
 * scoped to `userId`, so a caller can only read the profile it was authenticated as.
 */
export async function getProfile(db: Db, userId: string) {
  const [profile] = await db.select(profileColumns).from(users).where(eq(users.id, userId));

  return profile ?? null;
}

/**
 * Saves a user's first and last name and derives the display name from them. The default reply
 * instruction is saved only when the input has one, so a request without it keeps the stored
 * value. The update is scoped to `userId`. Returns the updated profile, or `null` when the user
 * does not exist.
 */
export async function updateProfile(db: Db, userId: string, input: UpdateProfileInput) {
  const changes: Partial<typeof users.$inferInsert> = {
    firstName: input.firstName,
    lastName: input.lastName,
    name: formatDisplayName(input.firstName, input.lastName),
    updatedAt: new Date(),
  };

  if (input.replyInstruction !== undefined) {
    changes.replyInstruction = input.replyInstruction;
  }

  const [profile] = await db
    .update(users)
    .set(changes)
    .where(eq(users.id, userId))
    .returning(profileColumns);

  return profile ?? null;
}
