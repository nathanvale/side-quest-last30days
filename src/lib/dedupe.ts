/** Near-duplicate detection for last-30-days skill. */

import type { RedditItem, WebSearchItem, XItem } from './schema.js'

/**
 * Normalize text for comparison.
 * Lowercase, remove punctuation, collapse whitespace.
 */
export function normalizeText(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/** Get character n-grams from text. */
export function getNgrams(text: string, n = 3): Set<string> {
	const normalized = normalizeText(text)
	if (normalized.length < n) return new Set([normalized])
	const ngrams = new Set<string>()
	for (let i = 0; i <= normalized.length - n; i++) {
		ngrams.add(normalized.slice(i, i + n))
	}
	return ngrams
}

/** Compute Jaccard similarity between two sets. */
export function jaccardSimilarity(
	set1: Set<string>,
	set2: Set<string>,
): number {
	if (set1.size === 0 || set2.size === 0) return 0.0
	let intersection = 0
	for (const item of set1) {
		if (set2.has(item)) intersection++
	}
	const union = set1.size + set2.size - intersection
	return union > 0 ? intersection / union : 0.0
}

/** Get comparable text from an item. */
function getItemText(item: RedditItem | XItem): string {
	return 'title' in item && typeof item.title === 'string'
		? item.title
		: (item as XItem).text
}

/** Find near-duplicate pairs in items. */
function findDuplicates(
	items: (RedditItem | XItem)[],
	threshold: number,
): [number, number][] {
	const duplicates: [number, number][] = []
	const ngrams = items.map((item) => getNgrams(getItemText(item)))

	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const similarity = jaccardSimilarity(ngrams[i]!, ngrams[j]!)
			if (similarity >= threshold) {
				duplicates.push([i, j])
			}
		}
	}

	return duplicates
}

/**
 * Remove near-duplicates, keeping highest-scored item.
 * Items should be pre-sorted by score descending.
 */
export function dedupeItems<T extends RedditItem | XItem>(
	items: T[],
	threshold = 0.7,
): T[] {
	if (items.length <= 1) return items

	const dupPairs = findDuplicates(items, threshold)
	const toRemove = new Set<number>()

	for (const [i, j] of dupPairs) {
		if (items[i]!.score >= items[j]!.score) {
			toRemove.add(j)
		} else {
			toRemove.add(i)
		}
	}

	return items.filter((_, idx) => !toRemove.has(idx))
}

/** Dedupe Reddit items. */
export function dedupeReddit(
	items: RedditItem[],
	threshold = 0.7,
): RedditItem[] {
	return dedupeItems(items, threshold)
}

/** Dedupe X items. */
export function dedupeX(items: XItem[], threshold = 0.7): XItem[] {
	return dedupeItems(items, threshold)
}

/** Remove duplicate WebSearch items by URL. */
export function dedupeWebsearch(items: WebSearchItem[]): WebSearchItem[] {
	const seenUrls = new Set<string>()
	const result: WebSearchItem[] = []

	for (const item of items) {
		const urlKey = item.url.toLowerCase().replace(/\/+$/, '')
		if (!seenUrls.has(urlKey)) {
			seenUrls.add(urlKey)
			result.push(item)
		}
	}

	return result
}
