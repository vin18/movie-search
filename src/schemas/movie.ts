import { z } from "zod";

export const movieInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  genres: z.array(z.string().min(1)).min(1),
  releaseYear: z.number().int(),
  director: z.string().min(1),
});

export type MovieInput = z.infer<typeof movieInputSchema>;

export const movieSearchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().positive().default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type MovieSearchQuery = z.infer<typeof movieSearchQuerySchema>;
