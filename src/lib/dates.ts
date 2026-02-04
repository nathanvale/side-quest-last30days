/** Date utilities for last-30-days skill. */

/**
 * Get the date range for the last N days.
 * @returns Tuple of [fromDate, toDate] as YYYY-MM-DD strings
 */
export function getDateRange(days = 30): [string, string] {
	const today = new Date()
	const from = new Date(today)
	from.setUTCDate(from.getUTCDate() - days)

	return [formatDate(from), formatDate(today)]
}

/** Format a Date as YYYY-MM-DD in UTC. */
function formatDate(d: Date): string {
	const year = d.getUTCFullYear()
	const month = String(d.getUTCMonth() + 1).padStart(2, '0')
	const day = String(d.getUTCDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

/**
 * Parse a date string in various formats.
 * Supports: YYYY-MM-DD, ISO 8601, Unix timestamp
 */
export function parseDate(dateStr: string | null | undefined): Date | null {
	if (!dateStr) return null

	// Try Unix timestamp (from Reddit)
	const ts = Number(dateStr)
	if (!Number.isNaN(ts) && String(ts) === dateStr.trim()) {
		return new Date(ts * 1000)
	}

	// Try ISO formats
	const formats = [
		/^\d{4}-\d{2}-\d{2}$/,
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+[+-]\d{2}:\d{2}$/,
	]

	for (const fmt of formats) {
		if (fmt.test(dateStr)) {
			const parsed = new Date(dateStr)
			if (!Number.isNaN(parsed.getTime())) return parsed
		}
	}

	return null
}

/** Convert Unix timestamp to YYYY-MM-DD string. */
export function timestampToDate(ts: number | null | undefined): string | null {
	if (ts == null) return null
	try {
		const dt = new Date(ts * 1000)
		if (Number.isNaN(dt.getTime())) return null
		return formatDate(dt)
	} catch {
		return null
	}
}

/**
 * Determine confidence level for a date.
 * @returns 'high', 'med', or 'low'
 */
export function getDateConfidence(
	dateStr: string | null | undefined,
	fromDate: string,
	toDate: string,
): string {
	if (!dateStr) return 'low'

	try {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return 'low'
		if (dateStr >= fromDate && dateStr <= toDate) return 'high'
		return 'low'
	} catch {
		return 'low'
	}
}

/**
 * Calculate how many days ago a date is.
 * Returns null if date is invalid or missing.
 */
export function daysAgo(dateStr: string | null | undefined): number | null {
	if (!dateStr) return null

	try {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
		const dt = new Date(`${dateStr}T00:00:00Z`)
		const today = new Date()
		const todayUtc = new Date(
			Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
		)
		const diff = todayUtc.getTime() - dt.getTime()
		return Math.floor(diff / (1000 * 60 * 60 * 24))
	} catch {
		return null
	}
}

/**
 * Calculate recency score (0-100).
 * 0 days ago = 100, maxDays ago = 0, clamped.
 */
export function recencyScore(
	dateStr: string | null | undefined,
	maxDays = 30,
): number {
	const age = daysAgo(dateStr)
	if (age == null) return 0 // Unknown date gets worst score
	if (age < 0) return 100 // Future date (treat as today)
	if (age >= maxDays) return 0
	return Math.floor(100 * (1 - age / maxDays))
}
