/** OpenAI Responses API client for Reddit discovery. */

import * as http from './http.js'

/** Fallback models when the selected model isn't accessible. */
const MODEL_FALLBACK_ORDER = ['gpt-4o', 'gpt-4o-mini']

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

/** Cache-busting version for Reddit search prompt behavior. */
export const REDDIT_PROMPT_VERSION = '2026-02-11-v1'

/** Depth configurations: [min, max] threads to request. */
const DEPTH_CONFIG: Record<string, [number, number]> = {
	quick: [15, 25],
	default: [30, 50],
	deep: [70, 100],
}

const REDDIT_SEARCH_PROMPT = `Find Reddit discussion threads about: {topic}

STEP 1: EXTRACT THE CORE SUBJECT
Get the MAIN NOUN/PRODUCT/TOPIC:
- "best nano banana prompting practices" → "nano banana"
- "killer features of clawdbot" → "clawdbot"
- "top Claude Code skills" → "Claude Code"
DO NOT include "best", "top", "tips", "practices", "features" in your search.

STEP 2: SEARCH BROADLY
Search for the core subject:
1. "[core subject] site:reddit.com"
2. "reddit [core subject]"
3. "[core subject] reddit"

Return as many relevant threads as you find. We filter by date server-side.

STEP 3: INCLUDE ALL MATCHES
- Include ALL threads about the core subject
- Set date to "YYYY-MM-DD" if you can determine it, otherwise null
- We verify dates and filter old content server-side
- DO NOT pre-filter aggressively - include anything relevant

REQUIRED: URLs must contain "/r/" AND "/comments/"
REJECT: developers.reddit.com, business.reddit.com

Find {min_items}-{max_items} threads. Return MORE rather than fewer.

Return JSON:
{
  "items": [
    {
      "title": "Thread title",
      "url": "https://www.reddit.com/r/sub/comments/xyz/title/",
      "subreddit": "subreddit_name",
      "date": "YYYY-MM-DD or null",
      "why_relevant": "Why relevant",
      "relevance": 0.85
    }
  ]
}`

/** Models known to support the `filters` param on web_search. */
export function supportsWebSearchFilters(model: string): boolean {
	const m = model.toLowerCase()
	if (/^gpt-5(\.\d+)*$/.test(m)) return true
	if (m === 'gpt-4o') return true
	return false
}

/** Check if error is due to model access/verification or feature-incompatibility issues. */
export function isModelAccessError(error: http.HTTPError): boolean {
	if (error.status_code !== 400) return false
	if (!error.body) return false
	const bodyLower = error.body.toLowerCase()
	return [
		'verified',
		'organization must be',
		'does not have access',
		'not available',
		'not found',
		'not supported',
		'unsupported',
	].some((phrase) => bodyLower.includes(phrase))
}

/** Extract core subject from verbose query for retry. */
export function extractCoreSubject(topic: string): string {
	const noise = new Set([
		'best',
		'top',
		'how',
		'to',
		'tips',
		'for',
		'practices',
		'features',
		'killer',
		'guide',
		'tutorial',
		'recommendations',
		'advice',
		'prompting',
		'using',
		'with',
		'the',
		'of',
		'in',
		'on',
	])
	const words = topic.toLowerCase().split(/\s+/)
	const result = words.filter((w) => !noise.has(w))
	return result.slice(0, 3).join(' ') || topic
}

/** Search Reddit for relevant threads using OpenAI Responses API. */
export async function searchReddit(
	apiKey: string,
	model: string,
	topic: string,
	fromDate: string,
	toDate: string,
	depth = 'default',
	mockResponse: Record<string, unknown> | null = null,
): Promise<Record<string, unknown>> {
	if (mockResponse !== null) return mockResponse

	const [minItems, maxItems] = DEPTH_CONFIG[depth] ?? DEPTH_CONFIG.default!

	const headers = {
		Authorization: `Bearer ${apiKey}`,
		'Content-Type': 'application/json',
	}

	const timeout =
		depth === 'quick' ? 90_000 : depth === 'default' ? 120_000 : 180_000

	const modelsToTry = [
		model,
		...MODEL_FALLBACK_ORDER.filter((m) => m !== model),
	]

	const inputText = REDDIT_SEARCH_PROMPT.replace('{topic}', topic)
		.replace('{from_date}', fromDate)
		.replace('{to_date}', toDate)
		.replace('{min_items}', String(minItems))
		.replace('{max_items}', String(maxItems))

	let lastError: http.HTTPError | null = null

	for (const currentModel of modelsToTry) {
		const webSearchTool: Record<string, unknown> = { type: 'web_search' }
		if (supportsWebSearchFilters(currentModel)) {
			webSearchTool.filters = { allowed_domains: ['reddit.com'] }
		}

		const payload = {
			model: currentModel,
			tools: [webSearchTool],
			include: ['web_search_call.action.sources'],
			input: inputText,
		}

		try {
			return await http.post(OPENAI_RESPONSES_URL, payload, headers, {
				timeout,
			})
		} catch (e) {
			if (e instanceof http.HTTPError) {
				lastError = e
				if (isModelAccessError(e)) continue
			}
			throw e
		}
	}

	if (lastError) throw lastError
	throw new http.HTTPError('No models available')
}

/** Parse OpenAI response to extract Reddit items. */
export function parseRedditResponse(
	response: Record<string, unknown>,
): Record<string, unknown>[] {
	// Check for API errors
	if (response.error) return []

	// Find output text
	let outputText = ''
	if (response.output) {
		const output = response.output
		if (typeof output === 'string') {
			outputText = output
		} else if (Array.isArray(output)) {
			for (const item of output) {
				if (item && typeof item === 'object') {
					const obj = item as Record<string, unknown>
					if (obj.type === 'message') {
						const content = obj.content as Record<string, unknown>[]
						for (const c of content ?? []) {
							if (c?.type === 'output_text') {
								outputText = (c.text as string) ?? ''
								break
							}
						}
					} else if (typeof obj.text === 'string') {
						outputText = obj.text
					}
				} else if (typeof item === 'string') {
					outputText = item
				}
				if (outputText) break
			}
		}
	}

	// Check choices (older format)
	if (!outputText && response.choices) {
		for (const choice of response.choices as Record<string, unknown>[]) {
			const message = choice.message as Record<string, unknown> | undefined
			if (message) {
				outputText = (message.content as string) ?? ''
				break
			}
		}
	}

	if (!outputText) return []

	// Extract JSON from the response
	const jsonMatch = outputText.match(/\{[\s\S]*"items"[\s\S]*\}/)
	let items: Record<string, unknown>[] = []
	if (jsonMatch) {
		try {
			const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>
			items = (data.items as Record<string, unknown>[]) ?? []
		} catch {
			// ignore parse errors
		}
	}

	// Validate and clean items
	const cleanItems: Record<string, unknown>[] = []
	for (let i = 0; i < items.length; i++) {
		const item = items[i]
		if (!item || typeof item !== 'object') continue

		const url = String(item.url ?? '')
		if (!url || !url.includes('reddit.com')) continue

		const cleanItem: Record<string, unknown> = {
			id: `R${i + 1}`,
			title: String(item.title ?? '').trim(),
			url,
			subreddit: String(item.subreddit ?? '')
				.trim()
				.replace(/^r\//, ''),
			date: item.date ?? null,
			why_relevant: String(item.why_relevant ?? '').trim(),
			relevance: Math.min(1.0, Math.max(0.0, Number(item.relevance ?? 0.5))),
		}

		// Validate date format
		if (cleanItem.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(cleanItem.date))) {
			cleanItem.date = null
		}

		cleanItems.push(cleanItem)
	}

	return cleanItems
}
