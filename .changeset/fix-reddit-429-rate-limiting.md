---
"@side-quest/last-30-days": patch
---

Fix Reddit 429 rate limiting with resilient cache fallback

- Add 429 classification (transient vs non-retryable quota/billing)
- Upgrade retry engine: exponential backoff with jitter, Retry-After and x-ratelimit-reset header parsing, 5 retries capped at 30s
- Add per-source search cache with versioned keys, configurable TTL, and stale fallback on transient 429
- Add cache concurrency safety: atomic writes and per-key file locking with stampede control
- Add --refresh and --no-cache CLI flags for cache bypass
- Add degraded UX messaging with per-source rate-limit attribution
- Add retry amplification guard (skip core-subject retry after rate-limit)
