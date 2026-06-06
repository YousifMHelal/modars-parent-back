import prisma from "../src/db/prisma.js";
import { closeQueues } from "../src/jobs/queues.js";

export async function teardown() {
  // Close any BullMQ queue connections opened during the run so they don't leak across
  // runs (a lingering Redis connection can SASL/contention-fail the next invocation).
  await closeQueues();
  await prisma.$disconnect();
}
