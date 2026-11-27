import { z } from "zod";

/**
 * A host name or an IPv4 address, in lower case. Whether it may be reached is decided when it is
 * resolved, by `resolvePublicAddress`.
 */
const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter the server name")
  .max(253)
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/,
    "Enter a server name such as mail.example.com",
  );

/** 993 is IMAP over TLS and 143 is IMAP upgraded with STARTTLS (decision 0063). */
export const IMAP_PORTS = [993, 143] as const;

/** 465 is SMTP submission over TLS and 587 is SMTP submission upgraded with STARTTLS. */
export const SMTP_PORTS = [465, 587] as const;

/**
 * The settings that connect an `imap` account, as the user gives them (decision 0063). The API
 * validates a sign-in request with it, so the messages are shown next to the fields. SMTP uses the
 * same user name and password as IMAP.
 */
export const imapSettingsInputSchema = z.object({
  address: z.email("Enter a valid email address").max(320).toLowerCase(),
  username: z.string().trim().max(320).optional(),
  password: z.string().min(1, "Enter the password").max(1024),
  imapHost: hostSchema,
  imapPort: z.literal(IMAP_PORTS, "Choose port 993 or 143"),
  smtpHost: hostSchema,
  smtpPort: z.literal(SMTP_PORTS, "Choose port 465 or 587"),
});

/** The settings with an empty user name replaced by the address. */
export const imapSettingsSchema = imapSettingsInputSchema.transform(
  ({ username, ...settings }) => ({
    ...settings,
    username: username || settings.address,
  }),
);

export type ImapSettings = z.output<typeof imapSettingsSchema>;

/**
 * Reads the settings that the provider stored as the account's access token. They were valid when
 * they were stored, so a failure means the credentials are corrupt.
 */
export function readStoredSettings(accessToken: string): ImapSettings {
  return imapSettingsSchema.parse(JSON.parse(accessToken));
}
