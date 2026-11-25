import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@leren/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import type { InferRequestType } from "hono/client";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { loadAccessTokens } from "../../../modules/agent-access/load-access-tokens";
import { api } from "../../../modules/api/api-client";

const LIFETIMES = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
] as const;

type TokenValues = InferRequestType<typeof api.api.mcp.tokens.$post>["json"];

const FAILURES: Record<string, string> = {
  limit: "You already have 10 active tokens. Revoke one before you create another.",
};

const GENERIC_FAILURE = "Could not create the token. Try again.";

export const Route = createFileRoute("/_authed/agent-access/")({
  loader: loadAccessTokens,
  component: AgentAccessPage,
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * Creates and revokes the access tokens that let the user's own agent use the MCP server. The
 * token is shown once, right after it is created, because the server does not store it and cannot
 * show it again.
 */
function AgentAccessPage() {
  const tokens = Route.useLoaderData();
  const router = useRouter();

  const form = useForm<TokenValues>({
    defaultValues: { name: "", access: "read", expiresInDays: 90 },
  });

  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const endpoint = `${window.location.origin}/mcp`;

  async function handleCreate(values: TokenValues) {
    setFailure(null);

    const response = await api.api.mcp.tokens.$post({ json: values });

    if (response.status === 400) {
      const body = (await response.json()) as { fieldErrors?: { name?: string[] } };

      form.setError("name", { message: body.fieldErrors?.name?.[0] ?? GENERIC_FAILURE });

      return;
    }

    if (response.status === 409) {
      setFailure(FAILURES[(await response.json()).error] ?? GENERIC_FAILURE);

      return;
    }

    if (!response.ok) {
      setFailure(GENERIC_FAILURE);

      return;
    }

    setCreated((await response.json()).token);
    setCopied(false);
    form.reset({ ...form.getValues(), name: "" });
    await router.invalidate();
  }

  async function handleRevoke(id: string) {
    const response = await api.api.mcp.sessions[":id"].$delete({ param: { id } });

    setFailure(response.ok ? null : "Could not revoke the token.");

    if (response.ok) {
      await router.invalidate();
    }
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agent access</h1>
        <p className="text-body-sm text-ink-muted">
          Let your own agent read and manage your playbooks through the MCP server. A token acts
          only on your data and can be revoked at any time.
        </p>
      </div>
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      {created && (
        <Alert>
          <AlertDescription className="space-y-2">
            <p className="font-medium">Copy your token now. It is not shown again.</p>
            <code className="block break-all rounded-md bg-muted p-2 text-xs">{created}</code>
            <Button variant="outline" size="sm" onClick={() => handleCopy(created)}>
              {copied ? "Copied" : "Copy token"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <section className="space-y-3">
        <h2 className="text-title-sm font-semibold">Connect your agent</h2>
        <p className="text-body-sm text-ink-muted">
          Point an MCP client at this address and send the token as a bearer token in the
          Authorization header.
        </p>
        <code className="block rounded-md bg-muted p-2 text-sm">{endpoint}</code>
      </section>
      <section className="space-y-3">
        <h2 className="text-title-sm font-semibold">Create a token</h2>
        <form
          onSubmit={form.handleSubmit(handleCreate)}
          className="grid gap-4 sm:grid-cols-4 sm:items-start"
        >
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="token-name">Name</Label>
            <Input id="token-name" placeholder="Claude Desktop" {...form.register("name")} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="token-access">Access</Label>
            <NativeSelect id="token-access" className="w-full" {...form.register("access")}>
              <NativeSelectOption value="read">Read only</NativeSelectOption>
              <NativeSelectOption value="write">Read and write</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="token-lifetime">Expires after</Label>
            <NativeSelect
              id="token-lifetime"
              className="w-full"
              {...form.register("expiresInDays", { valueAsNumber: true })}
            >
              {LIFETIMES.map((lifetime) => (
                <NativeSelectOption key={lifetime.days} value={lifetime.days}>
                  {lifetime.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="sm:col-span-4">
            <Button type="submit">Create token</Button>
          </div>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="text-title-sm font-semibold">Active tokens</h2>
        {tokens.length === 0 ? (
          <p className="text-muted-foreground">You have no active tokens.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {token.access === "write" ? "Read and write" : "Read only"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(token.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(token.expiresAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Revoke ${token.name}`}
                      onClick={() => handleRevoke(token.id)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
