import { z } from "zod";

/**
 * A playbook that retrieval returned. Only the fields that the stages read are required, and the
 * rest of the view is kept as it arrived.
 */
export const playbookSchema = z.looseObject({
  id: z.string().min(1),
  topic: z.string(),
  information: z.string(),
  instruction: z.string().optional(),
});

export type Playbook = z.infer<typeof playbookSchema>;

/** The result of searching the knowledge for one email. */
export type Retrieval =
  | { readonly status: "ok"; readonly playbooks: readonly Playbook[] }
  | { readonly status: "no_reliable_result" };
