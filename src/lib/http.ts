/** HTTP utilities for last-30-days skill. */

const DEFAULT_TIMEOUT = 30_000
const MAX_RETRIES = 5
const RETRY_DELAY = 1000
const MAX_RETRY_DELAY = 30_000
const MAX_JITTER_MS = 1000
const USER_AGENT = 'last-30-days-skill/1.0 (Claude Code Skill)'

export const DEBUG: boolean =
	process.env.LAST_30_DAYS_DEBUG?.toLowerCase() === '1' ||
	process.env.LAST_30_DAYS_DEBUG?.toLowerCase() === 'true'

function log(msg: string): void {
	if (DEBUG) {
		process.stderr.write(`[DEBUG] ${msg}\n`)
	}
}

/** HTTP request error with status code. */
export class HTTPError extends Error {
	status_code: number | null
	body: string | null
	method: string | null
	url: string | null
	request_id: string | null
	error_code: string | null
	error_type: string | null

	constructor(
		message: string,
		statusCode: number | null = null,
		body: string | null = null,
		meta: {
			method?: string
			url?: string
			requestId?: string
			errorCode?: string
			errorType?: string
		} = {},
	) {
		super(message)
		this.name = 'HTTPError'
		this.status_code = statusCode
		this.body = body
		this.method = meta.method ?? null
		this.url = meta.url ?? null
		this.request_id = meta.requestId ?? null
		this.error_code = meta.errorCode ?? null
		this.error_type = meta.errorType ?? null
	}
}

/** HTTP 429 error with retry metadata. */
export class RateLimitError extends HTTPError {
	retries_attempted: number
	retryable: boolean
	retry_after_ms: number | null
	ratelimit_reset_ms: number | null

	constructor(
		message: string,
		options: {
			body?: string | null
			retriesAttempted: number
			retryable: boolean
			retryAfterMs?: number | null
			ratelimitResetMs?: number | null
			method?: string
			url?: string
			requestId?: string
			errorCode?: string
			errorType?: string
		},
	) {
		super(message, 429, options.body ?? null, {
			method: options.method,
			url: options.url,
			requestId: options.requestId,
			errorCode: options.errorCode,
			errorType: options.errorType,
		})
		this.name = 'RateLimitError'
		this.retries_attempted = options.retriesAttempted
		this.retryable = options.retryable
		this.retry_after_ms = options.retryAfterMs ?? null
		this.ratelimit_reset_ms = options.ratelimitResetMs ?? null
	}
}

function parseErrorMeta(body: string | null): {
	code: string | null
	type: string | null
	message: string | null
} {
	if (!body) return { code: null, type: null, message: null }
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>
		const err = (parsed.error as Record<string, unknown> | undefined) ?? {}
		return {
			code: typeof err.code === 'string' ? err.code : null,
			type: typeof err.type === 'string' ? err.type : null,
			message: typeof err.message === 'string' ? err.message : null,
		}
	} catch {
		return { code: null, type: null, message: null }
	}
}

/** Exponential backoff with bounded jitter. */
export function backoffDelay(attempt: number): number {
	const exponential = RETRY_DELAY * 2 ** attempt
	const jitter = Math.floor(Math.random() * MAX_JITTER_MS)
	return Math.min(exponential + jitter, MAX_RETRY_DELAY)
}

/** Parse Retry-After header (seconds or HTTP date) to milliseconds. */
export function parseRetryAfterMs(
	retryAfterValue: string | null,
	nowMs: number = Date.now(),
): number | null {
	if (!retryAfterValue) return null
	const v = retryAfterValue.trim()
	if (!v) return null

	const seconds = Number(v)
	if (!Number.isNaN(seconds) && Number.isFinite(seconds) && seconds >= 0) {
		return Math.round(seconds * 1000)
	}

	const dateMs = Date.parse(v)
	if (Number.isNaN(dateMs)) return null
	return Math.max(0, dateMs - nowMs)
}

/**
 * Parse x-ratelimit-reset-* durations like "1s", "6m0s", "1m30s", or "250ms".
 * Returns null for sentinel values such as "-1" and "0".
 */
export function parseRateLimitResetMs(value: string | null): number | null {
	if (!value) return null
	const v = value.trim().toLowerCase()
	if (!v || v === '-1' || v === '0' || v === '0s' || v === '0ms') return null

	if (/^\d+(?:\.\d+)?$/.test(v)) {
		return Math.round(Number(v) * 1000)
	}

	const match = v.match(/^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+)s)?(?:(\d+)ms)?$/i)
	if (!match) return null

	const [, hours, mins, secs, millis] = match
	const totalMs =
		(Number(hours ?? 0) * 60 * 60 +
			Number(mins ?? 0) * 60 +
			Number(secs ?? 0)) *
			1000 +
		Number(millis ?? 0)

	return totalMs > 0 ? totalMs : null
}

const NON_RETRYABLE_RATE_LIMIT_CODES = new Set([
	'insufficient_quota',
	'billing_hard_limit_reached',
	'account_deactivated',
])

/** Determine if a 429 appears transient/retryable vs quota/billing hard-fail. */
export function isRetryableRateLimit(body: string | null): boolean {
	const meta = parseErrorMeta(body)
	const code = meta.code?.toLowerCase() ?? ''
	const type = meta.type?.toLowerCase() ?? ''
	const msg = meta.message?.toLowerCase() ?? ''
	const bodyLower = body?.toLowerCase() ?? ''

	if (
		NON_RETRYABLE_RATE_LIMIT_CODES.has(code) ||
		NON_RETRYABLE_RATE_LIMIT_CODES.has(type)
	) {
		return false
	}

	const nonRetryableSignals = [
		'insufficient_quota',
		'billing_hard_limit_reached',
		'quota exceeded',
		'billing',
		'payment required',
	]

	return !nonRetryableSignals.some(
		(signal) =>
			code.includes(signal) ||
			type.includes(signal) ||
			msg.includes(signal) ||
			bodyLower.includes(signal),
	)
}

function getRateLimitDelayMs(attempt: number, headers: Headers): number {
	const retryAfterMs = parseRetryAfterMs(headers.get('retry-after'))
	const resetRequestsMs = parseRateLimitResetMs(
		headers.get('x-ratelimit-reset-requests'),
	)
	const resetTokensMs = parseRateLimitResetMs(
		headers.get('x-ratelimit-reset-tokens'),
	)
	const hintedMs = Math.max(
		retryAfterMs ?? 0,
		resetRequestsMs ?? 0,
		resetTokensMs ?? 0,
	)
	return Math.min(MAX_RETRY_DELAY, Math.max(backoffDelay(attempt), hintedMs))
}

/** Make an HTTP request and return JSON response. */
export async function request(
	method: string,
	url: string,
	options: {
		headers?: Record<string, string>
		jsonData?: Record<string, unknown>
		timeout?: number
		retries?: number
	} = {},
): Promise<Record<string, unknown>> {
	const {
		headers: inputHeaders = {},
		jsonData,
		timeout = DEFAULT_TIMEOUT,
		retries = MAX_RETRIES,
	} = options

	const headers: Record<string, string> = {
		'User-Agent': USER_AGENT,
		...inputHeaders,
	}

	let body: string | undefined
	if (jsonData) {
		body = JSON.stringify(jsonData)
		headers['Content-Type'] ??= 'application/json'
	}

	log(`${method} ${url}`)
	if (jsonData) log(`Payload keys: ${Object.keys(jsonData).join(', ')}`)

	let lastError: HTTPError | null = null

	for (let attempt = 0; attempt < retries; attempt++) {
		const isFinalAttempt = attempt >= retries - 1
		try {
			const controller = new AbortController()
			const timer = setTimeout(() => controller.abort(), timeout)
			let responseBody = ''
			let response: Response

			try {
				response = await fetch(url, {
					method,
					headers,
					body,
					signal: controller.signal,
				})
				responseBody = await response.text()
			} finally {
				clearTimeout(timer)
			}

			log(`Response: ${response.status} (${responseBody.length} bytes)`)

			if (!response.ok) {
				const meta = parseErrorMeta(responseBody)
				const requestId = response.headers.get('x-request-id')
				log(
					`HTTP Error ${response.status}: ${response.statusText}` +
						(requestId ? ` request_id=${requestId}` : ''),
				)
				if (responseBody) log(`Error body: ${responseBody.slice(0, 500)}`)

				if (response.status === 429) {
					const retryable = isRetryableRateLimit(responseBody)
					const delayMs = getRateLimitDelayMs(attempt, response.headers)
					const rlError = new RateLimitError(
						retryable
							? `HTTP 429: rate limited`
							: `HTTP 429: non-retryable quota/billing limit`,
						{
							body: responseBody,
							retriesAttempted: attempt + 1,
							retryable,
							retryAfterMs: delayMs,
							ratelimitResetMs:
								parseRateLimitResetMs(
									response.headers.get('x-ratelimit-reset-requests'),
								) ??
								parseRateLimitResetMs(
									response.headers.get('x-ratelimit-reset-tokens'),
								),
							method,
							url,
							requestId: requestId ?? undefined,
							errorCode: meta.code ?? undefined,
							errorType: meta.type ?? undefined,
						},
					)
					throw rlError
				}

				throw new HTTPError(
					`HTTP ${response.status}: ${response.statusText}`,
					response.status,
					responseBody,
					{
						method,
						url,
						requestId: requestId ?? undefined,
						errorCode: meta.code ?? undefined,
						errorType: meta.type ?? undefined,
					},
				)
			}

			return responseBody
				? (JSON.parse(responseBody) as Record<string, unknown>)
				: {}
		} catch (err) {
			if (err instanceof RateLimitError) {
				lastError = err
				if (!err.retryable) throw err
				if (!isFinalAttempt) {
					const waitMs = Math.min(
						MAX_RETRY_DELAY,
						err.retry_after_ms ?? backoffDelay(attempt),
					)
					log(
						`Rate limited; retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`,
					)
					await sleep(waitMs)
					continue
				}
				throw err
			}

			if (err instanceof HTTPError) {
				lastError = err
				if (
					err.status_code &&
					err.status_code >= 400 &&
					err.status_code < 500 &&
					err.status_code !== 429
				) {
					throw err
				}
			} else if (err instanceof SyntaxError) {
				throw new HTTPError(`Invalid JSON response: ${err.message}`)
			} else {
				const name = err instanceof Error ? err.constructor.name : 'Error'
				const msg = err instanceof Error ? err.message : String(err)
				log(`Connection error: ${name}: ${msg}`)
				lastError = new HTTPError(
					`Connection error: ${name}: ${msg}`,
					null,
					null,
					{
						method,
						url,
					},
				)
			}

			if (!isFinalAttempt) {
				const waitMs = backoffDelay(attempt)
				log(`Retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`)
				await sleep(waitMs)
			}
		}
	}

	if (lastError) throw lastError
	throw new HTTPError('Request failed with no error details')
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Make a GET request. */
export async function get(
	url: string,
	headers?: Record<string, string>,
	options?: { timeout?: number },
): Promise<Record<string, unknown>> {
	return request('GET', url, { headers, ...options })
}

/** Make a POST request with JSON body. */
export async function post(
	url: string,
	jsonData: Record<string, unknown>,
	headers?: Record<string, string>,
	options?: { timeout?: number },
): Promise<Record<string, unknown>> {
	return request('POST', url, { headers, jsonData, ...options })
}

/** Fetch Reddit thread JSON. */
export async function getRedditJson(
	path: string,
): Promise<Record<string, unknown>> {
	let normalizedPath = path.startsWith('/') ? path : `/${path}`
	normalizedPath = normalizedPath.replace(/\/+$/, '')
	if (!normalizedPath.endsWith('.json')) normalizedPath += '.json'

	const url = `https://www.reddit.com${normalizedPath}?raw_json=1`
	return get(url, {
		'User-Agent': USER_AGENT,
		Accept: 'application/json',
	})
}
