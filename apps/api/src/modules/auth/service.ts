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

/** Joins a first and last name into a display name. */
export function formatDisplayName(firstName?: string | null, lastName?: string | null): string {
  return [firstName ?? "", lastName ?? ""].flatMap((part) => part.trim() || []).join(" ");
}

function textOrFallback(value: unknown, fallback: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return typeof fallback === "string" ? fallback : "";
}

/** Creates the Better Auth instance. */
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
};

/** Returns the public profile of a user. */
export async function getProfile(db: Db, userId: string) {
  const [profile] = await db.select(profileColumns).from(users).where(eq(users.id, userId));

  return profile ?? null;
}

/** Saves a user's name and derives the display name. */
export async function updateProfile(db: Db, userId: string, input: UpdateProfileInput) {
  const [profile] = await db
    .update(users)
    .set({
      firstName: input.firstName,
      lastName: input.lastName,
      name: formatDisplayName(input.firstName, input.lastName),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning(profileColumns);

  return profile ?? null;
}
