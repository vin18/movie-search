import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";

const { indexMovieActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30s",
  retry: {
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumInterval: "30s",
  },
});

export async function indexMovieWorkflow(movieId: string): Promise<void> {
  await indexMovieActivity(movieId);
}
