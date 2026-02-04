/** Normalization of raw API data to canonical schema. */

import { getDateConfidence } from './dates.js'
import {
	type Comment,
	defaultRedditItem,
	defaultXItem,
	type Engagement,
	type RedditItem,
	type WebSearchItem,
	type XItem,
} from './schema.js'

/**
 * Hard filter: Remove items outside the date range.
 * This is the safety net - even if the prompt lets old content through.
 */
export function filterByDateRange<T extends RedditItem | XItem | WebSearchItem>(
	items: T[],
	fromDate: string,
	toDate: string,
	requireDate = false,
): T[] {
	const result: T[] = []
	for (const item of items) {
		if (item.date == null) {
			if (!requireDate) result.push(item)
			continue
		}
		if (item.date < fromDate) continue
		if (item.date > toDate) continue
		result.push(item)
	}
	return result
}

/** Normalize raw Reddit items to schema. */
export function normalizeRedditItems(
	items: Record<string, unknown>[],
	fromDate: string,
	toDate: string,
): RedditItem[] {
	return items.map((item) => {
		let engagement: Engagement | null = null
		const engRaw = item.engagement as Record<string, unknown> | undefined
		if (engRaw && typeof engRaw === 'object') {
			engagement = {
				score: (engRaw.score as number) ?? null,
				num_comments: (engRaw.num_comments as number) ?? null,
				upvote_ratio: (engRaw.upvote_ratio as number) ?? null,
			}
		}

		const topComments: Comment[] = (
			(item.top_comments as Record<string, unknown>[]) ?? []
		).map((c) => ({
			score: (c.score as number) ?? 0,
			date: (c.date as string | null) ?? null,
			author: (c.author as string) ?? '',
			excerpt: (c.excerpt as string) ?? '',
			url: (c.url as string) ?? '',
		}))

		const dateStr = (item.date as string | null) ?? null
		const dateConfidence = getDateConfidence(dateStr, fromDate, toDate)

		return defaultRedditItem({
			id: (item.id as string) ?? '',
			title: (item.title as string) ?? '',
			url: (item.url as string) ?? '',
			subreddit: (item.subreddit as string) ?? '',
			date: dateStr,
			date_confidence: dateConfidence,
			engagement,
			top_comments: topComments,
			comment_insights: (item.comment_insights as string[]) ?? [],
			relevance: (item.relevance as number) ?? 0.5,
			why_relevant: (item.why_relevant as string) ?? '',
		})
	})
}

/** Normalize raw X items to schema. */
export function normalizeXItems(
	items: Record<string, unknown>[],
	fromDate: string,
	toDate: string,
): XItem[] {
	return items.map((item) => {
		let engagement: Engagement | null = null
		const engRaw = item.engagement as Record<string, unknown> | undefined
		if (engRaw && typeof engRaw === 'object') {
			engagement = {
				likes: (engRaw.likes as number) ?? null,
				reposts: (engRaw.reposts as number) ?? null,
				replies: (engRaw.replies as number) ?? null,
				quotes: (engRaw.quotes as number) ?? null,
			}
		}

		const dateStr = (item.date as string | null) ?? null
		const dateConfidence = getDateConfidence(dateStr, fromDate, toDate)

		return defaultXItem({
			id: (item.id as string) ?? '',
			text: (item.text as string) ?? '',
			url: (item.url as string) ?? '',
			author_handle: (item.author_handle as string) ?? '',
			date: dateStr,
			date_confidence: dateConfidence,
			engagement,
			relevance: (item.relevance as number) ?? 0.5,
			why_relevant: (item.why_relevant as string) ?? '',
		})
	})
}
