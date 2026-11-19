import { randomUUID } from "node:crypto";

import { connect } from "amqplib";
import { describe, expect, it } from "vitest";

import { describeQueueContract } from "./contract";
import { deadLetterQueueName } from "./names";
import { createRabbitMqQueue } from "./rabbitmq";

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://leren:leren@localhost:56720";

describeQueueContract("RabbitMQ", () => createRabbitMqQueue({ url: RABBITMQ_URL }));

describe("RabbitMQ queue", () => {
  it("dead-letters a message whose body is not valid JSON", async () => {
    const queue = `contract.${randomUUID()}`;
    const client = await createRabbitMqQueue({ url: RABBITMQ_URL });
    const connection = await connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    const handled: unknown[] = [];

    try {
      await client.publish(queue, {});
      channel.sendToQueue(queue, Buffer.from("not json"), { persistent: true });
      await client.consume(queue, async (message) => void handled.push(message.payload));
      await new Promise((resolve) => setTimeout(resolve, 500));

      const deadLetter = await channel.get(deadLetterQueueName(queue), { noAck: true });

      expect(handled).toEqual([{}]);
      expect(deadLetter && deadLetter.content.toString()).toBe("not json");
      expect(deadLetter && deadLetter.properties.headers?.["x-last-error"]).toBe(
        "The message is not valid JSON",
      );
    } finally {
      await channel.close();
      await connection.close();
      await client.close();
    }
  });

  it("fails to connect to an unreachable broker", async () => {
    await expect(createRabbitMqQueue({ url: "amqp://localhost:1" })).rejects.toThrow();
  });
});
