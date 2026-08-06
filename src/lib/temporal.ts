import { Connection, Client } from "@temporalio/client";

let clientPromise: Promise<Client> | undefined;

export function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = Connection.connect({
      address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    }).then(
      (connection) =>
        new Client({
          connection,
          namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
        }),
    );
  }
  return clientPromise;
}
