/**
 * @side-quest/last-30-days
 *
 * Research any topic from the last 30 days across Reddit, X, and web.
 * Engagement-ranked results with scoring and deduplication.
 */

// Cache
export {
	acquireCacheLock,
	getCacheKey,
	getEnrichmentCacheKey,
	getEnrichmentTTL,
	getSearchTTL,
	getSourceCacheKey,
	getStaleSearchTTL,
	loadCache,
	loadCacheWithAge,
	loadStaleCacheWithAge,
	releaseCacheLock,
	SEARCH_CACHE_SCHEMA_VERSION,
	saveCache,
} from './lib/cache.js'
// Config
export { getAvailableSources, getConfig, getMissingKeys } from './lib/config.js'
// Date utilities
export {
	daysAgo,
	getDateConfidence,
	getDateRange,
	parseDate,
	recencyScore,
	timestampToDate,
} from './lib/dates.js'
// Deduplication
export {
	dedupeItems,
	dedupeReddit,
	dedupeWebsearch,
	dedupeX,
	getNgrams,
	jaccardSimilarity,
	normalizeText,
} from './lib/dedupe.js'
// HTTP / retry
export {
	backoffDelay,
	HTTPError,
	isRetryableRateLimit,
	parseRateLimitResetMs,
	parseRetryAfterMs,
	RateLimitError,
} from './lib/http.js'
// Normalization
export {
	filterByDateRange,
	normalizeRedditItems,
	normalizeXItems,
} from './lib/normalize.js'
// Rendering
export {
	renderCompact,
	renderContextSnippet,
	renderFullReport,
	writeOutputs,
} from './lib/render.js'
// Schema types
export type {
	Comment,
	Engagement,
	RedditItem,
	Report,
	SubScores,
	WebSearchItem,
	XItem,
} from './lib/schema.js'
// Schema factories
export { createReport } from './lib/schema.js'
// Scoring
export {
	scoreRedditItems,
	scoreWebsearchItems,
	scoreXItems,
	sortItems,
} from './lib/score.js'
// WebSearch
export {
	extractDateFromSnippet,
	extractDateFromUrl,
	extractDateSignals,
	extractDomain,
	isExcludedDomain,
	normalizeWebsearchItems,
	parseWebsearchResults,
} from './lib/websearch.js'
