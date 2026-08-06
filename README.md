# movie-search

A resilient movie search service, built to demonstrate the tradeoffs between a primary datastore (PostgreSQL) and a derived search index (Elasticsearch): why they shouldn't be treated as equally authoritative, what breaks when you write to both synchronously, and how the transactional outbox pattern with Temporal fixes it.

The project is built in two parts against the same codebase:

- **Part 1 (current):** a deliberately naive synchronous dual-write — the API writes to Postgres, then Elasticsearch, in the same request. This exists to make the consistency problem real and visible, not to be a recommended pattern.
- **Part 2 (planned):** the transactional outbox pattern + Temporal, replacing the dual-write with an atomically-recorded intent (Postgres) and a guaranteed, retried, idempotent propagation to Elasticsearch.

## Running locally

```bash
docker compose up -d postgres elasticsearch
npm install
npm run db:migrate
npm run es:setup
npm run dev
```

## Architectural Decisions

- **Postgres is the source of truth; Elasticsearch is a derived, non-authoritative search index.** Nothing is ever written to Elasticsearch that doesn't already exist in Postgres.
- **Built in two explicit parts**, per the intro above — Part 1 (naive dual-write) is intentionally shipped first so the failure modes are concrete before Part 2 (outbox + Temporal) fixes them.
- **Prisma 7 + `@prisma/adapter-pg` driver adapter.** Prisma 7 removed the built-in query engine binary for SQL providers — a driver adapter (wrapping `pg`) is now required for both the CLI and the runtime client.
- **Elasticsearch mapping:** `title`/`description` use the `english` analyzer for stemmed full-text relevance; `title`/`director` carry a `keyword` subfield for exact match/sort/aggregation; `genres` is plain `keyword` (no analysis needed for exact filtering). Settings are `1` shard / `0` replicas, appropriate for a single-node dev cluster — replicas would sit permanently unassigned and report cluster status `yellow`.
- **Search strategy:** primary path is an Elasticsearch `match` query on `title` with `fuzziness: "AUTO"` for typo tolerance. Falls back to a Postgres `contains` (case-insensitive substring) query in two cases: when Elasticsearch is unreachable, *and* when Elasticsearch is reachable but returns zero hits (treating an empty ES result as unproven rather than final, since Postgres is the source of truth). Every response identifies which store actually served it: `{ source: "elasticsearch" | "database", searchDegraded: boolean, movies }`.
- **`maxRetries: 0` on the Elasticsearch search call specifically.** The client's default (`maxRetries: 3`, with backoff) meant a down cluster took ~8.5s to fail over to Postgres despite an explicit `requestTimeout: 3000` — the timeout only bounds a single attempt, not the retry loop. Disabling retries on this call brought failover down to ~200ms.

## Failure Scenarios

Tested manually against the running stack (see conversation history / commits for exact repro steps):

- **Dual-write inconsistency:** stopping the Elasticsearch container and issuing a create/update/delete shows Postgres committing successfully while the Elasticsearch write fails — the client receives a `500` even though the Postgres row already exists (create/update) or was already deleted (delete). Delete is the worst case: Postgres removes the row but Elasticsearch keeps a "ghost" document, so search can return a movie that then `404`s on direct lookup.
- **Unsafe retries:** because create has no idempotency protection, a client that reasonably retries after a `500` (assuming nothing happened) produces a second, duplicate Postgres row for what was intended as one movie.
- **Elasticsearch client default retry behavior:** discovered via timing, not just reading docs — a search with ES down took 8.5s instead of the intended ~3s, traced to the client's default 3 retries with backoff running underneath the per-attempt `requestTimeout`. Fixed with `maxRetries: 0` on that call.
- **Host port collision:** a native Postgres already running on the development machine (`127.0.0.1:5432`) was silently intercepting connections intended for the Docker container also mapped to `5432`, surfacing as a confusing `P1010` / role-not-found error rather than a connection failure. Resolved by remapping the container to host port `5433`.

## Tradeoffs

- **Dual-write is not a transaction.** It has none of Atomicity, Consistency, Isolation, or full Durability across the two systems: a concurrent reader can see the new Postgres row via direct lookup while a concurrent search against Elasticsearch still misses it — an isolation violation a real transaction wouldn't expose. True two-phase commit (2PC/XA) isn't reachable here regardless of implementation effort, since Elasticsearch has no XA participation at all. A saga with compensating actions (roll back the Postgres row if the ES write fails) is a legitimate alternative, but still exposes the same inconsistent window to any reader between the Postgres commit and the compensation running.
- **Using Postgres as a search fallback has real scalability costs, not just a resilience benefit.** `contains` (`ILIKE '%q%'`) can't use a standard B-tree index — it's a full table scan at scale, unlike Elasticsearch's inverted index. It also couples search load to the same connection pool as writes, so a surge of fallback search traffic during an ES outage can degrade write availability too, even though writes never touch Elasticsearch. And because the current design falls back to Postgres whenever Elasticsearch returns *zero hits* — not only when Elasticsearch is down — this cost is a standing baseline load during normal, fully healthy operation, not just a rare failover path.
- **Why the outbox pattern sidesteps the atomicity problem rather than solving it directly:** rather than trying to make the Postgres and Elasticsearch writes commit together (impossible given Elasticsearch's lack of 2PC support), the outbox pattern makes only the *intent* atomic — the movie row and an outbox row recording "this needs to be synced" commit together in one ordinary Postgres transaction, which Postgres already does natively. Propagation to Elasticsearch then becomes a separate, asynchronous concern that Temporal retries until it succeeds, rather than something that has to succeed within the original request.
