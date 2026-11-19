import { describeQueueContract } from "./contract";
import { createInMemoryQueue } from "./memory";

describeQueueContract("In-memory", async () => createInMemoryQueue());
