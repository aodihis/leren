import { ImapFlow } from "imapflow";
import SMTPConnection from "nodemailer/lib/smtp-connection";

import type { ImapSettings } from "./imap-settings";
import { HostNotAllowedError, resolvePublicAddress } from "./net-guard";
import type { ResolveHost } from "./net-guard";
import { SignInError } from "./types";
import type { SignInFailure } from "./types";

/** How long connecting, the greeting and each step of a session may take, in milliseconds. */
const TIMEOUT_MS = 15_000;

/** The part of an IMAP client that the adapter uses, so tests can replace it. */
export type ImapClient = Pick<
  ImapFlow,
  "mailboxOpen" | "fetch" | "fetchOne" | "list" | "append" | "logout"
>;

/** An SMTP session that has signed in. */
export type SmtpSession = {
  /**
   * Hands one message to the server and returns the server's answer. It throws an error with a
   * numeric `responseCode` when the server refused the message, and one without it when the
   * connection failed.
   */
  send(envelope: { from: string; to: string[] }, message: Buffer): Promise<string>;
  quit(): void;
};

/**
 * Opens signed-in sessions with the servers of an account. Each method throws `SignInError` when
 * the session cannot be opened, with the reason the user can act on.
 */
export type MailServers = {
  openImap(settings: ImapSettings): Promise<ImapClient>;
  openSmtp(settings: ImapSettings): Promise<SmtpSession>;
};

const TLS_ERROR_CODE = /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO|DEPTH_ZERO|SELF_SIGNED|ETLS$)/;

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === "string" ? code : "";
}

/**
 * The IMAP response codes of RFC 5530 that refuse a sign-in for a temporary reason, so the
 * credentials may still be valid.
 */
const TEMPORARY_IMAP_CODES = new Set(["UNAVAILABLE", "INUSE", "LIMIT", "SERVERBUG"]);

/**
 * Classifies an error of opening an IMAP session. Only a sign-in that the server refuses for a
 * permanent reason counts as refused credentials. A temporary refusal, a failed TLS set-up and
 * anything else mean that the server could not be used.
 */
export function imapOpenFailure(error: unknown): SignInFailure {
  const details = (error ?? {}) as {
    authenticationFailed?: unknown;
    serverResponseCode?: unknown;
    tlsFailed?: unknown;
  };

  if (
    typeof details.serverResponseCode === "string" &&
    TEMPORARY_IMAP_CODES.has(details.serverResponseCode)
  ) {
    return "server_unreachable";
  }

  if (
    details.authenticationFailed === true ||
    details.serverResponseCode === "AUTHENTICATIONFAILED"
  ) {
    return "authentication_failed";
  }

  if (details.tlsFailed === true || TLS_ERROR_CODE.test(errorCode(error))) {
    return "encryption_failed";
  }

  return "server_unreachable";
}

/**
 * The class of the SMTP reply code on an error: `temporary` for a `4xx` code, `permanent` for a
 * `5xx` code, and undefined when the server gave no reply code, because the connection failed.
 */
export function smtpReplyClass(error: unknown): "temporary" | "permanent" | undefined {
  const code = (error as { responseCode?: unknown } | null)?.responseCode;

  if (typeof code !== "number" || code < 400) {
    return undefined;
  }

  return code < 500 ? "temporary" : "permanent";
}

/**
 * Classifies an error of opening an SMTP session, as `imapOpenFailure` does for IMAP. A sign-in
 * refused with a `4xx` reply code is a temporary refusal, so it means the server could not be used.
 */
export function smtpOpenFailure(error: unknown): SignInFailure {
  if (errorCode(error) === "EAUTH" && smtpReplyClass(error) !== "temporary") {
    return "authentication_failed";
  }

  return TLS_ERROR_CODE.test(errorCode(error)) ? "encryption_failed" : "server_unreachable";
}

async function reachableAddress(host: string, resolve: ResolveHost | undefined): Promise<string> {
  try {
    return await resolvePublicAddress(host, resolve);
  } catch (error) {
    if (error instanceof HostNotAllowedError) {
      throw new SignInError("host_not_allowed", error.message);
    }

    throw new SignInError("server_unreachable", `The host ${host} could not be resolved`);
  }
}

/**
 * Connects to the real servers (decision 0063). Each host is resolved and checked first, and the
 * connection goes to the checked address with the host name as the TLS server name. Certificates
 * are verified, and a server that cannot encrypt the connection is refused.
 */
export function createMailServers(resolve?: ResolveHost): MailServers {
  return {
    async openImap(settings) {
      const address = await reachableAddress(settings.imapHost, resolve);
      const implicitTls = settings.imapPort === 993;

      const client = new ImapFlow({
        host: address,
        port: settings.imapPort,
        secure: implicitTls,
        doSTARTTLS: implicitTls ? undefined : true,
        servername: settings.imapHost,
        tls: { servername: settings.imapHost, rejectUnauthorized: true },
        auth: { user: settings.username, pass: settings.password },
        logger: false,
        disableAutoIdle: true,
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
      });

      client.on("error", () => undefined);

      try {
        await client.connect();
      } catch (error) {
        client.close();

        throw new SignInError(imapOpenFailure(error), "Opening the IMAP session failed");
      }

      return client;
    },
    async openSmtp(settings) {
      const address = await reachableAddress(settings.smtpHost, resolve);
      const implicitTls = settings.smtpPort === 465;

      const connection = new SMTPConnection({
        host: address,
        port: settings.smtpPort,
        secure: implicitTls,
        requireTLS: !implicitTls,
        tls: { servername: settings.smtpHost, rejectUnauthorized: true },
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
      });

      connection.on("error", () => undefined);

      try {
        await new Promise<void>((resolveStep, rejectStep) => {
          connection.connect((error?: Error) => (error ? rejectStep(error) : resolveStep()));
        });

        await new Promise<void>((resolveStep, rejectStep) => {
          connection.login({ user: settings.username, pass: settings.password }, (error) =>
            error ? rejectStep(error) : resolveStep(),
          );
        });
      } catch (error) {
        connection.close();

        throw new SignInError(smtpOpenFailure(error), "Opening the SMTP session failed");
      }

      return {
        send(envelope, message) {
          return new Promise((resolveSend, rejectSend) => {
            connection.send(envelope, message, (error, info) =>
              error ? rejectSend(error) : resolveSend(info.response),
            );
          });
        },
        quit() {
          connection.quit();
        },
      };
    },
  };
}
