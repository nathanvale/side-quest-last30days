/** xAI API client for X (Twitter) discovery. */

import * as http from './http.js'

const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses'

/** Cache-busting version for X search prompt behavior. */
export const X_PROMPT_VERSION = '2026-02-11-v1'

/** Depth configurations: [min, max] posts to request. */
const DEPTH_CONFIG: Record<string, [number, number]> = {
	quick: [8, 12],
	default: [20, 30],
	deep: [40, 60],
}

const X_SEARCH_PROMPT = `You have access to real-time X (Twitter) data. Search for posts about: {topic}

Focus on posts from {from_date} to {to_date}. Find {min_items}-{max_items} high-quality, relevant posts.

IMPORTANT: Return ONLY valid JSON in this exact format, no other text:
{
  "items": [
    {
      "text": "Post text content (truncated if long)",
      "url": "https://x.com/user/status/...",
      "author_handle": "username",
      "date": "YYYY-MM-DD or null if unknown",
      "engagement": {
        "likes": 100,
        "reposts": 25,
        "replies": 15,
        "quotes": 5
      },
      "why_relevant": "Brief explanation of relevance",
      "relevance": 0.85
    }
  ]
}

Rules:
- relevance is 0.0 to 1.0 (1.0 = highly relevant)
- date must be YYYY-MM-DD format or null
- engagement can be null if unknown
- Include diverse voices/accounts if applicable
- Prefer posts with substantive content, not just links`

/** Search X for relevant posts using xAI API with live search. */
export async function searchX(
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

	const payload = {
		model,
		tools: [{ type: 'x_search' }],
		input: [
			{
				role: 'user',
				content: X_SEARCH_PROMPT.replace('{topic}', topic)
					.replace('{from_date}', fromDate)
					.replace('{to_date}', toDate)
					.replace('{min_items}', String(minItems))
					.replace('{max_items}', String(maxItems)),
			},
		],
	}

	return http.post(XAI_RESPONSES_URL, payload, headers, { timeout })
}

/** Safe relevance parsing with NaN guard. */
function safeRelevance(val: unknown): number {
	const n = Number(val ?? 0.5)
	return Number.isFinite(n) ? Math.min(1.0, Math.max(0.0, n)) : 0.5
}

/** Safe number parsing with null fallback for non-numeric values. */
function safeNumber(val: unknown): number | null {
	if (val == null) return null
	const n = Number(val)
	return Number.isFinite(n) ? n : null
}

/** Parse xAI response to extract X items. */
export function parseXResponse(
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
		if (!url) continue

		// Parse engagement
		let engagement: Record<string, number | null> | null = null
		const engRaw = item.engagement as Record<string, unknown> | undefined
		if (engRaw && typeof engRaw === 'object') {
			engagement = {
				likes: safeNumber(engRaw.likes),
				reposts: safeNumber(engRaw.reposts),
				replies: safeNumber(engRaw.replies),
				quotes: safeNumber(engRaw.quotes),
			}
		}

		const cleanItem: Record<string, unknown> = {
			id: `X${i + 1}`,
			text: String(item.text ?? '')
				.trim()
				.slice(0, 500),
			url,
			author_handle: String(item.author_handle ?? '')
				.trim()
				.replace(/^@/, ''),
			date: item.date ?? null,
			engagement,
			why_relevant: String(item.why_relevant ?? '').trim(),
			relevance: safeRelevance(item.relevance),
		}

		// Validate date format
		if (cleanItem.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(cleanItem.date))) {
			cleanItem.date = null
		}

		cleanItems.push(cleanItem)
	}

	return cleanItems
}
