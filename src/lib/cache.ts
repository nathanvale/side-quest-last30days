/** Caching utilities for last-30-days skill. */

import { createHash } from 'node:crypto'
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CACHE_DIR = join(homedir(), '.cache', 'last-30-days')
const DEFAULT_TTL_HOURS = 24
const MODEL_CACHE_TTL_DAYS = 7

/** Ensure cache directory exists. */
function ensureCacheDir(): void {
	mkdirSync(CACHE_DIR, { recursive: true })
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

/** Get path to cache file. */
function getCachePath(cacheKey: string): string {
	return join(CACHE_DIR, `${cacheKey}.json`)
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

/** Load data from cache if valid. */
export function loadCache(
	cacheKey: string,
	ttlHours = DEFAULT_TTL_HOURS,
): Record<string, unknown> | null {
	const cachePath = getCachePath(cacheKey)
	if (!isCacheValid(cachePath, ttlHours)) return null

	try {
		return JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<
			string,
			unknown
		>
	} catch {
		return null
	}
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
	try {
		const data = JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<
			string,
			unknown
		>
		return [data, age]
	} catch {
		return [null, null]
	}
}

/** Save data to cache. */
export function saveCache(
	cacheKey: string,
	data: Record<string, unknown>,
): void {
	ensureCacheDir()
	const cachePath = getCachePath(cacheKey)
	try {
		writeFileSync(cachePath, JSON.stringify(data))
	} catch {
		// Silently fail on cache write errors
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
