import { prisma } from "../lib/prisma";
import { esClient } from "../lib/elasticsearch";
import { MOVIES_INDEX } from "../elasticsearch/setupMoviesIndex";

export async function indexMovieActivity(movieId: string): Promise<void> {
  const movie = await prisma.movie.findUniqueOrThrow({
    where: { id: movieId },
  });

  // indexingStatus is Postgres-side bookkeeping about the sync process
  // itself - it doesn't belong in the search-facing document, and mirroring
  // it into Elasticsearch would always be stale by definition (Elasticsearch
  // only ever sees a movie after that field has already moved on).
  const { indexingStatus: _indexingStatus, ...searchableMovie } = movie;

  await esClient.index({
    index: MOVIES_INDEX,
    id: movie.id,
    document: searchableMovie,
    refresh: "wait_for",
  });

  await prisma.movie.update({
    where: { id: movie.id },
    data: { indexingStatus: "INDEXED" },
  });
}
