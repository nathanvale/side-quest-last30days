#!/usr/bin/env bun
/**
 * last-30-days CLI - Research a topic from the last 30 days on Reddit + X.
 *
 * Usage:
 *   last-30-days <topic> [options]
 *
 * Options:
 *   --mock           Use fixtures instead of real API calls
 *   --emit=MODE      Output mode: compact|json|md|context|path (default: compact)
 *   --sources=MODE   Source selection: auto|reddit|x|both (default: auto)
 *   --days=N         Lookback window in days (default: 30, range: 1-365)
 *   --quick          Faster research with fewer sources
 *   --deep           Comprehensive research with more sources
 *   --debug          Enable verbose debug logging
 *   --include-web    Include general web search alongside Reddit/X
 *   --refresh        Bypass cache reads and force fresh search
 *   --no-cache       Disable cache reads and writes
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cache from './lib/cache.js'
import * as config from './lib/config.js'
import { getDateRange } from './lib/dates.js'
import * as dedupe from './lib/dedupe.js'
import { RateLimitError } from './lib/http.js'
import * as models from './lib/models.js'
import * as normalize from './lib/normalize.js'
import * as openaiReddit from './lib/openai-reddit.js'
import * as redditEnrich from './lib/reddit-enrich.js'
import * as render from './lib/render.js'
import * as schema from './lib/schema.js'
import * as score from './lib/score.js'
import { ProgressDisplay } from './lib/ui.js'
import * as xaiX from './lib/xai-x.js'

/** Load a fixture file. */
function loadFixture(name: string): Record<string, unknown> {
	const scriptDir = dirname(fileURLToPath(import.meta.url))
	const fixturePath = join(scriptDir, '..', 'fixtures', name)
	try {
		return JSON.parse(readFileSync(fixturePath, 'utf-8')) as Record<
			string,
			unknown
		>
	} catch {
		return {}
	}
}

/** Print usage information and exit. */
function showHelp(): never {
	const text = `last-30-days - Research any topic from the last 30 days across Reddit, X, and web.

Usage:
  last-30-days <topic> [options]

Options:
  --emit=MODE      Output mode (default: compact)
                     compact  Markdown summary for Claude to synthesize
                     json     Full report as JSON
                     md       Full markdown report
                     context  Reusable context snippet
                     path     Print path to context file
  --sources=MODE   Source selection (default: auto)
                     auto     Use all available API keys
                     reddit   Reddit only (requires OPENAI_API_KEY)
                     x        X/Twitter only (requires XAI_API_KEY)
                     both     Reddit + X (requires both keys)
  --days=N         Lookback window in days (default: 30, range: 1-365)
  --quick          Faster research with fewer results
  --deep           Comprehensive research with more results
  --include-web    Include general web search alongside Reddit/X
  --refresh        Bypass cache reads and force fresh search
  --no-cache       Disable cache reads and writes
  --mock           Use fixture data instead of real API calls
  --debug          Enable verbose debug logging
  -h, --help       Show this help message

Config:
  API keys are loaded from environment variables or ~/.config/last-30-days/.env
    OPENAI_API_KEY   Required for Reddit search (via OpenAI Responses API)
    XAI_API_KEY      Required for X search (via xAI Responses API)

Examples:
  last-30-days "Claude Code"
  last-30-days "React Server Components" --deep --emit=json
  last-30-days "Bun 1.2" --sources=reddit --include-web
  last-30-days "Bun 1.2" --days=7 --emit=json`

	console.log(text)
	process.exit(0)
}

/** Parse days flag value as a base-10 integer. */
function parseDaysValue(value: string): number {
	if (!/^\d+$/.test(value)) return Number.NaN
	return Number(value)
}

/** Parse CLI arguments. */
function parseArgs(args: string[]) {
	let topic = ''
	let mock = false
	let emit = 'compact'
	let sources = 'auto'
	let quick = false
	let deep = false
	let debug = false
	let includeWeb = false
	let refresh = false
	let noCache = false
	let days = 30

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!
		if (arg === '--help' || arg === '-h') {
			showHelp()
		} else if (arg === '--mock') {
			mock = true
		} else if (arg.startsWith('--emit=')) {
			emit = arg.slice('--emit='.length)
		} else if (arg === '--emit') {
			const value = args[i + 1]
			if (value && !value.startsWith('-')) {
				emit = value
				i += 1
			}
		} else if (arg.startsWith('--sources=')) {
			sources = arg.slice('--sources='.length)
		} else if (arg === '--sources') {
			const value = args[i + 1]
			if (value && !value.startsWith('-')) {
				sources = value
				i += 1
			}
		} else if (arg.startsWith('--days=')) {
			days = parseDaysValue(arg.slice('--days='.length))
		} else if (arg === '--days') {
			const value = args[i + 1]
			if (!value || value.startsWith('-')) {
				days = Number.NaN
			} else {
				days = parseDaysValue(value)
				i += 1
			}
		} else if (arg === '--quick') {
			quick = true
		} else if (arg === '--deep') {
			deep = true
		} else if (arg === '--debug') {
			debug = true
		} else if (arg === '--include-web') {
			includeWeb = true
		} else if (arg === '--refresh') {
			refresh = true
		} else if (arg === '--no-cache') {
			noCache = true
		} else if (arg.startsWith('--')) {
			process.stderr.write(`Error: Unknown flag: ${arg}\n`)
			process.stderr.write('Run last-30-days --help for usage.\n')
			process.exit(1)
		} else if (!arg.startsWith('-')) {
			topic = topic ? `${topic} ${arg}` : arg
		}
	}

	const validEmits = ['compact', 'json', 'md', 'context', 'path']
	if (!validEmits.includes(emit)) {
		process.stderr.write(
			`Error: Invalid --emit value: "${emit}". Valid: ${validEmits.join(', ')}\n`,
		)
		process.exit(1)
	}

	const validSources = ['auto', 'reddit', 'x', 'both', 'web']
	if (!validSources.includes(sources)) {
		process.stderr.write(
			`Error: Invalid --sources value: "${sources}". Valid: ${validSources.join(', ')}\n`,
		)
		process.exit(1)
	}

	return {
		topic,
		mock,
		emit,
		sources,
		quick,
		deep,
		debug,
		includeWeb,
		refresh,
		noCache,
		days,
	}
}

interface SearchTaskResult {
	items: Record<string, unknown>[]
	raw: Record<string, unknown> | null
	error: string | null
	fromCache: boolean
	cacheAgeHours: number | null
	rateLimited: boolean
	usedStaleCache: boolean
}

interface CachedSearchPayload {
	items: Record<string, unknown>[]
	raw: Record<string, unknown> | null
}

function parseCachedSearchPayload(
	data: Record<string, unknown> | null,
): CachedSearchPayload | null {
	if (!data) return null
	const itemsRaw = data.items
	if (!Array.isArray(itemsRaw)) return null
	const items = itemsRaw.filter(
		(item) => item && typeof item === 'object',
	) as Record<string, unknown>[]
	const rawData =
		data.raw && typeof data.raw === 'object'
			? (data.raw as Record<string, unknown>)
			: null
	return { items, raw: rawData }
}

async function searchRedditTask(
	topic: string,
	cfg: Record<string, string | null>,
	selectedModels: Record<string, string | null>,
	fromDate: string,
	toDate: string,
	days: number,
	depth: string,
	mock: boolean,
	cacheOpts: { skipRead: boolean; skipWrite: boolean },
): Promise<SearchTaskResult> {
	const cacheKey = cache.getSourceCacheKey(
		topic,
		fromDate,
		toDate,
		days,
		'reddit',
		depth,
		selectedModels.openai ?? null,
		openaiReddit.REDDIT_PROMPT_VERSION,
	)

	// Try cache first (unless refreshing or mock)
	if (!mock && !cacheOpts.skipRead) {
		const [cached, ageHours] = cache.loadCacheWithAge(
			cacheKey,
			cache.getSearchTTL(),
		)
		const payload = parseCachedSearchPayload(cached)
		if (payload) {
			return {
				items: payload.items,
				raw: payload.raw,
				error: null,
				fromCache: true,
				cacheAgeHours: ageHours,
				rateLimited: false,
				usedStaleCache: false,
			}
		}
	}

	let lockAcquired = false
	if (!mock && !cacheOpts.skipRead) {
		lockAcquired = await cache.acquireCacheLock(cacheKey)
		if (!lockAcquired) {
			const [cachedAfterWait, ageHours] = cache.loadCacheWithAge(
				cacheKey,
				cache.getSearchTTL(),
			)
			const payload = parseCachedSearchPayload(cachedAfterWait)
			if (payload) {
				return {
					items: payload.items,
					raw: payload.raw,
					error: null,
					fromCache: true,
					cacheAgeHours: ageHours,
					rateLimited: false,
					usedStaleCache: false,
				}
			}
		}
	}

	let raw: Record<string, unknown> | null = null
	let error: string | null = null
	let rateLimited = false

	try {
		if (mock) {
			raw = loadFixture('openai_sample.json')
		} else {
			raw = await openaiReddit.searchReddit(
				cfg.OPENAI_API_KEY!,
				selectedModels.openai!,
				topic,
				fromDate,
				toDate,
				depth,
			)
		}
	} catch (e) {
		raw = { error: String(e) }
		if (e instanceof RateLimitError) {
			rateLimited = true
			error = e.retryable
				? `Rate limited after ${e.retries_attempted} retries`
				: 'OpenAI quota/billing limit reached (non-retryable 429)'

			// Stale cache fallback on transient rate-limit only.
			// Keep error null when stale cache is served so results still render.
			if (e.retryable && !cacheOpts.skipRead) {
				const [stale, staleAge] = cache.loadStaleCacheWithAge(cacheKey)
				const payload = parseCachedSearchPayload(stale)
				if (payload) {
					return {
						items: payload.items,
						raw: payload.raw,
						error: null,
						fromCache: true,
						cacheAgeHours: staleAge,
						rateLimited: true,
						usedStaleCache: true,
					}
				}
			}
		} else {
			error = `API error: ${e}`
		}
	} finally {
		if (lockAcquired) cache.releaseCacheLock(cacheKey)
	}

	const items = openaiReddit.parseRedditResponse(raw ?? {})

	// Quick retry with simpler query if few results
	// Skip if the first attempt was rate-limited (retry amplification guard)
	if (items.length < 5 && !mock && !error && !rateLimited) {
		const core = openaiReddit.extractCoreSubject(topic)
		if (core.toLowerCase() !== topic.toLowerCase()) {
			try {
				const retryRaw = await openaiReddit.searchReddit(
					cfg.OPENAI_API_KEY!,
					selectedModels.openai!,
					core,
					fromDate,
					toDate,
					depth,
				)
				const retryItems = openaiReddit.parseRedditResponse(retryRaw)
				const existingUrls = new Set(items.map((i) => i.url))
				for (const item of retryItems) {
					if (!existingUrls.has(item.url)) items.push(item)
				}
			} catch {
				// ignore retry errors
			}
		}
	}

	// Write through to cache on success (unless disabled)
	if (!mock && !cacheOpts.skipWrite && !error && items.length > 0) {
		cache.saveCache(cacheKey, { items, raw })
	}

	return {
		items,
		raw,
		error,
		fromCache: false,
		cacheAgeHours: null,
		rateLimited,
		usedStaleCache: false,
	}
}

async function searchXTask(
	topic: string,
	cfg: Record<string, string | null>,
	selectedModels: Record<string, string | null>,
	fromDate: string,
	toDate: string,
	days: number,
	depth: string,
	mock: boolean,
	cacheOpts: { skipRead: boolean; skipWrite: boolean },
): Promise<SearchTaskResult> {
	const cacheKey = cache.getSourceCacheKey(
		topic,
		fromDate,
		toDate,
		days,
		'x',
		depth,
		selectedModels.xai ?? null,
		xaiX.X_PROMPT_VERSION,
	)

	// Try cache first (unless refreshing or mock)
	if (!mock && !cacheOpts.skipRead) {
		const [cached, ageHours] = cache.loadCacheWithAge(
			cacheKey,
			cache.getSearchTTL(),
		)
		const payload = parseCachedSearchPayload(cached)
		if (payload) {
			return {
				items: payload.items,
				raw: payload.raw,
				error: null,
				fromCache: true,
				cacheAgeHours: ageHours,
				rateLimited: false,
				usedStaleCache: false,
			}
		}
	}

	let lockAcquired = false
	if (!mock && !cacheOpts.skipRead) {
		lockAcquired = await cache.acquireCacheLock(cacheKey)
		if (!lockAcquired) {
			const [cachedAfterWait, ageHours] = cache.loadCacheWithAge(
				cacheKey,
				cache.getSearchTTL(),
			)
			const payload = parseCachedSearchPayload(cachedAfterWait)
			if (payload) {
				return {
					items: payload.items,
					raw: payload.raw,
					error: null,
					fromCache: true,
					cacheAgeHours: ageHours,
					rateLimited: false,
					usedStaleCache: false,
				}
			}
		}
	}

	let raw: Record<string, unknown> | null = null
	let error: string | null = null
	let rateLimited = false

	try {
		if (mock) {
			raw = loadFixture('xai_sample.json')
		} else {
			raw = await xaiX.searchX(
				cfg.XAI_API_KEY!,
				selectedModels.xai!,
				topic,
				fromDate,
				toDate,
				depth,
			)
		}
	} catch (e) {
		raw = { error: String(e) }
		if (e instanceof RateLimitError) {
			rateLimited = true
			error = e.retryable
				? `Rate limited after ${e.retries_attempted} retries`
				: 'xAI quota/billing limit reached (non-retryable 429)'

			// Stale cache fallback on transient rate-limit only.
			// Keep error null when stale cache is served so results still render.
			if (e.retryable && !cacheOpts.skipRead) {
				const [stale, staleAge] = cache.loadStaleCacheWithAge(cacheKey)
				const payload = parseCachedSearchPayload(stale)
				if (payload) {
					return {
						items: payload.items,
						raw: payload.raw,
						error: null,
						fromCache: true,
						cacheAgeHours: staleAge,
						rateLimited: true,
						usedStaleCache: true,
					}
				}
			}
		} else {
			error = `API error: ${e}`
		}
	} finally {
		if (lockAcquired) cache.releaseCacheLock(cacheKey)
	}

	const items = xaiX.parseXResponse(raw ?? {})

	// Write through to cache on success (unless disabled)
	if (!mock && !cacheOpts.skipWrite && !error && items.length > 0) {
		cache.saveCache(cacheKey, { items, raw })
	}

	return {
		items,
		raw,
		error,
		fromCache: false,
		cacheAgeHours: null,
		rateLimited,
		usedStaleCache: false,
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2))

	if (args.debug) {
		process.env.LAST_30_DAYS_DEBUG = '1'
	}

	// Validate --days
	if (!Number.isInteger(args.days) || args.days < 1 || args.days > 365) {
		process.stderr.write(
			'Error: --days must be an integer between 1 and 365.\n',
		)
		process.exit(1)
	}

	// Determine depth
	if (args.quick && args.deep) {
		process.stderr.write('Error: Cannot use both --quick and --deep\n')
		process.exit(1)
	}
	const depth = args.quick ? 'quick' : args.deep ? 'deep' : 'default'

	if (!args.topic) {
		process.stderr.write('Error: Please provide a topic to research.\n')
		process.stderr.write('Usage: last-30-days <topic> [options]\n')
		process.stderr.write('Run last-30-days --help for full usage.\n')
		process.exit(1)
	}

	// Load config
	const cfg = config.getConfig()
	const available = config.getAvailableSources(cfg)

	// Determine sources
	let sources: string
	if (args.mock) {
		// In mock mode, simulate having both keys available
		const [effectiveSources, error] = config.validateSources(
			args.sources,
			'both',
			args.includeWeb,
		)
		sources = effectiveSources
		if (error && !error.includes('WebSearch fallback')) {
			process.stderr.write(`Error: ${error}\n`)
			process.exit(1)
		}
	} else {
		const [effectiveSources, error] = config.validateSources(
			args.sources,
			available,
			args.includeWeb,
		)
		sources = effectiveSources
		if (error) {
			if (error.includes('WebSearch fallback')) {
				process.stderr.write(`Note: ${error}\n`)
			} else {
				process.stderr.write(`Error: ${error}\n`)
				process.exit(1)
			}
		}
	}

	// Get date range
	const [fromDate, toDate] = getDateRange(args.days)
	const missingKeys = config.getMissingKeys(cfg)

	// Initialize progress
	const progress = new ProgressDisplay(args.topic, true)

	if (missingKeys !== 'none') progress.showPromo(missingKeys)

	// Select models
	let selectedModels: Record<string, string | null>
	if (args.mock) {
		const mockOpenai =
			(loadFixture('models_openai_sample.json').data as Record<
				string,
				unknown
			>[]) ?? []
		const mockXai =
			(loadFixture('models_xai_sample.json').data as Record<
				string,
				unknown
			>[]) ?? []
		selectedModels = await models.getModels(
			{ OPENAI_API_KEY: 'mock', XAI_API_KEY: 'mock', ...cfg },
			mockOpenai,
			mockXai,
		)
	} else {
		selectedModels = await models.getModels(cfg)
	}

	// Determine mode string
	const modeMap: Record<string, string> = {
		all: 'all',
		both: 'both',
		reddit: 'reddit-only',
		'reddit-web': 'reddit-web',
		x: 'x-only',
		'x-web': 'x-web',
		web: 'web-only',
	}
	const mode = modeMap[sources] ?? sources

	// Check if WebSearch is needed
	const webNeeded = ['all', 'web', 'reddit-web', 'x-web'].includes(sources)

	// Web-only mode
	if (sources === 'web') {
		progress.startWebOnly()
		progress.endWebOnly()
	}

	const runReddit = ['both', 'reddit', 'all', 'reddit-web'].includes(sources)
	const runX = ['both', 'x', 'all', 'x-web'].includes(sources)

	// Cache configuration
	const skipCacheRead = args.refresh || args.noCache
	const skipCacheWrite = args.noCache
	const cacheOpts = { skipRead: skipCacheRead, skipWrite: skipCacheWrite }

	// Run searches in parallel
	let redditItems: Record<string, unknown>[] = []
	let xItems: Record<string, unknown>[] = []
	let rawOpenai: Record<string, unknown> | null = null
	let rawXai: Record<string, unknown> | null = null
	let redditError: string | null = null
	let xError: string | null = null
	let anyFromCache = false
	let maxCacheAge: number | null = null
	let redditRateLimited = false
	let xRateLimited = false
	let redditUsedStaleCache = false
	let xUsedStaleCache = false

	const promises: Promise<void>[] = []

	if (runReddit) {
		progress.startReddit()
		promises.push(
			searchRedditTask(
				args.topic,
				cfg,
				selectedModels,
				fromDate,
				toDate,
				args.days,
				depth,
				args.mock,
				cacheOpts,
			).then((result) => {
				redditItems = result.items
				rawOpenai = result.raw
				redditError = result.error
				if (result.fromCache) {
					anyFromCache = true
					if (
						result.cacheAgeHours != null &&
						(maxCacheAge == null || result.cacheAgeHours > maxCacheAge)
					) {
						maxCacheAge = result.cacheAgeHours
					}
				}
				if (result.rateLimited) redditRateLimited = true
				if (result.usedStaleCache) redditUsedStaleCache = true
				if (result.fromCache && !result.rateLimited) {
					progress.endReddit(redditItems.length)
				} else {
					if (redditError) progress.showError(`Reddit error: ${redditError}`)
					progress.endReddit(redditItems.length)
				}
			}),
		)
	}

	if (runX) {
		progress.startX()
		promises.push(
			searchXTask(
				args.topic,
				cfg,
				selectedModels,
				fromDate,
				toDate,
				args.days,
				depth,
				args.mock,
				cacheOpts,
			).then((result) => {
				xItems = result.items
				rawXai = result.raw
				xError = result.error
				if (result.fromCache) {
					anyFromCache = true
					if (
						result.cacheAgeHours != null &&
						(maxCacheAge == null || result.cacheAgeHours > maxCacheAge)
					) {
						maxCacheAge = result.cacheAgeHours
					}
				}
				if (result.rateLimited) xRateLimited = true
				if (result.usedStaleCache) xUsedStaleCache = true
				if (result.fromCache && !result.rateLimited) {
					progress.endX(xItems.length)
				} else {
					if (xError) progress.showError(`X error: ${xError}`)
					progress.endX(xItems.length)
				}
			}),
		)
	}

	await Promise.allSettled(promises)

	const anyRateLimited = redditRateLimited || xRateLimited
	const anyUsedStaleCache = redditUsedStaleCache || xUsedStaleCache

	if (anyFromCache && !anyRateLimited) {
		progress.showCached(maxCacheAge)
	}
	if (anyRateLimited) {
		const rateLimitedSources: string[] = []
		if (redditRateLimited) rateLimitedSources.push('Reddit')
		if (xRateLimited) rateLimitedSources.push('X')
		const sourceName = rateLimitedSources.join('/')
		progress.showRateLimited(sourceName, anyUsedStaleCache, maxCacheAge)
	}

	// Enrich Reddit items
	const rawRedditEnriched: Record<string, unknown>[] = []
	if (redditItems.length > 0) {
		progress.startRedditEnrich(1, redditItems.length)
		for (let i = 0; i < redditItems.length; i++) {
			if (i > 0) progress.updateRedditEnrich(i + 1, redditItems.length)
			const item = redditItems[i]!
			const itemUrl = String(item.url ?? '')
			const enrichKey = itemUrl ? cache.getEnrichmentCacheKey(itemUrl) : ''

			if (!args.mock && enrichKey && !skipCacheRead) {
				const [cachedEnriched] = cache.loadCacheWithAge(
					enrichKey,
					cache.getEnrichmentTTL(),
				)
				const cachedItem =
					cachedEnriched &&
					typeof cachedEnriched.item === 'object' &&
					cachedEnriched.item
						? (cachedEnriched.item as Record<string, unknown>)
						: null
				if (cachedItem) {
					redditItems[i] = cachedItem
					rawRedditEnriched.push(cachedItem)
					continue
				}
			}

			try {
				if (args.mock) {
					const mockThread = loadFixture('reddit_thread_sample.json')
					redditItems[i] = await redditEnrich.enrichRedditItem(
						redditItems[i]!,
						mockThread,
					)
				} else {
					redditItems[i] = await redditEnrich.enrichRedditItem(redditItems[i]!)
					if (enrichKey && !skipCacheWrite) {
						cache.saveCache(enrichKey, {
							item: redditItems[i]!,
							cached_at: new Date().toISOString(),
						})
					}
				}
			} catch (e) {
				progress.showError(`Enrich failed: ${e}`)
			}
			rawRedditEnriched.push(redditItems[i]!)
		}
		progress.endRedditEnrich()
	}

	// Processing phase
	progress.startProcessing()

	const normalizedReddit = normalize.normalizeRedditItems(
		redditItems,
		fromDate,
		toDate,
	)
	const normalizedX = normalize.normalizeXItems(xItems, fromDate, toDate)

	const filteredReddit = normalize.filterByDateRange(
		normalizedReddit,
		fromDate,
		toDate,
	)
	const filteredX = normalize.filterByDateRange(normalizedX, fromDate, toDate)

	const scoredReddit = score.scoreRedditItems(filteredReddit, args.days)
	const scoredX = score.scoreXItems(filteredX, args.days)

	const sortedReddit = score.sortItems(scoredReddit)
	const sortedX = score.sortItems(scoredX)

	const dedupedReddit = dedupe.dedupeReddit(sortedReddit as schema.RedditItem[])
	const dedupedX = dedupe.dedupeX(sortedX as schema.XItem[])

	progress.endProcessing()

	// Create report
	const report = schema.createReport(
		args.topic,
		fromDate,
		toDate,
		mode,
		selectedModels.openai,
		selectedModels.xai,
		args.days,
	)
	report.reddit = dedupedReddit
	report.x = dedupedX
	report.reddit_error = redditError
	report.x_error = xError
	report.from_cache = anyFromCache
	report.cache_age_hours = maxCacheAge
	report.context_snippet_md = render.renderContextSnippet(report)

	// Write outputs
	try {
		render.writeOutputs(report, rawOpenai, rawXai, rawRedditEnriched)
	} catch (e) {
		if (args.debug) {
			process.stderr.write(`Warning: Could not write output files: ${e}\n`)
		}
	}

	// Show completion
	if (sources === 'web') {
		progress.showWebOnlyComplete()
	} else {
		progress.showComplete(dedupedReddit.length, dedupedX.length)
	}

	// Output result
	if (args.emit === 'compact') {
		console.log(render.renderCompact(report, 15, missingKeys))
	} else if (args.emit === 'json') {
		const dict = schema.reportToDict(report) as Record<string, unknown>
		if (webNeeded) {
			dict.web_search_instructions = {
				topic: args.topic,
				date_range: { from: fromDate, to: toDate },
				days: args.days,
				instructions:
					'Use WebSearch tool to find 8-15 relevant web pages. Exclude reddit.com, x.com, twitter.com.',
			}
		}
		console.log(JSON.stringify(dict, null, 2))
	} else if (args.emit === 'md') {
		console.log(render.renderFullReport(report))
	} else if (args.emit === 'context') {
		console.log(report.context_snippet_md)
	} else if (args.emit === 'path') {
		console.log(render.getContextPath())
	}

	// Web mode handoff: print structured instructions for Claude's WebSearch tool.
	// Unlike Reddit/X, web search runs in Claude's process, not ours.
	// See src/lib/websearch.ts module comment for architecture rationale.
	// Output WebSearch instructions if needed (skip for JSON - already embedded)
	if (webNeeded && args.emit !== 'json') {
		console.log(`\n${'='.repeat(60)}`)
		console.log('### WEBSEARCH REQUIRED ###')
		console.log('='.repeat(60))
		console.log(`Topic: ${args.topic}`)
		console.log(`Date range: ${fromDate} to ${toDate}`)
		console.log('')
		console.log(
			'Claude: Use your WebSearch tool to find 8-15 relevant web pages.',
		)
		console.log(
			'EXCLUDE: reddit.com, x.com, twitter.com (already covered above)',
		)
		console.log(
			`INCLUDE: blogs, docs, news, tutorials from the last ${args.days} days`,
		)
		console.log('')
		console.log(
			'After searching, synthesize WebSearch results WITH the Reddit/X',
		)
		console.log(
			'results above. WebSearch items should rank LOWER than comparable',
		)
		console.log('Reddit/X items (they lack engagement metrics).')
		console.log('='.repeat(60))
	}
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		process.stderr.write(`Fatal error: ${e}\n`)
		process.exit(1)
	})
