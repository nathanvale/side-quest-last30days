/** Reddit thread enrichment with real engagement metrics. */

import { timestampToDate } from './dates.js'
import * as http from './http.js'

/** Extract the path from a Reddit URL. */
export function extractRedditPath(url: string): string | null {
	try {
		const parsed = new URL(url)
		if (!parsed.hostname.includes('reddit.com')) return null
		return parsed.pathname
	} catch {
		return null
	}
}

/** Fetch Reddit thread JSON data. */
export async function fetchThreadData(
	url: string,
	mockData: unknown | null = null,
): Promise<unknown | null> {
	if (mockData !== null) return mockData

	const path = extractRedditPath(url)
	if (!path) return null

	try {
		return await http.getRedditJson(path)
	} catch {
		return null
	}
}

/** Parse Reddit thread JSON into structured data. */
export function parseThreadData(data: unknown): {
	submission: Record<string, unknown> | null
	comments: Record<string, unknown>[]
} {
	const result: {
		submission: Record<string, unknown> | null
		comments: Record<string, unknown>[]
	} = { submission: null, comments: [] }

	if (!Array.isArray(data) || data.length < 1) return result

	// First element is submission listing
	const submissionListing = data[0] as Record<string, unknown> | undefined
	if (submissionListing && typeof submissionListing === 'object') {
		const listingData = submissionListing.data as
			| Record<string, unknown>
			| undefined
		const children = (listingData?.children as unknown[]) ?? []
		if (children.length > 0) {
			const firstChild = children[0] as Record<string, unknown> | undefined
			const subData = (firstChild?.data as Record<string, unknown>) ?? {}
			result.submission = {
				score: subData.score as number | undefined,
				num_comments: subData.num_comments as number | undefined,
				upvote_ratio: subData.upvote_ratio as number | undefined,
				created_utc: subData.created_utc as number | undefined,
				permalink: subData.permalink as string | undefined,
				title: subData.title as string | undefined,
				selftext: String(subData.selftext ?? '').slice(0, 500),
			}
		}
	}

	// Second element is comments listing
	if (data.length >= 2) {
		const commentsListing = data[1] as Record<string, unknown> | undefined
		if (commentsListing && typeof commentsListing === 'object') {
			const listingData = commentsListing.data as
				| Record<string, unknown>
				| undefined
			const children = (listingData?.children as unknown[]) ?? []
			for (const child of children) {
				const childObj = child as Record<string, unknown>
				if (childObj.kind !== 't1') continue
				const cData = (childObj.data as Record<string, unknown>) ?? {}
				if (!cData.body) continue

				result.comments.push({
					score: (cData.score as number) ?? 0,
					created_utc: cData.created_utc as number | undefined,
					author: (cData.author as string) ?? '[deleted]',
					body: String(cData.body ?? '').slice(0, 300),
					permalink: cData.permalink as string | undefined,
				})
			}
		}
	}

	return result
}

/** Get top comments sorted by score. */
export function getTopComments(
	comments: Record<string, unknown>[],
	limit = 10,
): Record<string, unknown>[] {
	const valid = comments.filter(
		(c) => !['[deleted]', '[removed]'].includes(c.author as string),
	)
	const sorted = [...valid].sort(
		(a, b) => ((b.score as number) ?? 0) - ((a.score as number) ?? 0),
	)
	return sorted.slice(0, limit)
}

/** Extract key insights from top comments. */
export function extractCommentInsights(
	comments: Record<string, unknown>[],
	limit = 7,
): string[] {
	const insights: string[] = []
	const skipPatterns = [
		/^(this|same|agreed|exactly|yep|nope|yes|no|thanks|thank you)\.?$/,
		/^lol|lmao|haha/,
		/^\[deleted\]/,
		/^\[removed\]/,
	]

	for (const comment of comments.slice(0, limit * 2)) {
		const body = String(comment.body ?? '').trim()
		if (!body || body.length < 30) continue

		const bodyLower = body.toLowerCase()
		if (skipPatterns.some((p) => p.test(bodyLower))) continue

		let insight = body.slice(0, 150)
		if (body.length > 150) {
			let found = false
			for (let i = 50; i < insight.length; i++) {
				if ('.!?'.includes(insight[i]!)) {
					insight = insight.slice(0, i + 1)
					found = true
					break
				}
			}
			if (!found) insight = `${insight.trimEnd()}...`
		}

		insights.push(insight)
		if (insights.length >= limit) break
	}

	return insights
}

/** Enrich a Reddit item with real engagement data. */
export async function enrichRedditItem(
	item: Record<string, unknown>,
	mockThreadData: unknown | null = null,
): Promise<Record<string, unknown>> {
	const url = (item.url as string) ?? ''

	const threadData = await fetchThreadData(url, mockThreadData)
	if (!threadData) return item

	const parsed = parseThreadData(threadData)
	const { submission, comments } = parsed

	// Update engagement metrics
	if (submission) {
		item.engagement = {
			score: submission.score as number | undefined,
			num_comments: submission.num_comments as number | undefined,
			upvote_ratio: submission.upvote_ratio as number | undefined,
		}

		const createdUtc = submission.created_utc as number | undefined
		if (createdUtc) {
			item.date = timestampToDate(createdUtc)
		}
	}

	// Get top comments
	const topComments = getTopComments(comments)
	item.top_comments = topComments.map((c) => {
		const permalink = (c.permalink as string) ?? ''
		const commentUrl = permalink ? `https://reddit.com${permalink}` : ''
		return {
			score: (c.score as number) ?? 0,
			date: timestampToDate(c.created_utc as number | undefined),
			author: (c.author as string) ?? '',
			excerpt: String(c.body ?? '').slice(0, 200),
			url: commentUrl,
		}
	})

	// Extract insights
	item.comment_insights = extractCommentInsights(topComments)

	return item
}
