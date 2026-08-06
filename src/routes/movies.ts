import { randomUUID } from "node:crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { esClient } from "../lib/elasticsearch";
import { MOVIES_INDEX } from "../elasticsearch/setupMoviesIndex";
import { movieInputSchema, movieSearchQuerySchema } from "../schemas/movie";
import { Prisma } from "../generated/prisma/client";

export const moviesRouter = Router();

moviesRouter.post("/", async (req, res, next) => {
  try {
    const input = movieInputSchema.parse(req.body);
    const id = randomUUID();

    const movie = await prisma.$transaction(async (tx) => {
      const created = await tx.movie.create({ data: { id, ...input } });

      await tx.outboxEvent.create({
        data: {
          aggregateId: created.id,
          eventType: "MOVIE_CREATED",
          payload: created,
        },
      });

      return created;
    });

    res.status(201).json({ ...movie, indexingStatus: "pending" });
  } catch (err) {
    next(err);
  }
});

moviesRouter.get("/", async (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const movies = await prisma.movie.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(movies);
  } catch (err) {
    next(err);
  }
});

async function searchMoviesInDatabase(q: string, limit: number, offset: number) {
  return prisma.movie.findMany({
    where: {
      title: { contains: q, mode: "insensitive" },
    },
    take: limit,
    skip: offset,
    orderBy: { createdAt: "desc" },
  });
}

moviesRouter.get("/search", async (req, res, next) => {
  try {
    const { q, limit, offset } = movieSearchQuerySchema.parse(req.query);

    try {
      const result = await esClient.search(
        {
          index: MOVIES_INDEX,
          query: {
            match: {
              title: {
                query: q,
                fuzziness: "AUTO",
              },
            },
          },
          from: offset,
          size: limit,
        },
        { requestTimeout: 3000, maxRetries: 0 },
      );

      const movies = result.hits.hits.map((hit) => hit._source);

      if (movies.length > 0) {
        res
          .status(200)
          .json({ source: "elasticsearch", searchDegraded: false, movies });
        return;
      }

      const dbMovies = await searchMoviesInDatabase(q, limit, offset);
      res
        .status(200)
        .json({ source: "database", searchDegraded: true, movies: dbMovies });
    } catch (esErr) {
      console.warn(
        "Elasticsearch search failed, falling back to Postgres:",
        esErr,
      );

      const movies = await searchMoviesInDatabase(q, limit, offset);
      res
        .status(200)
        .json({ source: "database", searchDegraded: true, movies });
    }
  } catch (err) {
    next(err);
  }
});

moviesRouter.get("/:id", async (req, res, next) => {
  try {
    const movie = await prisma.movie.findUnique({
      where: { id: req.params.id },
    });

    if (!movie) {
      res.status(404).json({ error: "Movie not found" });
      return;
    }

    res.status(200).json(movie);
  } catch (err) {
    next(err);
  }
});

moviesRouter.put("/:id", async (req, res, next) => {
  try {
    const input = movieInputSchema.parse(req.body);

    const movie = await prisma.movie.update({
      where: { id: req.params.id },
      data: input,
    });

    await esClient.index({
      index: MOVIES_INDEX,
      id: movie.id,
      document: movie,
      refresh: "wait_for",
    });

    res.status(200).json(movie);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      res.status(404).json({ error: "Movie not found" });
      return;
    }
    next(err);
  }
});

moviesRouter.delete("/:id", async (req, res, next) => {
  try {
    await prisma.movie.delete({ where: { id: req.params.id } });

    await esClient.delete({
      index: MOVIES_INDEX,
      id: req.params.id,
      refresh: "wait_for",
    });

    res.status(204).send();
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      res.status(404).json({ error: "Movie not found" });
      return;
    }
    next(err);
  }
});
