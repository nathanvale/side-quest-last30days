/** Model auto-selection for last-30-days skill. */

import * as cache from './cache.js'
import * as http from './http.js'

// OpenAI API
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models'
const OPENAI_FALLBACK_MODELS = ['gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-4o']

// xAI API - Agent Tools API requires grok-4 family
const XAI_ALIASES: Record<string, string> = {
	latest: 'grok-4-1-fast',
	stable: 'grok-4-1-fast',
}

/** Parse semantic version from model ID. */
export function parseVersion(modelId: string): number[] | null {
	const match = modelId.match(/(\d+(?:\.\d+)*)/)
	if (!match?.[1]) return null
	return match[1].split('.').map(Number)
}

/** Check if model is a mainline GPT model (not mini/nano/chat/codex/pro). */
export function isMainlineOpenaiModel(modelId: string): boolean {
	const modelLower = modelId.toLowerCase()
	if (!/^gpt-5(\.\d+)*$/.test(modelLower)) return false

	const excludes = ['mini', 'nano', 'chat', 'codex', 'pro', 'preview', 'turbo']
	return !excludes.some((exc) => modelLower.includes(exc))
}

/** Select the best OpenAI model based on policy. */
export async function selectOpenaiModel(
	apiKey: string,
	policy = 'auto',
	pin: string | null = null,
	mockModels: Record<string, unknown>[] | null = null,
): Promise<string> {
	if (policy === 'pinned' && pin) return pin

	const cached = cache.getCachedModel('openai')
	if (cached) return cached

	let models: Record<string, unknown>[]
	if (mockModels !== null) {
		models = mockModels
	} else {
		try {
			const headers = { Authorization: `Bearer ${apiKey}` }
			const response = await http.get(OPENAI_MODELS_URL, headers)
			models = (response.data as Record<string, unknown>[]) ?? []
		} catch {
			return OPENAI_FALLBACK_MODELS[0]!
		}
	}

	const candidates = models.filter((m) =>
		isMainlineOpenaiModel((m.id as string) ?? ''),
	)

	if (candidates.length === 0) return OPENAI_FALLBACK_MODELS[0]!

	candidates.sort((a, b) => {
		const vA = parseVersion((a.id as string) ?? '') ?? [0]
		const vB = parseVersion((b.id as string) ?? '') ?? [0]
		for (let i = 0; i < Math.max(vA.length, vB.length); i++) {
			const diff = (vB[i] ?? 0) - (vA[i] ?? 0)
			if (diff !== 0) return diff
		}
		return ((b.created as number) ?? 0) - ((a.created as number) ?? 0)
	})

	const selected = candidates[0]!.id as string
	cache.setCachedModel('openai', selected)
	return selected
}

/** Select the best xAI model based on policy. */
export async function selectXaiModel(
	_apiKey: string,
	policy = 'latest',
	pin: string | null = null,
	_mockModels: Record<string, unknown>[] | null = null,
): Promise<string> {
	if (policy === 'pinned' && pin) return pin

	if (policy in XAI_ALIASES) {
		const alias = XAI_ALIASES[policy]!
		const cached = cache.getCachedModel('xai')
		if (cached) return cached
		cache.setCachedModel('xai', alias)
		return alias
	}

	return XAI_ALIASES.latest!
}

/** Get selected models for both providers. */
export async function getModels(
	config: Record<string, string | null>,
	mockOpenaiModels: Record<string, unknown>[] | null = null,
	mockXaiModels: Record<string, unknown>[] | null = null,
): Promise<Record<string, string | null>> {
	const result: Record<string, string | null> = { openai: null, xai: null }

	if (config.OPENAI_API_KEY) {
		result.openai = await selectOpenaiModel(
			config.OPENAI_API_KEY,
			config.OPENAI_MODEL_POLICY ?? 'auto',
			config.OPENAI_MODEL_PIN ?? null,
			mockOpenaiModels,
		)
	}

	if (config.XAI_API_KEY) {
		result.xai = await selectXaiModel(
			config.XAI_API_KEY,
			config.XAI_MODEL_POLICY ?? 'latest',
			config.XAI_MODEL_PIN ?? null,
			mockXaiModels,
		)
	}

	return result
}
