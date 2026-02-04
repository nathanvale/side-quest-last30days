/** Popularity-aware scoring for last-30-days skill. */

import { recencyScore } from './dates.js'
import type { Engagement, RedditItem, WebSearchItem, XItem } from './schema.js'

// Score weights for Reddit/X (has engagement)
const WEIGHT_RELEVANCE = 0.45
const WEIGHT_RECENCY = 0.25
const WEIGHT_ENGAGEMENT = 0.3

// WebSearch weights (no engagement, reweighted to 100%)
const WEBSEARCH_WEIGHT_RELEVANCE = 0.55
const WEBSEARCH_WEIGHT_RECENCY = 0.45
const WEBSEARCH_SOURCE_PENALTY = 15

// WebSearch date confidence adjustments
const WEBSEARCH_VERIFIED_BONUS = 10
const WEBSEARCH_NO_DATE_PENALTY = 20

// Default engagement score for unknown
const DEFAULT_ENGAGEMENT = 35
const UNKNOWN_ENGAGEMENT_PENALTY = 10

/** Safe log1p that handles null and negative values. */
function log1pSafe(x: number | null | undefined): number {
	if (x == null || x < 0) return 0.0
	return Math.log1p(x)
}

/** Compute raw engagement score for Reddit item. */
function computeRedditEngagementRaw(
	engagement: Engagement | null,
): number | null {
	if (!engagement) return null
	if (engagement.score == null && engagement.num_comments == null) return null

	const score = log1pSafe(engagement.score)
	const comments = log1pSafe(engagement.num_comments)
	const ratio = (engagement.upvote_ratio ?? 0.5) * 10

	return 0.55 * score + 0.4 * comments + 0.05 * ratio
}

/** Compute raw engagement score for X item. */
function computeXEngagementRaw(engagement: Engagement | null): number | null {
	if (!engagement) return null
	if (engagement.likes == null && engagement.reposts == null) return null

	const likes = log1pSafe(engagement.likes)
	const reposts = log1pSafe(engagement.reposts)
	const replies = log1pSafe(engagement.replies)
	const quotes = log1pSafe(engagement.quotes)

	return 0.55 * likes + 0.25 * reposts + 0.15 * replies + 0.05 * quotes
}

/** Normalize a list of values to 0-100 scale. */
function normalizeTo100(
	values: (number | null)[],
	defaultVal = 50,
): (number | null)[] {
	const valid = values.filter((v): v is number => v !== null)
	if (valid.length === 0) {
		return values.map((v) => (v === null ? defaultVal : 50))
	}

	const minVal = Math.min(...valid)
	const maxVal = Math.max(...valid)
	const rangeVal = maxVal - minVal

	if (rangeVal === 0) {
		return values.map((v) => (v === null ? null : 50))
	}

	return values.map((v) => {
		if (v === null) return null
		return ((v - minVal) / rangeVal) * 100
	})
}

/** Compute scores for Reddit items. */
export function scoreRedditItems(items: RedditItem[]): RedditItem[] {
	if (items.length === 0) return items

	const engRaw = items.map((item) =>
		computeRedditEngagementRaw(item.engagement),
	)
	const engNormalized = normalizeTo100(engRaw)

	for (let i = 0; i < items.length; i++) {
		const item = items[i]!
		const relScore = Math.floor(item.relevance * 100)
		const recScore = recencyScore(item.date)
		const engScore =
			engNormalized[i] != null
				? Math.floor(engNormalized[i]!)
				: DEFAULT_ENGAGEMENT

		item.subs = { relevance: relScore, recency: recScore, engagement: engScore }

		let overall =
			WEIGHT_RELEVANCE * relScore +
			WEIGHT_RECENCY * recScore +
			WEIGHT_ENGAGEMENT * engScore

		if (engRaw[i] === null) overall -= UNKNOWN_ENGAGEMENT_PENALTY
		if (item.date_confidence === 'low') overall -= 10
		else if (item.date_confidence === 'med') overall -= 5

		item.score = Math.max(0, Math.min(100, Math.floor(overall)))
	}

	return items
}

/** Compute scores for X items. */
export function scoreXItems(items: XItem[]): XItem[] {
	if (items.length === 0) return items

	const engRaw = items.map((item) => computeXEngagementRaw(item.engagement))
	const engNormalized = normalizeTo100(engRaw)

	for (let i = 0; i < items.length; i++) {
		const item = items[i]!
		const relScore = Math.floor(item.relevance * 100)
		const recScore = recencyScore(item.date)
		const engScore =
			engNormalized[i] != null
				? Math.floor(engNormalized[i]!)
				: DEFAULT_ENGAGEMENT

		item.subs = { relevance: relScore, recency: recScore, engagement: engScore }

		let overall =
			WEIGHT_RELEVANCE * relScore +
			WEIGHT_RECENCY * recScore +
			WEIGHT_ENGAGEMENT * engScore

		if (engRaw[i] === null) overall -= UNKNOWN_ENGAGEMENT_PENALTY
		if (item.date_confidence === 'low') overall -= 10
		else if (item.date_confidence === 'med') overall -= 5

		item.score = Math.max(0, Math.min(100, Math.floor(overall)))
	}

	return items
}

/** Compute scores for WebSearch items WITHOUT engagement metrics. */
export function scoreWebsearchItems(items: WebSearchItem[]): WebSearchItem[] {
	if (items.length === 0) return items

	for (const item of items) {
		const relScore = Math.floor(item.relevance * 100)
		const recScore = recencyScore(item.date)

		item.subs = { relevance: relScore, recency: recScore, engagement: 0 }

		let overall =
			WEBSEARCH_WEIGHT_RELEVANCE * relScore +
			WEBSEARCH_WEIGHT_RECENCY * recScore

		overall -= WEBSEARCH_SOURCE_PENALTY

		if (item.date_confidence === 'high') overall += WEBSEARCH_VERIFIED_BONUS
		else if (item.date_confidence === 'low')
			overall -= WEBSEARCH_NO_DATE_PENALTY

		item.score = Math.max(0, Math.min(100, Math.floor(overall)))
	}

	return items
}

/** Sort items by score (descending), then date, then source priority. */
export function sortItems(
	items: (RedditItem | XItem | WebSearchItem)[],
): (RedditItem | XItem | WebSearchItem)[] {
	return [...items].sort((a, b) => {
		// Primary: score descending
		if (a.score !== b.score) return b.score - a.score

		// Secondary: date descending (recent first)
		const dateA = a.date ?? '0000-00-00'
		const dateB = b.date ?? '0000-00-00'
		if (dateA !== dateB) return dateB.localeCompare(dateA)

		// Tertiary: source priority (Reddit > X > WebSearch)
		const priorityA = getSourcePriority(a)
		const priorityB = getSourcePriority(b)
		if (priorityA !== priorityB) return priorityA - priorityB

		// Quaternary: text for stability
		const textA = 'title' in a ? (a.title ?? '') : 'text' in a ? a.text : ''
		const textB = 'title' in b ? (b.title ?? '') : 'text' in b ? b.text : ''
		return textA.localeCompare(textB)
	})
}

function getSourcePriority(item: RedditItem | XItem | WebSearchItem): number {
	if ('subreddit' in item) return 0 // Reddit
	if ('author_handle' in item) return 1 // X
	return 2 // WebSearch
}
