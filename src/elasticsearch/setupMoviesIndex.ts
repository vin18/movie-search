import "dotenv/config";
import { esClient } from "../lib/elasticsearch";

export const MOVIES_INDEX = "movies";

async function setupMoviesIndex() {
  const { body: exists } = await esClient.indices.exists(
    { index: MOVIES_INDEX },
    { meta: true },
  );

  if (exists) {
    console.log(`Index "${MOVIES_INDEX}" already exists, skipping creation.`);
    return;
  }

  await esClient.indices.create({
    index: MOVIES_INDEX,
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
    mappings: {
      properties: {
        title: {
          type: "text",
          analyzer: "english",
          fields: {
            keyword: { type: "keyword" },
          },
        },
        description: {
          type: "text",
          analyzer: "english",
        },
        genres: {
          type: "keyword",
        },
        releaseYear: {
          type: "integer",
        },
        director: {
          type: "text",
          fields: {
            keyword: { type: "keyword" },
          },
        },
        createdAt: {
          type: "date",
        },
        updatedAt: {
          type: "date",
        },
      },
    },
  });

  console.log(`Index "${MOVIES_INDEX}" created.`);
}

if (require.main === module) {
  setupMoviesIndex()
    .catch((err) => {
      console.error("Failed to set up movies index:", err);
      process.exit(1);
    })
    .finally(() => esClient.close());
}
