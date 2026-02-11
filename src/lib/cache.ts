/** Caching utilities for last-30-days skill. */

import { createHash } from 'node:crypto'
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CACHE_DIR = join(homedir(), '.cache', 'last-30-days')
const LOCK_DIR = join(CACHE_DIR, 'locks')

const DEFAULT_TTL_HOURS = 24
const MODEL_CACHE_TTL_DAYS = 7
const SEARCH_TTL_HOURS = 1
const STALE_SEARCH_TTL_HOURS = 24
const ENRICH_TTL_HOURS = 24

const LOCK_WAIT_MS = 5_000
const LOCK_POLL_MS = 100
const LOCK_STALE_MS = 60_000

/** Bump when cache record format semantics change. */
export const SEARCH_CACHE_SCHEMA_VERSION = 'v2'

/** Ensure cache directory exists. */
function ensureCacheDir(): void {
	mkdirSync(CACHE_DIR, { recursive: true })
}

/** Ensure lock directory exists. */
function ensureLockDir(): void {
	ensureCacheDir()
	mkdirSync(LOCK_DIR, { recursive: true })
}

function parseHoursEnv(name: string, fallback: number): number {
	const raw = process.env[name]
	if (!raw) return fallback
	const n = Number(raw)
	return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Configured TTL for fresh search cache. */
export function getSearchTTL(): number {
	return parseHoursEnv('LAST_30_DAYS_CACHE_TTL', SEARCH_TTL_HOURS)
}

/** Configured TTL for stale-search fallback cache. */
export function getStaleSearchTTL(): number {
	return parseHoursEnv('LAST_30_DAYS_STALE_CACHE_TTL', STALE_SEARCH_TTL_HOURS)
}

/** Configured TTL for enrichment cache. */
export function getEnrichmentTTL(): number {
	return parseHoursEnv('LAST_30_DAYS_ENRICH_CACHE_TTL', ENRICH_TTL_HOURS)
}

/** Generate a cache key from query parameters. */
export function getCacheKey(
	topic: string,
	fromDate: string,
	toDate: string,
	sources: string,
): string {
	const keyData = `${topic}|${fromDate}|${toDate}|${sources}`
	return createHash('sha256').update(keyData).digest('hex').slice(0, 16)
}

function normalizeTopic(topic: string): string {
	return topic.trim().toLowerCase().replace(/\s+/g, ' ')
}

function hashText(input: string): string {
	return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

/**
 * Generate versioned source search cache key.
 * Includes relevant dimensions to prevent stale semantic collisions.
 */
export function getSourceCacheKey(
	topic: string,
	fromDate: string,
	toDate: string,
	days: number,
	source: 'reddit' | 'x',
	depth: string,
	model: string | null,
	promptVersion: string,
): string {
	const keyData = [
		`schema=${SEARCH_CACHE_SCHEMA_VERSION}`,
		`topic=${normalizeTopic(topic)}`,
		`from=${fromDate}`,
		`to=${toDate}`,
		`days=${days}`,
		`source=${source}`,
		`depth=${depth}`,
		`model=${model ?? 'unknown'}`,
		`prompt=${promptVersion}`,
	].join('|')
	return hashText(keyData)
}

/** Generate a stable enrichment cache key for a source URL. */
export function getEnrichmentCacheKey(url: string): string {
	return hashText(`enrich|url=${url.trim()}`)
}

/** Get path to cache file. */
function getCachePath(cacheKey: string): string {
	return join(CACHE_DIR, `${cacheKey}.json`)
}

function getLockPath(cacheKey: string): string {
	return join(LOCK_DIR, `${cacheKey}.lock`)
}

/** Check if cache file exists and is within TTL. */
function isCacheValid(cachePath: string, ttlHours: number): boolean {
	if (!existsSync(cachePath)) return false
	try {
		const stat = statSync(cachePath)
		const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60)
		return ageHours < ttlHours
	} catch {
		return false
	}
}

function readCache(cachePath: string): Record<string, unknown> | null {
	try {
		return JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<
			string,
			unknown
		>
	} catch {
		return null
	}
}

/** Load data from cache if valid. */
export function loadCache(
	cacheKey: string,
	ttlHours = DEFAULT_TTL_HOURS,
): Record<string, unknown> | null {
	const cachePath = getCachePath(cacheKey)
	if (!isCacheValid(cachePath, ttlHours)) return null

	return readCache(cachePath)
}

/** Get age of cache file in hours. */
function getCacheAgeHours(cachePath: string): number | null {
	if (!existsSync(cachePath)) return null
	try {
		const stat = statSync(cachePath)
		return (Date.now() - stat.mtimeMs) / (1000 * 60 * 60)
	} catch {
		return null
	}
}

/** Load data from cache with age info. Returns [data, ageHours]. */
export function loadCacheWithAge(
	cacheKey: string,
	ttlHours = DEFAULT_TTL_HOURS,
): [Record<string, unknown> | null, number | null] {
	const cachePath = getCachePath(cacheKey)
	if (!isCacheValid(cachePath, ttlHours)) return [null, null]

	const age = getCacheAgeHours(cachePath)
	const data = readCache(cachePath)
	return data ? [data, age] : [null, null]
}

/**
 * Load stale cache with age info, if within stale TTL.
 * Intended for fallback-only paths after transient upstream failures.
 */
export function loadStaleCacheWithAge(
	cacheKey: string,
): [Record<string, unknown> | null, number | null] {
	return loadCacheWithAge(cacheKey, getStaleSearchTTL())
}

/** Save data to cache. */
export function saveCache(
	cacheKey: string,
	data: Record<string, unknown>,
): void {
	ensureCacheDir()
	const cachePath = getCachePath(cacheKey)
	const tmpPath = `${cachePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
	try {
		writeFileSync(tmpPath, JSON.stringify(data))
		renameSync(tmpPath, cachePath)
	} catch {
		// Silently fail on cache write errors
		try {
			rmSync(tmpPath, { force: true })
		} catch {
			// ignore temp cleanup errors
		}
	}
}

/** Attempt to acquire a per-key cache lock with timeout. */
export async function acquireCacheLock(
	cacheKey: string,
	waitMs = LOCK_WAIT_MS,
): Promise<boolean> {
	ensureLockDir()
	const lockPath = getLockPath(cacheKey)
	const deadline = Date.now() + Math.max(0, waitMs)

	for (;;) {
		try {
			const fd = openSync(lockPath, 'wx')
			closeSync(fd)
			return true
		} catch (err) {
			const code =
				typeof err === 'object' &&
				err &&
				'code' in err &&
				typeof (err as { code?: unknown }).code === 'string'
					? ((err as { code: string }).code as string)
					: ''

			if (code !== 'EEXIST') return false

			try {
				const ageMs = Date.now() - statSync(lockPath).mtimeMs
				if (ageMs > LOCK_STALE_MS) {
					unlinkSync(lockPath)
					continue
				}
			} catch {
				// if stat/unlink races, continue and retry
			}

			if (Date.now() >= deadline) return false
			await sleep(LOCK_POLL_MS)
		}
	}
}

/** Release a cache lock if held by this process. */
export function releaseCacheLock(cacheKey: string): void {
	const lockPath = getLockPath(cacheKey)
	try {
		unlinkSync(lockPath)
	} catch {
		// ignore release races
	}
}

/** Clear all cache files. */
export function clearCache(): void {
	if (!existsSync(CACHE_DIR)) return
	try {
		for (const f of readdirSync(CACHE_DIR)) {
			if (f.endsWith('.json')) {
				try {
					unlinkSync(join(CACHE_DIR, f))
				} catch {
					// ignore
				}
			}
		}
	} catch {
		// ignore
	}
}

// Model selection cache (longer TTL)
const MODEL_CACHE_FILE = join(CACHE_DIR, 'model_selection.json')

/** Load model selection cache. */
export function loadModelCache(): Record<string, string> {
	if (!isCacheValid(MODEL_CACHE_FILE, MODEL_CACHE_TTL_DAYS * 24)) return {}
	try {
		return JSON.parse(readFileSync(MODEL_CACHE_FILE, 'utf-8')) as Record<
			string,
			string
		>
	} catch {
		return {}
	}
}

/** Save model selection cache. */
function saveModelCache(data: Record<string, string>): void {
	ensureCacheDir()
	try {
		writeFileSync(MODEL_CACHE_FILE, JSON.stringify(data))
	} catch {
		// Silently fail
	}
}

/** Get cached model selection for a provider. */
export function getCachedModel(provider: string): string | undefined {
	const cache = loadModelCache()
	return cache[provider]
}

/** Cache model selection for a provider. */
export function setCachedModel(provider: string, model: string): void {
	const cache = loadModelCache()
	cache[provider] = model
	cache.updated_at = new Date().toISOString()
	saveModelCache(cache)
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
