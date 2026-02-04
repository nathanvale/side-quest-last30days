/** Data schemas for last30days skill. */

/** Engagement metrics. */
export interface Engagement {
	// Reddit fields
	score?: number | null
	num_comments?: number | null
	upvote_ratio?: number | null
	// X fields
	likes?: number | null
	reposts?: number | null
	replies?: number | null
	quotes?: number | null
}

/** Reddit comment. */
export interface Comment {
	score: number
	date: string | null
	author: string
	excerpt: string
	url: string
}

/** Component scores. */
export interface SubScores {
	relevance: number
	recency: number
	engagement: number
}

/** Normalized Reddit item. */
export interface RedditItem {
	id: string
	title: string
	url: string
	subreddit: string
	date: string | null
	date_confidence: string
	engagement: Engagement | null
	top_comments: Comment[]
	comment_insights: string[]
	relevance: number
	why_relevant: string
	subs: SubScores
	score: number
}

/** Normalized X item. */
export interface XItem {
	id: string
	text: string
	url: string
	author_handle: string
	date: string | null
	date_confidence: string
	engagement: Engagement | null
	relevance: number
	why_relevant: string
	subs: SubScores
	score: number
}

/** Normalized web search item (no engagement metrics). */
export interface WebSearchItem {
	id: string
	title: string
	url: string
	source_domain: string
	snippet: string
	date: string | null
	date_confidence: string
	relevance: number
	why_relevant: string
	subs: SubScores
	score: number
}

/** Full research report. */
export interface Report {
	topic: string
	range_from: string
	range_to: string
	generated_at: string
	mode: string
	openai_model_used: string | null
	xai_model_used: string | null
	reddit: RedditItem[]
	x: XItem[]
	web: WebSearchItem[]
	best_practices: string[]
	prompt_pack: string[]
	context_snippet_md: string
	reddit_error: string | null
	x_error: string | null
	web_error: string | null
	from_cache: boolean
	cache_age_hours: number | null
}

/** Serialize engagement to dict, omitting null fields. Returns null if all fields null. */
export function engagementToDict(
	eng: Engagement | null,
): Record<string, number> | null {
	if (!eng) return null
	const d: Record<string, number> = {}
	if (eng.score != null) d.score = eng.score
	if (eng.num_comments != null) d.num_comments = eng.num_comments
	if (eng.upvote_ratio != null) d.upvote_ratio = eng.upvote_ratio
	if (eng.likes != null) d.likes = eng.likes
	if (eng.reposts != null) d.reposts = eng.reposts
	if (eng.replies != null) d.replies = eng.replies
	if (eng.quotes != null) d.quotes = eng.quotes
	return Object.keys(d).length > 0 ? d : null
}

/** Serialize a Report to a plain object for JSON output. */
export function reportToDict(report: Report): Record<string, unknown> {
	const d: Record<string, unknown> = {
		topic: report.topic,
		range: { from: report.range_from, to: report.range_to },
		generated_at: report.generated_at,
		mode: report.mode,
		openai_model_used: report.openai_model_used,
		xai_model_used: report.xai_model_used,
		reddit: report.reddit.map((r) => ({
			...r,
			engagement: engagementToDict(r.engagement),
		})),
		x: report.x.map((x) => ({
			...x,
			engagement: engagementToDict(x.engagement),
		})),
		web: report.web,
		best_practices: report.best_practices,
		prompt_pack: report.prompt_pack,
		context_snippet_md: report.context_snippet_md,
	}
	if (report.reddit_error) d.reddit_error = report.reddit_error
	if (report.x_error) d.x_error = report.x_error
	if (report.web_error) d.web_error = report.web_error
	if (report.from_cache) d.from_cache = report.from_cache
	if (report.cache_age_hours != null) d.cache_age_hours = report.cache_age_hours
	return d
}

/** Create a default SubScores. */
export function defaultSubScores(): SubScores {
	return { relevance: 0, recency: 0, engagement: 0 }
}

/** Create a default RedditItem. */
export function defaultRedditItem(
	partial: Partial<RedditItem> & {
		id: string
		title: string
		url: string
		subreddit: string
	},
): RedditItem {
	return {
		date: null,
		date_confidence: 'low',
		engagement: null,
		top_comments: [],
		comment_insights: [],
		relevance: 0.5,
		why_relevant: '',
		subs: defaultSubScores(),
		score: 0,
		...partial,
	}
}

/** Create a default XItem. */
export function defaultXItem(
	partial: Partial<XItem> & {
		id: string
		text: string
		url: string
		author_handle: string
	},
): XItem {
	return {
		date: null,
		date_confidence: 'low',
		engagement: null,
		relevance: 0.5,
		why_relevant: '',
		subs: defaultSubScores(),
		score: 0,
		...partial,
	}
}

/** Create a default WebSearchItem. */
export function defaultWebSearchItem(
	partial: Partial<WebSearchItem> & {
		id: string
		title: string
		url: string
		source_domain: string
		snippet: string
	},
): WebSearchItem {
	return {
		date: null,
		date_confidence: 'low',
		relevance: 0.5,
		why_relevant: '',
		subs: defaultSubScores(),
		score: 0,
		...partial,
	}
}

/** Create a new report with metadata. */
export function createReport(
	topic: string,
	fromDate: string,
	toDate: string,
	mode: string,
	openaiModel: string | null = null,
	xaiModel: string | null = null,
): Report {
	return {
		topic,
		range_from: fromDate,
		range_to: toDate,
		generated_at: new Date().toISOString(),
		mode,
		openai_model_used: openaiModel,
		xai_model_used: xaiModel,
		reddit: [],
		x: [],
		web: [],
		best_practices: [],
		prompt_pack: [],
		context_snippet_md: '',
		reddit_error: null,
		x_error: null,
		web_error: null,
		from_cache: false,
		cache_age_hours: null,
	}
}

/** Reconstruct a Report from a serialized dict (handles cache format). */
export function reportFromDict(data: Record<string, unknown>): Report {
	const rangeData = (data.range as Record<string, string>) ?? {}
	const rangeFrom =
		rangeData.from ?? (data.range_from as string | undefined) ?? ''
	const rangeTo = rangeData.to ?? (data.range_to as string | undefined) ?? ''

	const redditItems = ((data.reddit as unknown[]) ?? []).map((r: unknown) => {
		const rd = r as Record<string, unknown>
		return defaultRedditItem({
			id: rd.id as string,
			title: rd.title as string,
			url: rd.url as string,
			subreddit: rd.subreddit as string,
			date: (rd.date as string | null) ?? null,
			date_confidence: (rd.date_confidence as string) ?? 'low',
			engagement: (rd.engagement as Engagement | null) ?? null,
			top_comments: ((rd.top_comments as unknown[]) ?? []).map(
				(c: unknown) => c as Comment,
			),
			comment_insights: (rd.comment_insights as string[]) ?? [],
			relevance: (rd.relevance as number) ?? 0.5,
			why_relevant: (rd.why_relevant as string) ?? '',
			subs: (rd.subs as SubScores) ?? defaultSubScores(),
			score: (rd.score as number) ?? 0,
		})
	})

	const xItems = ((data.x as unknown[]) ?? []).map((x: unknown) => {
		const xd = x as Record<string, unknown>
		return defaultXItem({
			id: xd.id as string,
			text: xd.text as string,
			url: xd.url as string,
			author_handle: xd.author_handle as string,
			date: (xd.date as string | null) ?? null,
			date_confidence: (xd.date_confidence as string) ?? 'low',
			engagement: (xd.engagement as Engagement | null) ?? null,
			relevance: (xd.relevance as number) ?? 0.5,
			why_relevant: (xd.why_relevant as string) ?? '',
			subs: (xd.subs as SubScores) ?? defaultSubScores(),
			score: (xd.score as number) ?? 0,
		})
	})

	const webItems = ((data.web as unknown[]) ?? []).map((w: unknown) => {
		const wd = w as Record<string, unknown>
		return defaultWebSearchItem({
			id: wd.id as string,
			title: wd.title as string,
			url: wd.url as string,
			source_domain: (wd.source_domain as string) ?? '',
			snippet: (wd.snippet as string) ?? '',
			date: (wd.date as string | null) ?? null,
			date_confidence: (wd.date_confidence as string) ?? 'low',
			relevance: (wd.relevance as number) ?? 0.5,
			why_relevant: (wd.why_relevant as string) ?? '',
			subs: (wd.subs as SubScores) ?? defaultSubScores(),
			score: (wd.score as number) ?? 0,
		})
	})

	return {
		topic: data.topic as string,
		range_from: rangeFrom,
		range_to: rangeTo,
		generated_at: data.generated_at as string,
		mode: data.mode as string,
		openai_model_used: (data.openai_model_used as string | null) ?? null,
		xai_model_used: (data.xai_model_used as string | null) ?? null,
		reddit: redditItems,
		x: xItems,
		web: webItems,
		best_practices: (data.best_practices as string[]) ?? [],
		prompt_pack: (data.prompt_pack as string[]) ?? [],
		context_snippet_md: (data.context_snippet_md as string) ?? '',
		reddit_error: (data.reddit_error as string | null) ?? null,
		x_error: (data.x_error as string | null) ?? null,
		web_error: (data.web_error as string | null) ?? null,
		from_cache: (data.from_cache as boolean) ?? false,
		cache_age_hours: (data.cache_age_hours as number | null) ?? null,
	}
}
