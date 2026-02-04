/**
 * WebSearch module for last30days skill.
 *
 * WebSearch uses Claude's built-in WebSearch tool, which runs INSIDE Claude Code.
 * Unlike Reddit/X which use external APIs, WebSearch results are obtained by Claude
 * directly and passed to this module for normalization and scoring.
 */

import { defaultWebSearchItem, type WebSearchItem } from './schema.js'

/** Month name mappings for date parsing. */
const MONTH_MAP: Record<string, number> = {
	jan: 1,
	january: 1,
	feb: 2,
	february: 2,
	mar: 3,
	march: 3,
	apr: 4,
	april: 4,
	may: 5,
	jun: 6,
	june: 6,
	jul: 7,
	july: 7,
	aug: 8,
	august: 8,
	sep: 9,
	sept: 9,
	september: 9,
	oct: 10,
	october: 10,
	nov: 11,
	november: 11,
	dec: 12,
	december: 12,
}

/**
 * Try to extract a date from URL path.
 * Looks for patterns like /2026/01/24/, /2026-01-24/, /20260124/
 */
export function extractDateFromUrl(url: string): string | null {
	// Pattern 1: /YYYY/MM/DD/
	let match = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//)
	if (match) {
		const [, year, month, day] = match
		if (isValidDate(Number(year), Number(month), Number(day))) {
			return `${year}-${month}-${day}`
		}
	}

	// Pattern 2: /YYYY-MM-DD/ or /YYYY-MM-DD-
	match = url.match(/\/(\d{4})-(\d{2})-(\d{2})[-/]/)
	if (match) {
		const [, year, month, day] = match
		if (isValidDate(Number(year), Number(month), Number(day))) {
			return `${year}-${month}-${day}`
		}
	}

	// Pattern 3: /YYYYMMDD/ (compact)
	match = url.match(/\/(\d{4})(\d{2})(\d{2})\//)
	if (match) {
		const [, year, month, day] = match
		if (isValidDate(Number(year), Number(month), Number(day))) {
			return `${year}-${month}-${day}`
		}
	}

	return null
}

function isValidDate(year: number, month: number, day: number): boolean {
	return (
		year >= 2020 &&
		year <= 2030 &&
		month >= 1 &&
		month <= 12 &&
		day >= 1 &&
		day <= 31
	)
}

function pad2(n: number): string {
	return String(n).padStart(2, '0')
}

function formatToday(): string {
	const now = new Date()
	return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

function formatDaysAgo(days: number): string {
	const d = new Date()
	d.setDate(d.getDate() - days)
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * Try to extract a date from text snippet or title.
 * Looks for patterns like "January 24, 2026", "24 January 2026", "3 days ago"
 */
export function extractDateFromSnippet(text: string): string | null {
	if (!text) return null

	const textLower = text.toLowerCase()

	// Pattern 1: Month DD, YYYY (e.g., "January 24, 2026")
	const monthDayYear = textLower.match(
		/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/,
	)
	if (monthDayYear) {
		const [, monthStr, dayStr, yearStr] = monthDayYear
		const month = MONTH_MAP[monthStr!.slice(0, 3)]
		const day = Number(dayStr)
		const year = Number(yearStr)
		if (month && isValidDate(year, month, day)) {
			return `${year}-${pad2(month)}-${pad2(day)}`
		}
	}

	// Pattern 2: DD Month YYYY (e.g., "24 January 2026")
	const dayMonthYear = textLower.match(
		/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/,
	)
	if (dayMonthYear) {
		const [, dayStr, monthStr, yearStr] = dayMonthYear
		const month = MONTH_MAP[monthStr!.slice(0, 3)]
		const day = Number(dayStr)
		const year = Number(yearStr)
		if (month && isValidDate(year, month, day)) {
			return `${year}-${pad2(month)}-${pad2(day)}`
		}
	}

	// Pattern 3: YYYY-MM-DD (ISO format)
	const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
	if (isoMatch) {
		const [, year, month, day] = isoMatch
		if (isValidDate(Number(year), Number(month), Number(day))) {
			return `${year}-${month}-${day}`
		}
	}

	// Pattern 4: Relative dates
	if (textLower.includes('yesterday')) return formatDaysAgo(1)
	if (textLower.includes('today')) return formatToday()

	const daysAgoMatch = textLower.match(/\b(\d+)\s*days?\s*ago\b/)
	if (daysAgoMatch) {
		const days = Number(daysAgoMatch[1])
		if (days <= 60) return formatDaysAgo(days)
	}

	const hoursAgoMatch = textLower.match(/\b(\d+)\s*hours?\s*ago\b/)
	if (hoursAgoMatch) return formatToday()

	if (textLower.includes('last week')) return formatDaysAgo(7)
	if (textLower.includes('this week')) return formatDaysAgo(3)

	return null
}

/**
 * Extract date from any available signal.
 * Tries URL first (most reliable), then snippet, then title.
 * @returns [dateString, confidence]
 */
export function extractDateSignals(
	url: string,
	snippet: string,
	title: string,
): [string | null, string] {
	const urlDate = extractDateFromUrl(url)
	if (urlDate) return [urlDate, 'high']

	const snippetDate = extractDateFromSnippet(snippet)
	if (snippetDate) return [snippetDate, 'med']

	const titleDate = extractDateFromSnippet(title)
	if (titleDate) return [titleDate, 'med']

	return [null, 'low']
}

/** Domains to exclude (Reddit and X are handled separately). */
const EXCLUDED_DOMAINS = new Set([
	'reddit.com',
	'www.reddit.com',
	'old.reddit.com',
	'twitter.com',
	'www.twitter.com',
	'x.com',
	'www.x.com',
	'mobile.twitter.com',
])

/** Extract the domain from a URL. */
export function extractDomain(url: string): string {
	try {
		const parsed = new URL(url)
		let domain = parsed.hostname.toLowerCase()
		if (domain.startsWith('www.')) domain = domain.slice(4)
		return domain
	} catch {
		return ''
	}
}

/** Check if URL is from an excluded domain (Reddit/X). */
export function isExcludedDomain(url: string): boolean {
	try {
		const parsed = new URL(url)
		return EXCLUDED_DOMAINS.has(parsed.hostname.toLowerCase())
	} catch {
		return false
	}
}

/**
 * Parse WebSearch results into normalized format.
 * Uses "Date Detective" approach with hard date filtering.
 */
export function parseWebsearchResults(
	results: Record<string, unknown>[],
	_topic: string,
	fromDate = '',
	toDate = '',
): Record<string, unknown>[] {
	const items: Record<string, unknown>[] = []

	for (let i = 0; i < results.length; i++) {
		const result = results[i]
		if (!result || typeof result !== 'object') continue

		const url = String(result.url ?? '')
		if (!url) continue
		if (isExcludedDomain(url)) continue

		const title = String(result.title ?? '').trim()
		const snippet = String(result.snippet ?? result.description ?? '').trim()
		if (!title && !snippet) continue

		// Date detection
		let date = result.date as string | null | undefined
		let dateConfidence = 'low'

		if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
			dateConfidence = 'med'
		} else {
			const [extractedDate, confidence] = extractDateSignals(
				url,
				snippet,
				title,
			)
			if (extractedDate) {
				date = extractedDate
				dateConfidence = confidence
			}
		}

		// Hard filter: verified old date
		if (date && fromDate && date < fromDate) continue
		// Hard filter: future date
		if (date && toDate && date > toDate) continue

		// Parse relevance
		let relevance = 0.5
		try {
			relevance = Math.min(1.0, Math.max(0.0, Number(result.relevance ?? 0.5)))
		} catch {
			relevance = 0.5
		}
		if (Number.isNaN(relevance)) relevance = 0.5

		items.push({
			id: `W${i + 1}`,
			title: title.slice(0, 200),
			url,
			source_domain: extractDomain(url),
			snippet: snippet.slice(0, 500),
			date: date ?? null,
			date_confidence: dateConfidence,
			relevance,
			why_relevant: String(result.why_relevant ?? '').trim(),
		})
	}

	return items
}

/** Convert parsed dicts to WebSearchItem objects. */
export function normalizeWebsearchItems(
	items: Record<string, unknown>[],
	_fromDate: string,
	_toDate: string,
): WebSearchItem[] {
	return items.map((item) =>
		defaultWebSearchItem({
			id: item.id as string,
			title: item.title as string,
			url: item.url as string,
			source_domain: item.source_domain as string,
			snippet: item.snippet as string,
			date: (item.date as string | null) ?? null,
			date_confidence: (item.date_confidence as string) ?? 'low',
			relevance: (item.relevance as number) ?? 0.5,
			why_relevant: (item.why_relevant as string) ?? '',
		}),
	)
}
