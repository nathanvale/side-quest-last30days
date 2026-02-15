import { describe, expect, test } from 'bun:test'

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import {
	backoffDelay,
	createReport,
	daysAgo,
	extractDateFromSnippet,
	extractDateFromUrl,
	extractDomain,
	getContextPath,
	getDateConfidence,
	getDateRange,
	getNgrams,
	HTTPError,
	isExcludedDomain,
	isModelAccessError,
	isRetryableRateLimit,
	jaccardSimilarity,
	normalizeText,
	parseDate,
	parseRateLimitResetMs,
	parseRedditResponse,
	parseRetryAfterMs,
	parseXResponse,
	RateLimitError,
	recencyScore,
	renderCompact,
	renderContextSnippet,
	renderFullReport,
	scoreRedditItems,
	supportsWebSearchFilters,
	timestampToDate,
} from '../src/index'

import {
	getEnrichmentCacheKey,
	getSourceCacheKey,
	SEARCH_CACHE_SCHEMA_VERSION,
} from '../src/lib/cache'
import { reportFromDict, reportToDict } from '../src/lib/schema'

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------
describe('dates', () => {
	test('getDateRange returns [from, to] strings', () => {
		const [from, to] = getDateRange(30)
		expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		expect(from < to).toBe(true)
	})

	test('parseDate handles YYYY-MM-DD', () => {
		const result = parseDate('2025-01-15')
		expect(result).toBeInstanceOf(Date)
		expect(result!.toISOString()).toContain('2025-01-15')
	})

	test('parseDate handles Unix timestamp as string', () => {
		// 1735689600 = 2025-01-01T00:00:00Z
		const result = parseDate('1735689600')
		expect(result).toBeInstanceOf(Date)
		expect(result!.getUTCFullYear()).toBe(2025)
	})

	test('parseDate returns null for garbage', () => {
		expect(parseDate(null)).toBeNull()
		expect(parseDate(undefined)).toBeNull()
		expect(parseDate('not-a-date')).toBeNull()
	})

	test('timestampToDate converts epoch seconds', () => {
		const result = timestampToDate(1735689600)
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
	})

	test('timestampToDate returns null for undefined', () => {
		expect(timestampToDate(undefined)).toBeNull()
	})

	test('getDateConfidence returns high for in-range dates', () => {
		const [from, to] = getDateRange(30)
		expect(getDateConfidence(to, from, to)).toBe('high')
	})

	test('getDateConfidence returns low for null', () => {
		const [from, to] = getDateRange(30)
		expect(getDateConfidence(null, from, to)).toBe('low')
	})

	test('daysAgo returns positive number for past date', () => {
		const [from] = getDateRange(30)
		expect(daysAgo(from)).toBeGreaterThanOrEqual(29)
	})

	test('recencyScore returns 0-100 range', () => {
		const [from, to] = getDateRange(30)
		const latest = recencyScore(to, 30)
		const oldest = recencyScore(from, 30)
		expect(latest).toBeGreaterThanOrEqual(0)
		expect(latest).toBeLessThanOrEqual(100)
		expect(oldest).toBeGreaterThanOrEqual(0)
		expect(oldest).toBeLessThanOrEqual(100)
		expect(latest).toBeGreaterThanOrEqual(oldest)
	})
})

// ---------------------------------------------------------------------------
// dedupe
// ---------------------------------------------------------------------------
describe('dedupe', () => {
	test('normalizeText lowercases and strips punctuation', () => {
		const result = normalizeText('Hello, World! This is a TEST.')
		expect(result).toBe('hello world this is a test')
	})

	test('getNgrams produces character n-grams', () => {
		// Default n=3, character-level
		const ngrams = getNgrams('abcde', 3)
		// "abc", "bcd", "cde" = 3
		expect(ngrams.size).toBe(3)
	})

	test('jaccardSimilarity is 1.0 for identical sets', () => {
		const a = new Set(['a', 'b', 'c'])
		expect(jaccardSimilarity(a, a)).toBeCloseTo(1.0)
	})

	test('jaccardSimilarity is 0.0 for disjoint sets', () => {
		const a = new Set(['a', 'b'])
		const b = new Set(['c', 'd'])
		expect(jaccardSimilarity(a, b)).toBeCloseTo(0.0)
	})

	test('jaccardSimilarity is ~0.5 for partial overlap', () => {
		const a = new Set(['a', 'b', 'c', 'd'])
		const b = new Set(['c', 'd', 'e', 'f'])
		// intersection=2, union=6 → 0.333
		expect(jaccardSimilarity(a, b)).toBeCloseTo(0.333, 1)
	})
})

// ---------------------------------------------------------------------------
// websearch
// ---------------------------------------------------------------------------
describe('websearch', () => {
	test('extractDateFromUrl finds YYYY/MM/DD pattern', () => {
		expect(extractDateFromUrl('https://blog.com/2025/01/15/post')).toBe('2025-01-15')
	})

	test('extractDateFromUrl finds YYYY-MM-DD pattern', () => {
		expect(extractDateFromUrl('https://example.com/articles/2025-03-20-title')).toBe('2025-03-20')
	})

	test('extractDateFromUrl returns null for no date', () => {
		expect(extractDateFromUrl('https://example.com/about')).toBeNull()
	})

	test('extractDateFromSnippet finds Month DD, YYYY', () => {
		expect(extractDateFromSnippet('Published on January 15, 2025 by author')).toBe('2025-01-15')
	})

	test('extractDateFromSnippet finds DD Month YYYY', () => {
		expect(extractDateFromSnippet('Posted 15 January 2025')).toBe('2025-01-15')
	})

	test('extractDateFromSnippet finds ISO date', () => {
		expect(extractDateFromSnippet('Updated 2025-03-20 at noon')).toBe('2025-03-20')
	})

	test('extractDomain extracts hostname without www', () => {
		expect(extractDomain('https://www.example.com/path')).toBe('example.com')
	})

	test('isExcludedDomain rejects reddit/x', () => {
		expect(isExcludedDomain('https://reddit.com/r/typescript')).toBe(true)
		expect(isExcludedDomain('https://x.com/user/status/123')).toBe(true)
		expect(isExcludedDomain('https://twitter.com/user')).toBe(true)
	})

	test('isExcludedDomain allows blogs', () => {
		expect(isExcludedDomain('https://myblog.com/post')).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------
describe('schema', () => {
	test('createReport sets required fields', () => {
		const report = createReport(
			'test topic',
			'2025-01-01',
			'2025-01-31',
			'both',
			'gpt-4o',
			'grok-3',
		)
		expect(report.topic).toBe('test topic')
		expect(report.days).toBe(30)
		expect(report.range_from).toBe('2025-01-01')
		expect(report.range_to).toBe('2025-01-31')
		expect(report.mode).toBe('both')
		expect(report.openai_model_used).toBe('gpt-4o')
		expect(report.xai_model_used).toBe('grok-3')
		expect(report.reddit).toEqual([])
		expect(report.x).toEqual([])
		expect(report.web).toEqual([])
	})

	test('createReport accepts custom days', () => {
		const report = createReport('test', '2025-01-24', '2025-01-31', 'both', null, null, 7)
		expect(report.days).toBe(7)
	})

	test('reportToDict serializes report', () => {
		const report = createReport('test', '2025-01-01', '2025-01-31', 'both', null, null)
		const dict = reportToDict(report)
		expect(dict.topic).toBe('test')
		expect(dict.days).toBe(30)
		const range = dict.range as { from: string; to: string }
		expect(range.from).toBe('2025-01-01')
		expect(range.to).toBe('2025-01-31')
		expect(Array.isArray(dict.reddit)).toBe(true)
	})

	test('reportFromDict defaults days to 30 for older serialized payloads', () => {
		const report = reportFromDict({
			topic: 'legacy-report',
			range: { from: '2025-01-01', to: '2025-01-31' },
			generated_at: '2025-01-31T00:00:00.000Z',
			mode: 'both',
			reddit: [],
			x: [],
			web: [],
		})
		expect(report.days).toBe(30)
	})

	test('reportFromDict keeps valid serialized days value', () => {
		const report = reportFromDict({
			topic: 'new-report',
			days: 14,
			range: { from: '2025-01-17', to: '2025-01-31' },
			generated_at: '2025-01-31T00:00:00.000Z',
			mode: 'both',
			reddit: [],
			x: [],
			web: [],
		})
		expect(report.days).toBe(14)
	})
})

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------
describe('scoring', () => {
	test('scoreRedditItems uses provided maxDays for recency scoring', () => {
		const [tenDaysAgo] = getDateRange(10)
		const base = {
			id: 'r1',
			title: 'Sample thread',
			url: 'https://reddit.com/r/test/comments/1',
			subreddit: 'test',
			date: tenDaysAgo,
			date_confidence: 'high',
			engagement: null,
			top_comments: [],
			comment_insights: [],
			relevance: 0,
			why_relevant: 'test',
			subs: { relevance: 0, recency: 0, engagement: 0 },
			score: 0,
		}

		const recency30 = scoreRedditItems([{ ...base }], 30)[0]!.subs.recency
		const recency7 = scoreRedditItems([{ ...base }], 7)[0]!.subs.recency
		expect(recency30).toBeGreaterThan(recency7)
	})
})

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------
describe('render', () => {
	test('renderContextSnippet uses report days in title', () => {
		const report = createReport('testing', '2025-01-24', '2025-01-31', 'both', null, null, 7)
		expect(renderContextSnippet(report)).toContain('Last 7 Days')
	})

	test('renderFullReport uses report days in heading', () => {
		const report = createReport('testing', '2025-01-24', '2025-01-31', 'both', null, null, 7)
		expect(renderFullReport(report)).toContain('Last 7 Days Research Report')
	})

	test('renderCompact sparse warning uses report days', () => {
		const report = createReport('testing', '2025-01-17', '2025-01-31', 'both', null, null, 14)
		expect(renderCompact(report)).toContain('last 14 days')
	})

	test('getContextPath returns default path when no outdir', () => {
		const path = getContextPath()
		expect(path).toContain('last-30-days')
		expect(path).toEndWith('last-30-days.context.md')
	})

	test('getContextPath uses outdir when provided', () => {
		const path = getContextPath('/tmp/custom-outdir')
		expect(path).toBe('/tmp/custom-outdir/last-30-days.context.md')
	})
})

// ---------------------------------------------------------------------------
// http: 429 classification
// ---------------------------------------------------------------------------
describe('429 classification', () => {
	test('transient rate-limit body is retryable', () => {
		const body = JSON.stringify({
			error: { type: 'rate_limit_exceeded', message: 'Rate limit reached' },
		})
		expect(isRetryableRateLimit(body)).toBe(true)
	})

	test('insufficient_quota code is non-retryable', () => {
		const body = JSON.stringify({
			error: { code: 'insufficient_quota', message: 'You exceeded your quota' },
		})
		expect(isRetryableRateLimit(body)).toBe(false)
	})

	test('billing_hard_limit_reached is non-retryable', () => {
		const body = JSON.stringify({
			error: { code: 'billing_hard_limit_reached', message: 'Billing limit' },
		})
		expect(isRetryableRateLimit(body)).toBe(false)
	})

	test('quota exceeded in message is non-retryable', () => {
		const body = JSON.stringify({
			error: { type: 'error', message: 'Quota exceeded for this org' },
		})
		expect(isRetryableRateLimit(body)).toBe(false)
	})

	test('null body is retryable (assume transient)', () => {
		expect(isRetryableRateLimit(null)).toBe(true)
	})

	test('empty body is retryable (assume transient)', () => {
		expect(isRetryableRateLimit('')).toBe(true)
	})

	test('malformed JSON body is retryable (assume transient)', () => {
		expect(isRetryableRateLimit('not json')).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// http: backoff
// ---------------------------------------------------------------------------
describe('backoff', () => {
	test('backoffDelay is bounded by MAX_RETRY_DELAY (30s)', () => {
		for (let i = 0; i < 10; i++) {
			expect(backoffDelay(i)).toBeLessThanOrEqual(30_000)
		}
	})

	test('backoffDelay is generally increasing for early attempts', () => {
		// Run multiple times to account for jitter
		const results: number[][] = []
		for (let run = 0; run < 10; run++) {
			results.push([0, 1, 2, 3, 4].map((a) => backoffDelay(a)))
		}
		// Average across runs to smooth jitter
		const avgs = [0, 1, 2, 3, 4].map(
			(i) => results.reduce((sum, r) => sum + r[i]!, 0) / results.length,
		)
		expect(avgs[1]!).toBeGreaterThan(avgs[0]!)
		expect(avgs[2]!).toBeGreaterThan(avgs[1]!)
		expect(avgs[3]!).toBeGreaterThan(avgs[2]!)
	})

	test('backoffDelay attempt 0 is at least 1000ms', () => {
		// base = 1000 * 2^0 = 1000, plus jitter [0, 1000)
		expect(backoffDelay(0)).toBeGreaterThanOrEqual(1000)
	})
})

// ---------------------------------------------------------------------------
// http: header parsing
// ---------------------------------------------------------------------------
describe('parseRetryAfterMs', () => {
	test('parses integer seconds', () => {
		expect(parseRetryAfterMs('5')).toBe(5000)
	})

	test('parses decimal seconds', () => {
		expect(parseRetryAfterMs('1.5')).toBe(1500)
	})

	test('parses zero seconds', () => {
		expect(parseRetryAfterMs('0')).toBe(0)
	})

	test('returns null for null input', () => {
		expect(parseRetryAfterMs(null)).toBeNull()
	})

	test('returns null for empty string', () => {
		expect(parseRetryAfterMs('')).toBeNull()
	})

	test('parses HTTP date format', () => {
		const futureDate = new Date(Date.now() + 10_000).toUTCString()
		const result = parseRetryAfterMs(futureDate)
		expect(result).toBeGreaterThan(0)
		expect(result!).toBeLessThan(15_000)
	})
})

describe('parseRateLimitResetMs', () => {
	test('parses "1s" to 1000ms', () => {
		expect(parseRateLimitResetMs('1s')).toBe(1000)
	})

	test('parses "6m0s" to 360000ms', () => {
		expect(parseRateLimitResetMs('6m0s')).toBe(360_000)
	})

	test('parses "1m30s" to 90000ms', () => {
		expect(parseRateLimitResetMs('1m30s')).toBe(90_000)
	})

	test('parses "250ms" to 250ms', () => {
		expect(parseRateLimitResetMs('250ms')).toBe(250)
	})

	test('parses "1h2m3s" to 3723000ms', () => {
		expect(parseRateLimitResetMs('1h2m3s')).toBe(3_723_000)
	})

	test('parses bare numeric as seconds', () => {
		expect(parseRateLimitResetMs('5')).toBe(5000)
	})

	test('returns null for sentinel "0"', () => {
		expect(parseRateLimitResetMs('0')).toBeNull()
	})

	test('returns null for sentinel "-1"', () => {
		expect(parseRateLimitResetMs('-1')).toBeNull()
	})

	test('returns null for null', () => {
		expect(parseRateLimitResetMs(null)).toBeNull()
	})

	test('returns null for empty string', () => {
		expect(parseRateLimitResetMs('')).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// http: RateLimitError shape
// ---------------------------------------------------------------------------
describe('RateLimitError', () => {
	test('extends HTTPError with correct fields', () => {
		const err = new RateLimitError('rate limited', {
			body: '{"error":{}}',
			retriesAttempted: 3,
			retryable: true,
			retryAfterMs: 5000,
			ratelimitResetMs: 10_000,
			method: 'POST',
			url: 'https://api.openai.com/v1/responses',
			requestId: 'req_123',
		})
		expect(err).toBeInstanceOf(HTTPError)
		expect(err).toBeInstanceOf(RateLimitError)
		expect(err.name).toBe('RateLimitError')
		expect(err.status_code).toBe(429)
		expect(err.retries_attempted).toBe(3)
		expect(err.retryable).toBe(true)
		expect(err.retry_after_ms).toBe(5000)
		expect(err.ratelimit_reset_ms).toBe(10_000)
		expect(err.method).toBe('POST')
		expect(err.url).toBe('https://api.openai.com/v1/responses')
		expect(err.request_id).toBe('req_123')
	})

	test('non-retryable RateLimitError has retryable=false', () => {
		const err = new RateLimitError('quota exceeded', {
			retriesAttempted: 1,
			retryable: false,
			errorCode: 'insufficient_quota',
		})
		expect(err.retryable).toBe(false)
		expect(err.error_code).toBe('insufficient_quota')
	})

	test('defaults optional fields to null', () => {
		const err = new RateLimitError('limited', {
			retriesAttempted: 1,
			retryable: true,
		})
		expect(err.retry_after_ms).toBeNull()
		expect(err.ratelimit_reset_ms).toBeNull()
		expect(err.body).toBeNull()
		expect(err.request_id).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// cache: versioned keys
// ---------------------------------------------------------------------------
describe('cache key versioning', () => {
	const base = {
		topic: 'Claude Code',
		fromDate: '2026-01-13',
		toDate: '2026-02-12',
		days: 30,
		source: 'reddit' as const,
		depth: 'default',
		model: 'gpt-4o',
		promptVersion: '2026-02-11-v1',
	}

	test('same inputs produce identical keys', () => {
		const key1 = getSourceCacheKey(
			base.topic,
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			base.depth,
			base.model,
			base.promptVersion,
		)
		const key2 = getSourceCacheKey(
			base.topic,
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			base.depth,
			base.model,
			base.promptVersion,
		)
		expect(key1).toBe(key2)
	})

	test('different topic produces different key', () => {
		const key1 = getSourceCacheKey(
			'Claude Code',
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			base.depth,
			base.model,
			base.promptVersion,
		)
		const key2 = getSourceCacheKey(
			'React',
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			base.depth,
			base.model,
			base.promptVersion,
		)
		expect(key1).not.toBe(key2)
	})

	test('different depth produces different key', () => {
		const key1 = getSourceCacheKey(
			base.topic,
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			'quick',
			base.model,
			base.promptVersion,
		)
		const key2 = getSourceCacheKey(
			base.topic,
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			'deep',
			base.model,
			base.promptVersion,
		)
		expect(key1).not.toBe(key2)
	})

	test('different source produces different key', () => {
		const key1 = getSourceCacheKey(
			base.topic,
			base.fromDate,
			base.toDate,
			base.days,
			'reddit',
			base.depth,
			base.model,
			base.promptVersion,
		)
		const key2 = getSourceCacheKey(
			base.topic,
			base.fromDate,
			base.toDate,
			base.days,
			'x',
			base.depth,
			base.model,
			base.promptVersion,
		)
		expect(key1).not.toBe(key2)
	})

	test('different model produces different key', () => {
		const key1 = getSourceCacheKey(
			base.topic,
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			base.depth,
			'gpt-4o',
			base.promptVersion,
		)
		const key2 = getSourceCacheKey(
			base.topic,
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			base.depth,
			'gpt-4o-mini',
			base.promptVersion,
		)
		expect(key1).not.toBe(key2)
	})

	test('different prompt version produces different key', () => {
		const key1 = getSourceCacheKey(
			base.topic,
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			base.depth,
			base.model,
			'2026-02-11-v1',
		)
		const key2 = getSourceCacheKey(
			base.topic,
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			base.depth,
			base.model,
			'2026-02-12-v2',
		)
		expect(key1).not.toBe(key2)
	})

	test('topic normalization: case and whitespace are ignored', () => {
		const key1 = getSourceCacheKey(
			'Claude Code',
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			base.depth,
			base.model,
			base.promptVersion,
		)
		const key2 = getSourceCacheKey(
			'claude code',
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			base.depth,
			base.model,
			base.promptVersion,
		)
		const key3 = getSourceCacheKey(
			'  Claude   Code  ',
			base.fromDate,
			base.toDate,
			base.days,
			base.source,
			base.depth,
			base.model,
			base.promptVersion,
		)
		expect(key1).toBe(key2)
		expect(key1).toBe(key3)
	})

	test('schema version constant exists', () => {
		expect(SEARCH_CACHE_SCHEMA_VERSION).toMatch(/^v\d+$/)
	})

	test('enrichment key is stable for same URL', () => {
		const url = 'https://www.reddit.com/r/typescript/comments/abc123/example/'
		expect(getEnrichmentCacheKey(url)).toBe(getEnrichmentCacheKey(url))
	})
})

// ---------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------
describe('cli', () => {
	function runCli(args: string[]) {
		const testHome = '/tmp/last-30-days-test-home'
		return Bun.spawnSync({
			cmd: [process.execPath, 'run', 'src/cli.ts', ...args],
			cwd: process.cwd(),
			env: { ...process.env, HOME: testHome },
			stdout: 'pipe',
			stderr: 'pipe',
		})
	}

	test('defaults to 30-day window in JSON output', () => {
		const result = runCli(['test topic', '--mock', '--emit=json'])
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as {
			days: number
		}
		expect(output.days).toBe(30)
	})

	test('accepts --days=7', () => {
		const result = runCli(['test topic', '--mock', '--emit=json', '--days=7'])
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as {
			days: number
		}
		expect(output.days).toBe(7)
	})

	test('accepts --days 7', () => {
		const result = runCli(['test topic', '--mock', '--emit=json', '--days', '7'])
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as {
			days: number
		}
		expect(output.days).toBe(7)
	})

	test('rejects invalid --days value', () => {
		const result = runCli(['test topic', '--mock', '--days=abc'])
		expect(result.exitCode).toBe(1)
		expect(new TextDecoder().decode(result.stderr)).toContain(
			'--days must be an integer between 1 and 365',
		)
	})

	test('rejects --days=0', () => {
		const result = runCli(['test topic', '--mock', '--days=0'])
		expect(result.exitCode).toBe(1)
		expect(new TextDecoder().decode(result.stderr)).toContain(
			'--days must be an integer between 1 and 365',
		)
	})

	test('rejects --days=366', () => {
		const result = runCli(['test topic', '--mock', '--days=366'])
		expect(result.exitCode).toBe(1)
		expect(new TextDecoder().decode(result.stderr)).toContain(
			'--days must be an integer between 1 and 365',
		)
	})

	test('rejects --days with missing value', () => {
		const result = runCli(['test topic', '--mock', '--days'])
		expect(result.exitCode).toBe(1)
		expect(new TextDecoder().decode(result.stderr)).toContain(
			'--days must be an integer between 1 and 365',
		)
	})

	test('--refresh flag is accepted', () => {
		const result = runCli(['test topic', '--mock', '--emit=json', '--refresh'])
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as {
			days: number
		}
		expect(output.days).toBe(30)
	})

	test('--no-cache flag is accepted', () => {
		const result = runCli(['test topic', '--mock', '--emit=json', '--no-cache'])
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as {
			days: number
		}
		expect(output.days).toBe(30)
	})

	test('mock output does not include from_cache when false', () => {
		const result = runCli(['test topic', '--mock', '--emit=json'])
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as {
			from_cache?: boolean
		}
		// Mock runs never hit cache, so from_cache should not appear in JSON
		expect(output.from_cache).toBeUndefined()
	})

	test('--emit json (space-separated) produces JSON output', () => {
		const result = runCli(['test topic', '--mock', '--emit', 'json'])
		expect(result.exitCode).toBe(0)
		const stdout = new TextDecoder().decode(result.stdout)
		const output = JSON.parse(stdout) as { topic: string }
		expect(output.topic).toBe('test topic')
	})

	test('--sources reddit (space-separated) works', () => {
		const result = runCli(['test topic', '--mock', '--emit=json', '--sources', 'reddit'])
		expect(result.exitCode).toBe(0)
		const stdout = new TextDecoder().decode(result.stdout)
		const output = JSON.parse(stdout) as { mode: string }
		expect(output.mode).toBe('reddit-only')
	})

	test('--emit=invalid exits with error', () => {
		const result = runCli(['test topic', '--mock', '--emit=invalid'])
		expect(result.exitCode).toBe(1)
		const stderr = new TextDecoder().decode(result.stderr)
		expect(stderr).toContain('Invalid --emit')
	})

	test('--sources=invalid exits with error', () => {
		const result = runCli(['test topic', '--mock', '--sources=invalid'])
		expect(result.exitCode).toBe(1)
		const stderr = new TextDecoder().decode(result.stderr)
		expect(stderr).toContain('Invalid --sources')
	})

	test('unknown --flag exits with error', () => {
		const result = runCli(['test topic', '--mock', '--unknown-flag'])
		expect(result.exitCode).toBe(1)
		const stderr = new TextDecoder().decode(result.stderr)
		expect(stderr).toContain('Unknown flag')
	})

	test('--emit=json with --include-web produces valid JSON', () => {
		const result = runCli(['test topic', '--mock', '--emit=json', '--include-web'])
		expect(result.exitCode).toBe(0)
		const stdout = new TextDecoder().decode(result.stdout)
		const output = JSON.parse(stdout) as Record<string, unknown>
		expect(output.topic).toBe('test topic')
		expect(output.web_search_instructions).toBeDefined()
	})

	test('--mock --include-web produces mode all', () => {
		const result = runCli(['test topic', '--mock', '--emit=json', '--include-web'])
		expect(result.exitCode).toBe(0)
		const stdout = new TextDecoder().decode(result.stdout)
		const output = JSON.parse(stdout) as { mode: string }
		expect(output.mode).toBe('all')
	})

	test('--mock --sources=reddit produces mode reddit-only', () => {
		const result = runCli(['test topic', '--mock', '--emit=json', '--sources=reddit'])
		expect(result.exitCode).toBe(0)
		const stdout = new TextDecoder().decode(result.stdout)
		const output = JSON.parse(stdout) as { mode: string }
		expect(output.mode).toBe('reddit-only')
	})

	test('--outdir writes files to specified directory', () => {
		const outdir = `/tmp/l30d-outdir-test-${Date.now()}`
		try {
			const result = runCli(['test topic', '--mock', '--emit=json', `--outdir=${outdir}`])
			expect(result.exitCode).toBe(0)
			expect(existsSync(join(outdir, 'report.json'))).toBe(true)
			expect(existsSync(join(outdir, 'report.md'))).toBe(true)
			expect(existsSync(join(outdir, 'last-30-days.context.md'))).toBe(true)
		} finally {
			rmSync(outdir, { recursive: true, force: true })
		}
	})

	test('--outdir with space-separated value works', () => {
		const outdir = `/tmp/l30d-outdir-space-${Date.now()}`
		try {
			const result = runCli(['test topic', '--mock', '--emit=json', '--outdir', outdir])
			expect(result.exitCode).toBe(0)
			expect(existsSync(join(outdir, 'report.json'))).toBe(true)
		} finally {
			rmSync(outdir, { recursive: true, force: true })
		}
	})

	test('--outdir creates directory if it does not exist', () => {
		const base = `/tmp/l30d-outdir-nested-${Date.now()}`
		const outdir = `${base}/sub/dir`
		try {
			const result = runCli(['test topic', '--mock', '--emit=json', `--outdir=${outdir}`])
			expect(result.exitCode).toBe(0)
			expect(existsSync(join(outdir, 'report.json'))).toBe(true)
		} finally {
			rmSync(base, { recursive: true, force: true })
		}
	})

	test('--emit=path with --outdir returns correct path', () => {
		const outdir = `/tmp/l30d-outdir-path-${Date.now()}`
		try {
			const result = runCli(['test topic', '--mock', '--emit=path', `--outdir=${outdir}`])
			expect(result.exitCode).toBe(0)
			const stdout = new TextDecoder().decode(result.stdout).trim()
			expect(stdout).toBe(join(outdir, 'last-30-days.context.md'))
		} finally {
			rmSync(outdir, { recursive: true, force: true })
		}
	})

	test('default behavior unchanged when --outdir omitted', () => {
		const result = runCli(['test topic', '--mock', '--emit=path'])
		expect(result.exitCode).toBe(0)
		const stdout = new TextDecoder().decode(result.stdout).trim()
		// Default path should use ~/.local/share/last-30-days/out/ (under test HOME)
		expect(stdout).toContain('last-30-days')
		expect(stdout).toContain('last-30-days.context.md')
		expect(stdout).not.toContain('/tmp/l30d-outdir')
	})
})

// ---------------------------------------------------------------------------
// isModelAccessError: 404 handling
// ---------------------------------------------------------------------------
describe('isModelAccessError 404', () => {
	test('returns true for 404 status', () => {
		const error = new HTTPError('Not Found')
		error.status_code = 404
		error.body = 'model not found'
		expect(isModelAccessError(error)).toBe(true)
	})

	test('returns true for 404 with empty body', () => {
		const error = new HTTPError('Not Found')
		error.status_code = 404
		error.body = ''
		expect(isModelAccessError(error)).toBe(true)
	})

	test('returns true for 404 with null body', () => {
		const error = new HTTPError('Not Found')
		error.status_code = 404
		expect(isModelAccessError(error)).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// openai-reddit: isModelAccessError
// ---------------------------------------------------------------------------
describe('isModelAccessError', () => {
	test('detects "not supported" as access error', () => {
		const err = new HTTPError(
			'bad request',
			400,
			'The parameter "filters" is not supported with this model.',
		)
		expect(isModelAccessError(err)).toBe(true)
	})

	test('detects "unsupported" as access error', () => {
		const err = new HTTPError('bad request', 400, 'Unsupported parameter: filters')
		expect(isModelAccessError(err)).toBe(true)
	})

	test('detects "does not have access" as access error', () => {
		const err = new HTTPError(
			'bad request',
			400,
			'Your organization does not have access to this model.',
		)
		expect(isModelAccessError(err)).toBe(true)
	})

	test('returns false for non-400 status', () => {
		const err = new HTTPError('server error', 500, 'not supported')
		expect(isModelAccessError(err)).toBe(false)
	})

	test('returns false for 400 with unrelated body', () => {
		const err = new HTTPError('bad request', 400, 'Invalid JSON in request body.')
		expect(isModelAccessError(err)).toBe(false)
	})

	test('returns false for 400 with no body', () => {
		const err = new HTTPError('bad request', 400)
		expect(isModelAccessError(err)).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// openai-reddit: supportsWebSearchFilters
// ---------------------------------------------------------------------------
describe('supportsWebSearchFilters', () => {
	test('gpt-5 supports filters', () => {
		expect(supportsWebSearchFilters('gpt-5')).toBe(true)
	})

	test('gpt-5.2 supports filters', () => {
		expect(supportsWebSearchFilters('gpt-5.2')).toBe(true)
	})

	test('gpt-5.2.1 supports filters', () => {
		expect(supportsWebSearchFilters('gpt-5.2.1')).toBe(true)
	})

	test('gpt-4o supports filters', () => {
		expect(supportsWebSearchFilters('gpt-4o')).toBe(true)
	})

	test('gpt-4o-mini does NOT support filters', () => {
		expect(supportsWebSearchFilters('gpt-4o-mini')).toBe(false)
	})

	test('gpt-4o-2024-08-06 does NOT support filters', () => {
		expect(supportsWebSearchFilters('gpt-4o-2024-08-06')).toBe(false)
	})

	test('is case-insensitive', () => {
		expect(supportsWebSearchFilters('GPT-5.2')).toBe(true)
		expect(supportsWebSearchFilters('GPT-4o')).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// parser robustness: NaN guards
// ---------------------------------------------------------------------------
describe('parser NaN guards', () => {
	test('parseRedditResponse handles non-numeric relevance', () => {
		const resp = {
			output: [
				{
					type: 'message',
					content: [
						{
							type: 'output_text',
							text: JSON.stringify({
								items: [
									{
										title: 'Test post',
										url: 'https://www.reddit.com/r/test/comments/abc123/test/',
										subreddit: 'test',
										relevance: 'high',
										why_relevant: 'test',
									},
								],
							}),
						},
					],
				},
			],
		}
		const items = parseRedditResponse(resp)
		expect(items.length).toBe(1)
		const rel = items[0]!.relevance as number
		expect(Number.isFinite(rel)).toBe(true)
		expect(rel).toBe(0.5)
	})

	test('parseXResponse handles non-numeric relevance', () => {
		const resp = {
			output: [
				{
					type: 'message',
					content: [
						{
							type: 'output_text',
							text: JSON.stringify({
								items: [
									{
										text: 'Test post',
										url: 'https://x.com/user/status/123',
										author_handle: 'user',
										relevance: 'very high',
									},
								],
							}),
						},
					],
				},
			],
		}
		const items = parseXResponse(resp)
		expect(items.length).toBe(1)
		const rel = items[0]!.relevance as number
		expect(Number.isFinite(rel)).toBe(true)
		expect(rel).toBe(0.5)
	})

	test('parseXResponse handles non-numeric engagement', () => {
		const resp = {
			output: [
				{
					type: 'message',
					content: [
						{
							type: 'output_text',
							text: JSON.stringify({
								items: [
									{
										text: 'Test post',
										url: 'https://x.com/user/status/123',
										author_handle: 'user',
										relevance: 0.8,
										engagement: { likes: '1k', reposts: 'many' },
									},
								],
							}),
						},
					],
				},
			],
		}
		const items = parseXResponse(resp)
		expect(items.length).toBe(1)
		const eng = items[0]!.engagement as Record<string, unknown>
		expect(eng.likes).toBeNull()
		expect(eng.reposts).toBeNull()
	})

	test('parseXResponse preserves zero engagement values', () => {
		const resp = {
			output: [
				{
					type: 'message',
					content: [
						{
							type: 'output_text',
							text: JSON.stringify({
								items: [
									{
										text: 'Test post',
										url: 'https://x.com/user/status/123',
										author_handle: 'user',
										relevance: 0.8,
										engagement: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
									},
								],
							}),
						},
					],
				},
			],
		}
		const items = parseXResponse(resp)
		expect(items.length).toBe(1)
		const eng = items[0]!.engagement as Record<string, unknown>
		expect(eng.likes).toBe(0)
		expect(eng.reposts).toBe(0)
		expect(eng.replies).toBe(0)
		expect(eng.quotes).toBe(0)
	})

	test('scoreRedditItems produces valid scores with NaN relevance', () => {
		const items = [
			{
				id: 'R1',
				title: 'Test',
				url: 'u',
				subreddit: 's',
				date: '2026-02-01',
				date_confidence: 'high',
				engagement: { score: 100, num_comments: 50, upvote_ratio: 0.95 },
				top_comments: [],
				comment_insights: [],
				relevance: NaN,
				why_relevant: '',
				subs: { relevance: 0, recency: 0, engagement: 0 },
				score: 0,
			},
		]
		const scored = scoreRedditItems(items)
		expect(Number.isFinite(scored[0]!.score)).toBe(true)
		expect(scored[0]!.score).toBeGreaterThanOrEqual(0)
		expect(scored[0]!.score).toBeLessThanOrEqual(100)
	})
})
