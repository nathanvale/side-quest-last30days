import { describe, expect, test } from 'bun:test'

import {
	createReport,
	daysAgo,
	extractDateFromSnippet,
	extractDateFromUrl,
	extractDomain,
	getDateConfidence,
	getDateRange,
	getNgrams,
	isExcludedDomain,
	jaccardSimilarity,
	normalizeText,
	parseDate,
	recencyScore,
	renderCompact,
	renderContextSnippet,
	renderFullReport,
	scoreRedditItems,
	timestampToDate,
} from '../src/index'

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
})
