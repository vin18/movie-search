import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { prisma } from "../lib/prisma";
import { getTemporalClient } from "../lib/temporal";
import type { indexMovieWorkflow } from "../temporal/workflows";

const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 2000;
export const MOVIE_INDEXING_TASK_QUEUE = "movie-indexing";

async function processOutboxBatch(): Promise<void> {
  const pendingEvents = await prisma.outboxEvent.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  if (pendingEvents.length === 0) {
    return;
  }

  const client = await getTemporalClient();

  for (const event of pendingEvents) {
    if (
      event.eventType !== "MOVIE_CREATED" &&
      event.eventType !== "MOVIE_UPDATED"
    ) {
      console.warn(
        `Outbox processor: no handler yet for eventType "${event.eventType}", skipping event ${event.id}.`,
      );
      continue;
    }

    try {
      await client.workflow.start<typeof indexMovieWorkflow>(
        "indexMovieWorkflow",
        {
          taskQueue: MOVIE_INDEXING_TASK_QUEUE,
          workflowId: `movie-index-${event.id}`,
          args: [event.aggregateId],
        },
      );
    } catch (err) {
      if (!(err instanceof WorkflowExecutionAlreadyStartedError)) {
        console.error(
          `Outbox processor: failed to start workflow for event ${event.id}:`,
          err,
        );
        continue;
      }
      // Already handed off in a previous cycle (e.g. crash before we marked
      // it processed) - safe to fall through and mark it processed now.
    }

    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
  }
}

export function startOutboxProcessor(): NodeJS.Timeout {
  console.log("Outbox processor started, polling every", POLL_INTERVAL_MS, "ms");
  return setInterval(() => {
    processOutboxBatch().catch((err) => {
      console.error("Outbox processor: batch failed:", err);
    });
  }, POLL_INTERVAL_MS);
}
