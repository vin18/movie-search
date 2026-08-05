import "dotenv/config";
import express from "express";
import { moviesRouter } from "./routes/movies";
import { errorHandler } from "./middleware/errorHandler";

const app = express();
const port = process.env.PORT ?? 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/movies", moviesRouter);

app.use(errorHandler);

app.listen(port, () => {
  console.log(`movie-search API listening on port ${port}`);
});
