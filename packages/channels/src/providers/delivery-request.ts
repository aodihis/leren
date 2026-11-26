import { notReachedCode } from "./mail-format";
import { DeliveryNotSentError, DeliveryRejectedError } from "./types";

export type DeliveryRequestOptions = {
  /** The name of the provider's API in error messages, such as "Gmail". */
  service: string;
  /** What the request is in error messages, such as its path. */
  label: string;
  /** Whether an answer with the status 403 reports a rate limit, which a later retry may pass. */
  isRateLimit?: (answer: unknown) => boolean;
};

/**
 * Makes one request of a delivery and returns the successful response (decision 0046). It throws
 * `DeliveryNotSentError` when the request is known not to have reached the provider or was refused
 * for credentials or a rate limit, `DeliveryRejectedError` when the provider refused it for another
 * reason, and a plain error when the outcome is not known.
 */
export async function deliveryRequest(
  send: typeof fetch,
  url: string,
  init: RequestInit,
  { service, label, isRateLimit }: DeliveryRequestOptions,
): Promise<Response> {
  let response: Response;

  try {
    response = await send(url, init);
  } catch (error) {
    const code = notReachedCode(error);

    if (code) {
      throw new DeliveryNotSentError(`${service} was not reached: ${code}`);
    }

    throw error;
  }

  if (response.ok) {
    return response;
  }

  const message = `${service} request ${label} failed with status ${response.status}`;

  if (response.status === 401 || response.status === 429) {
    throw new DeliveryNotSentError(message);
  }

  if (response.status === 403) {
    const rateLimited = isRateLimit?.(await response.json().catch(() => undefined)) ?? false;

    throw rateLimited
      ? new DeliveryNotSentError(message)
      : new DeliveryRejectedError("forbidden", message);
  }

  if (response.status >= 400 && response.status < 500) {
    throw new DeliveryRejectedError("rejected", message);
  }

  throw new Error(message);
}
