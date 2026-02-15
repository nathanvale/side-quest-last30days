# Changelog

## 0.1.3

### Patch Changes

- [#24](https://github.com/nathanvale/side-quest-last-30-days/pull/24) [`f7fd622`](https://github.com/nathanvale/side-quest-last-30-days/commit/f7fd62225bd789db1b85678f4513fc1ce9906f71) Thanks [@nathanvale](https://github.com/nathanvale)! - Add --outdir flag to write output files to a custom directory instead of the default ~/.local/share/last-30-days/out/. This enables parallel CLI invocations to write to isolated directories without racing on the same output path.

## 0.1.2

### Patch Changes

- [#17](https://github.com/nathanvale/side-quest-last-30-days/pull/17) [`b9611c7`](https://github.com/nathanvale/side-quest-last-30-days/commit/b9611c7034402f975cce7eed35a4a8296319878b) Thanks [@nathanvale](https://github.com/nathanvale)! - Add comprehensive smoke test prompt for end-to-end validation

- [#19](https://github.com/nathanvale/side-quest-last-30-days/pull/19) [`145ab63`](https://github.com/nathanvale/side-quest-last-30-days/commit/145ab638b122c3eb98d9bc515edcba7b0c2b35dc) Thanks [@nathanvale](https://github.com/nathanvale)! - Fix 9 critical issues from staff engineer review: improved error handling, CLI validation, type safety, and code documentation

## 0.1.1

### Patch Changes

- [#14](https://github.com/nathanvale/side-quest-last-30-days/pull/14) [`583ba17`](https://github.com/nathanvale/side-quest-last-30-days/commit/583ba172a9ed11d0490834889dd9a11d0adcbed1) Thanks [@nathanvale](https://github.com/nathanvale)! - Fix Reddit 429 rate limiting with resilient cache fallback

  - Add 429 classification (transient vs non-retryable quota/billing)
  - Upgrade retry engine: exponential backoff with jitter, Retry-After and x-ratelimit-reset header parsing, 5 retries capped at 30s
  - Add per-source search cache with versioned keys, configurable TTL, and stale fallback on transient 429
  - Add cache concurrency safety: atomic writes and per-key file locking with stampede control
  - Add --refresh and --no-cache CLI flags for cache bypass
  - Add degraded UX messaging with per-source rate-limit attribution
  - Add retry amplification guard (skip core-subject retry after rate-limit)

## 0.1.0

### Minor Changes

- [#8](https://github.com/nathanvale/side-quest-last-30-days/pull/8) [`1504d92`](https://github.com/nathanvale/side-quest-last-30-days/commit/1504d92501d0a4095ec5deabb2912bb37729cbae) Thanks [@nathanvale](https://github.com/nathanvale)! - feat: add --days=N CLI parameter for configurable lookback window (1-365, default 30)

## 0.0.1

### Patch Changes

- [#2](https://github.com/nathanvale/side-quest-last-30-days/pull/2) [`f7736c2`](https://github.com/nathanvale/side-quest-last-30-days/commit/f7736c210db080dba1239d53e3d857ce1c4aba04) Thanks [@nathanvale](https://github.com/nathanvale)! - fix: prevent CLI from hanging after successful completion

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Initial release.
