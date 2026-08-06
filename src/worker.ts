import "dotenv/config";
import path from "node:path";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./temporal/activities";
import {
  startOutboxProcessor,
  MOVIE_INDEXING_TASK_QUEUE,
} from "./outbox/outboxProcessor";

async function run() {
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  });

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: MOVIE_INDEXING_TASK_QUEUE,
    workflowsPath: path.join(__dirname, "temporal/workflows.ts"),
    activities,
  });

  startOutboxProcessor();

  console.log(
    `Temporal worker started, polling task queue "${MOVIE_INDEXING_TASK_QUEUE}"`,
  );

  await worker.run();
}

run().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
