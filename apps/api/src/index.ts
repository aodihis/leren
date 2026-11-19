import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { createLogger } from "@leren/logger";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { z } from "zod";

const logger = createLogger({ name: "api" });

const app = new Hono();

app.use(requestId());

app.use(async (c, next) => {
  const requestLogger = logger.child({ requestId: c.get("requestId") });

  await next();

  requestLogger.info("Request completed", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
  });
});

app.get("/", (c) => c.json({ name: "leren-api" }));

app.get("/health", (c) => c.json({ status: "ok" }));

const echoSchema = z.object({ message: z.string().min(1) });

app.post("/echo", zValidator("json", echoSchema), (c) => {
  const { message } = c.req.valid("json");

  return c.json({ message });
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  logger.info("API listening", { port: info.port });
});

export type AppType = typeof app;
