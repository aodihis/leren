# Using Leren

Leren answers the work email you choose to hand over, and tells you about the rest.

## Set it up

1. Sign in with your email address. Leren sends a six-digit code.
2. Connect a mailbox on the Profile page. Leren reads only mail that arrives after you connect it.
3. Write a playbook for each topic you want answered. Give it a topic, the information the assistant knows about it, and optionally an instruction on how to answer, such as a tone or what must never be said. You can set a default instruction in your profile, and a playbook instruction applies together with it and wins where the two conflict.
4. On the Rules tab, choose the period, which senders and recipient roles are answered, and the reply mode.
5. Turn the playbook on. It must name the mailbox it answers on.

You can also ask the assistant chat to look up, suggest or change playbooks. It proposes changes and you confirm them. It cannot send mail or change a reply mode.

## What happens to an email

| Status           | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `not_applicable` | Leren decided it needs no reply, so it left it alone.                |
| `drafted`        | A reply waits as a draft in your mailbox. Edit it and send it.       |
| `sent`           | A playbook in `send` mode replied without asking you.                |
| `escalated`      | Leren could not answer reliably. The reason is shown. You answer it. |
| `failed`         | Something broke, such as the mailbox refusing the reply.             |

Leren escalates when no playbook matches, when it is not sure what the email is, or when its draft fails the checks. It never invents an answer, and it treats the email text as data, not as instructions.

## Reply modes

- `draft` is the default. The reply is a draft in the right thread of your mailbox.
- `send` sends at once. Use it only for narrow, low-risk topics such as opening hours.

## Try it locally

With the services, the API (`CHANNEL_PROVIDERS=mailpit`) and the worker running, `pnpm demo` signs in, saves a playbook, records five simulated emails and prints how each one ended. The worker needs a model API key.
