export const API_PORT = 13100;
export const PLATFORM_PORT = 15174;
export const PLATFORM_URL = `http://localhost:${PLATFORM_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;
export const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:58025";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://leren:leren@localhost:56720";
export const SMTP_URL = process.env.SMTP_URL ?? "smtp://localhost:51025";

export const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://leren:leren@localhost:54329/leren";

export const E2E_DATABASE_NAME = "leren_e2e";
