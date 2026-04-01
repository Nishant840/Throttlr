# Throttlr 🚦

A production-grade **distributed rate limiting service** built with Node.js, TypeScript, and Redis. Implements multiple rate limiting algorithms with atomic Lua scripts, ensuring consistent enforcement across horizontally scaled instances.

**[Live Dashboard →](https://throttlr-production.up.railway.app/dashboard/)**

----------

## System Design

```
                      ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
                      ┃       Client / Users       ┃
                      ┗━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┛
                                    ┃
             ┏━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━┓
             ┃                                             ┃
             ▼                                             ▼
      ┏━━━━━━━━━━━━━━┓                              ┏━━━━━━━━━━━━━━┓
      ┃  Instance 1  ┃                              ┃  Instance 2  ┃
      ┃ (Stateless)  ┃                              ┃ (Stateless)  ┃
      ┣━━━━━━━━━━━━━━┫                              ┣━━━━━━━━━━━━━━┫
      ┃ Rate Limiter ┃                              ┃ Rate Limiter ┃
      ┃  Middleware  ┃                              ┃  Middleware  ┃
      ┗━━━━━━┳━━━━━━━┛                              ┗━━━━━━┳━━━━━━━┛
             ┃                                             ┃
             ┗━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━┛
                                    ┃
                                    ▼
                      ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
                      ┃           Redis            ┃
                      ┃  (Single Source of Truth)  ┃
                      ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
                      ┃ Sliding Window → ZSET      ┃
                      ┃ Token Bucket   → HASH      ┃
                      ┃ Stats          → INCR      ┃
                      ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
                      ┃ Lua Scripts (Atomic)       ┃
                      ┃ read + check + update      ┃
                      ┗━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┛
                                    ┃
                                    ▼
                      ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
                      ┃      Decision Engine       ┃
                      ┃     tokens available?      ┃
                      ┗━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┛
                             ┏━━━━━━┻━━━━━━┓
                            YES            NO
                             ┃             ┃
                             ▼             ▼
                      ┏━━━━━━━━━━━━┓ ┏━━━━━━━━━━━━┓
                      ┃   200 OK   ┃ ┃    429     ┃
                      ┃ + Headers  ┃ ┃ + Headers  ┃
                      ┗━━━━━━┳━━━━━┛ ┗━━━━━━┳━━━━━┛
                             ┃              ┃
                             ┗━━━━━━┳━━━━━━━┛
                                    ┃
                                    ▼
                      ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
                      ┃     Response to Client     ┃
                      ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

```

### How it works

1.  Client sends a request to any instance
2.  Middleware intercepts the request before it reaches business logic
3.  Middleware calls Redis with an atomic Lua script — reads and writes happen in one uninterruptible operation
4.  If under limit → request is allowed, `X-RateLimit-*` headers are set, request proceeds
5.  If over limit → `429 Too Many Requests` is returned immediately with `Retry-After` header
6.  Both instances share the same Redis — no user can bypass limits by hitting different instances
7.  If Redis goes down → fail-open logic allows all requests through, API stays available

----------

## Why Distributed?

Without shared Redis, each instance maintains its own counter:

```
❌ Without shared Redis (WRONG):
   User limit: 100 requests/minute

   Instance 1 counter: 100  →  allows request  (thinks: 100 total)
   Instance 2 counter: 100  →  allows request  (thinks: 100 total)
   Reality: user made 200 requests ← limit bypassed!

✅ With shared Redis (CORRECT):
   Instance 1 reads: 99  →
   Instance 2 reads: 99  →  Lua script runs atomically
   Only one gets through: 100  →  next request blocked

```

Lua scripts make the read-check-write operation **atomic** — Redis executes the entire script without interruption, eliminating race conditions.

----------

## Algorithms

### Sliding Window

Tracks exact request timestamps in a Redis Sorted Set. Always looks at the last N seconds from the current moment — not a fixed clock window.

```
Timeline:  ────────────────────────────────────────▶
                    [60 second sliding window]
           ──────────────────────────────────────────
           req1  req2  req3     req4  req5  req6(new)
            ↑                                  ↑
         windowStart                          now

Redis operations:
  ZREMRANGEBYSCORE  → remove requests older than windowStart
  ZCARD             → count requests in window
  ZADD              → add current request
  EXPIRE            → auto-cleanup

```

**Advantage over Fixed Window:** Prevents boundary burst attacks where a user sends 100 requests at 12:00:59 and 100 more at 12:01:01 — effectively 200 requests in 2 seconds.

**Time complexity:** O(log N) per request

----------

### Token Bucket

Each user has a bucket that fills with tokens at a fixed rate. Each request costs 1 token. Allows bursting — if a user hasn't made requests recently, they accumulate tokens.

```
Bucket capacity: 10 tokens
Refill rate: 2 tokens/second

t=0s:  [██████████]  10 tokens  →  request costs 1  →  [█████████░]  9 tokens
t=1s:  [███████████] 11 tokens? No — capped at 10   →  [██████████]  10 tokens
t=5s:  User hasn't requested  →  bucket full again

Redis storage per user:
  HASH {
    tokens: 8,
    lastRefill: 1706000058000
  }

```

**Advantage:** Naturally handles bursty traffic patterns. A user who hasn't made requests for a while gets to burst through several requests quickly.

----------

## Features

-   **2 Rate Limiting Algorithms** — Sliding Window and Token Bucket, each with different tradeoff profiles
-   **Atomic Lua Scripts** — eliminates race conditions across distributed instances
-   **Fail-Open Logic** — if Redis is unavailable, requests are allowed through instead of blocking everyone
-   **Reusable Middleware** — protect any Express route with one line
-   **Per-Endpoint Limiting** — `/login` and `/search` tracked separately per user
-   **Per-User + Per-IP** — flexible identifier strategy (userId → x-user-id header → IP → anonymous)
-   **Standard Headers** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on every response
-   **Persistent Stats** — request metrics stored in Redis, survive page refresh and server restarts
-   **Live Dashboard** — real-time admin UI showing allowed/blocked counts per user
-   **Docker Compose** — 2 app instances + Redis for local distributed testing
-   **k6 Load Tested** — validated at 200+ req/s with sub-15ms p95 latency

----------


## Tech Stack
| | |
|---|---|
| **Node.js + TypeScript** | Server runtime + type safety |
| **Redis** | Shared state, atomic Lua scripts, stats storage |
| **Express.js** | HTTP server and middleware pipeline |
| **Docker + Compose** | 2-instance distributed testing locally |
| **Railway + Upstash** | Cloud deployment + serverless Redis |
| **k6** | Load testing — validated at 200+ req/s |


## Project Structure

```
Throttlr/
├── src/
│   ├── algorithms/
│   │   ├── slidingWindow.ts     # Sliding window via ZADD/ZREMRANGEBYSCORE
│   │   └── tokenBucket.ts       # Token bucket via HMGET/HMSET
│   ├── config/
│   │   ├── redis.ts             # Redis client + health tracking
│   │   └── stats.ts             # Persistent metrics in Redis
│   ├── middleware/
│   │   └── rateLimiter.ts       # Reusable Express middleware
│   ├── routes/
│   │   └── rateLimiter.ts       # API route handlers
│   ├── dashboard/
│   │   └── index.html           # Live admin dashboard
│   ├── app.ts                   # Express app setup
│   └── server.ts                # Entry point
├── k6/
│   └── load-test.js             # k6 load test script
├── Dockerfile
├── docker-compose.yml
└── .env.example

```

----------

## API Reference

### `POST /api/check`

Check if a request is allowed using the **Sliding Window** algorithm.

**Request body:**

```json
{
  "userId": "user_123",
  "limit": 10,
  "windowSize": 60
}

```

**Response (allowed):**

```json
{
  "allowed": true,
  "remaining": 9,
  "resetAt": 1706000118000
}

```

**Response (blocked):**

```json
{
  "allowed": false,
  "message": "Too many requests",
  "retryAfter": 45
}

```

**Headers on every response:**

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 1706000118000

```

----------

### `POST /api/check-bucket`

Check if a request is allowed using the **Token Bucket** algorithm.

**Request body:**

```json
{
  "userId": "user_123",
  "capacity": 10,
  "refillRate": 2
}

```

----------

### `GET /api/stats`

Returns aggregated request metrics from Redis.

**Response:**

```json
{
  "total": 8197,
  "allowed": 122,
  "blocked": 8075,
  "activeUsers": 11,
  "users": [
    {
      "userId": "user_5",
      "total": 791,
      "allowed": 10,
      "blocked": 781
    }
  ]
}

```

----------

### `POST /api/reset`

Reset rate limit and stats for a specific user.

**Request body:**

```json
{
  "userId": "user_123"
}

```

----------

### `GET /health`

Health check endpoint — not rate limited.

```json
{ "status": "ok" }

```

----------

## Using the Middleware

Protect any route with one line:

```typescript
import { rateLimitMiddleware } from './middleware/rateLimiter';

// 10 requests per 60 seconds
app.get('/api/search', rateLimitMiddleware({ limit: 10, windowSize: 60 }), handler);

// Stricter limit for auth routes
app.post('/api/login', rateLimitMiddleware({ limit: 5, windowSize: 60 }), handler);

// Custom identifier (e.g. API key from header)
app.get('/api/data', rateLimitMiddleware({
  limit: 100,
  windowSize: 60,
  keyGenerator: (req) => req.headers['x-api-key'] as string || req.ip
}), handler);

```

The middleware automatically:

-   Reads identifier from `body.userId` → `x-user-id` header → IP → `anonymous`
-   Tracks per-endpoint (each path is a separate counter per user)
-   Sets `X-RateLimit-*` headers on every response
-   Returns `429` with `Retry-After` when blocked
-   Fails open if Redis is unavailable

----------

## Local Setup

### Prerequisites

-   Node.js 18+
-   Redis
-   Docker Desktop (for distributed testing)

### Installation

```bash
git clone https://github.com/Nishant840/Throttlr.git
cd Throttlr
npm install

```

### Environment variables

Create a `.env` file:

```env
PORT=3000
REDIS_URL=redis://localhost:6379
INSTANCE_ID=local

```

### Run locally

```bash
# Start Redis
brew services start redis

# Start server
npm run dev

```

Server runs at `http://localhost:3000` Dashboard at `http://localhost:3000/dashboard`

----------

### Run with Docker (distributed mode)

```bash
docker-compose up --build

```

This starts:

-   `instance-1` on `localhost:3001`
-   `instance-2` on `localhost:3002`
-   Redis on `localhost:6379`

Both instances share one Redis. Test distributed consistency:

```bash
# Hit instance 1
curl -X POST http://localhost:3001/api/check \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_123", "limit": 5, "windowSize": 60}'

# Hit instance 2 — same counter
curl -X POST http://localhost:3002/api/check \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_123", "limit": 5, "windowSize": 60}'

```

Alternate between instances — the 6th request on either instance is blocked.

----------

## Load Test Results

Tested with k6 — 50 concurrent virtual users, 40 second ramp-up:

```
checks_total.......: 24,477   611/s
checks_succeeded...: 100.00%  24,477 out of 24,477
checks_failed......: 0.00%    0 out of 24,477

✓ status is 200 or 429
✓ response has allowed field
✓ response time < 100ms

http_req_duration..: avg=9.12ms  p95=13.52ms  max=27.35ms
http_reqs..........: 8,159       203/s
vus_max............: 50

```

**203 requests/second. 100% check pass rate. Sub-15ms p95 latency.**

Run the load test yourself:

```bash
# Against local
k6 run k6/load-test.js

# Against production
k6 run -e BASE_URL=https://throttlr-production.up.railway.app k6/load-test.js

```

----------

## Key Design Decisions

**Why Redis over in-memory counters?** In-memory counters don't survive instance restarts and can't be shared across instances. Redis provides a single source of truth — all instances read and write the same counters.

**Why Lua scripts over multiple Redis commands?** Multiple commands have a gap between read and write — two instances can read the same count simultaneously and both allow a request that should be blocked. Lua scripts execute atomically inside Redis — no gap, no race condition.

**Why fail-open over fail-closed?** Availability > strict rate limiting. If Redis goes down, blocking all traffic causes more damage than temporarily allowing excess requests. The API stays up — rate limiting resumes automatically when Redis recovers.

**Why Sliding Window over Fixed Window?** Fixed window resets at fixed intervals — a user can send max requests just before and just after the reset, doubling their effective limit. Sliding window always looks at the last N seconds from now, preventing this boundary burst attack.

----------

## Live Demo

**Dashboard:** https://throttlr-production.up.railway.app/dashboard/

**Test the API:**

```bash
curl -X POST https://throttlr-production.up.railway.app/api/check \
  -H "Content-Type: application/json" \
  -d '{"userId": "your_name", "limit": 5, "windowSize": 60}'

```

----------
## 🧑‍💻 Author

Nishant Kumar  
B.Tech Computer Science  
Indian Institute of Information Technology (IIIT) Bhopal