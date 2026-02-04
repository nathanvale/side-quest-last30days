/** HTTP utilities for last-30-days skill. */

const DEFAULT_TIMEOUT = 30_000
const MAX_RETRIES = 3
const RETRY_DELAY = 1000
const USER_AGENT = 'last-30-days-skill/1.0 (Claude Code Skill)'

export const DEBUG =
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

	constructor(
		message: string,
		statusCode: number | null = null,
		body: string | null = null,
	) {
		super(message)
		this.name = 'HTTPError'
		this.status_code = statusCode
		this.body = body
	}
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
		try {
			const controller = new AbortController()
			const timer = setTimeout(() => controller.abort(), timeout)

			const response = await fetch(url, {
				method,
				headers,
				body,
				signal: controller.signal,
			})

			clearTimeout(timer)

			const responseBody = await response.text()
			log(`Response: ${response.status} (${responseBody.length} bytes)`)

			if (!response.ok) {
				log(`HTTP Error ${response.status}: ${response.statusText}`)
				if (responseBody) log(`Error body: ${responseBody.slice(0, 500)}`)
				lastError = new HTTPError(
					`HTTP ${response.status}: ${response.statusText}`,
					response.status,
					responseBody,
				)

				// Don't retry client errors except rate limits
				if (
					response.status >= 400 &&
					response.status < 500 &&
					response.status !== 429
				) {
					throw lastError
				}

				if (attempt < retries - 1) {
					await sleep(RETRY_DELAY * (attempt + 1))
					continue
				}
				throw lastError
			}

			return responseBody
				? (JSON.parse(responseBody) as Record<string, unknown>)
				: {}
		} catch (err) {
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
				lastError = new HTTPError(`Connection error: ${name}: ${msg}`)
			}

			if (attempt < retries - 1) {
				await sleep(RETRY_DELAY * (attempt + 1))
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
