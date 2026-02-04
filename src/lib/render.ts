/** Output rendering for last-30-days skill. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Report } from './schema.js'
import { reportToDict } from './schema.js'

const OUTPUT_DIR = join(homedir(), '.local', 'share', 'last-30-days', 'out')

/** Ensure output directory exists. */
function ensureOutputDir(): void {
	mkdirSync(OUTPUT_DIR, { recursive: true })
}

/** Assess how much data is actually from the last 30 days. */
function assessDataFreshness(report: Report) {
	const redditRecent = report.reddit.filter(
		(r) => r.date && r.date >= report.range_from,
	).length
	const xRecent = report.x.filter(
		(x) => x.date && x.date >= report.range_from,
	).length
	const webRecent = report.web.filter(
		(w) => w.date && w.date >= report.range_from,
	).length

	const totalRecent = redditRecent + xRecent + webRecent
	const totalItems = report.reddit.length + report.x.length + report.web.length

	return {
		redditRecent,
		xRecent,
		webRecent,
		totalRecent,
		totalItems,
		isSparse: totalRecent < 5,
		mostlyEvergreen: totalItems > 0 && totalRecent < totalItems * 0.3,
	}
}

/** Render compact output for Claude to synthesize. */
export function renderCompact(
	report: Report,
	limit = 15,
	missingKeys = 'none',
): string {
	const lines: string[] = []

	lines.push(`## Research Results: ${report.topic}`)
	lines.push('')

	const freshness = assessDataFreshness(report)
	if (freshness.isSparse) {
		lines.push(
			'**⚠️ LIMITED RECENT DATA** - Few discussions from the last 30 days.',
		)
		lines.push(
			`Only ${freshness.totalRecent} item(s) confirmed from ${report.range_from} to ${report.range_to}.`,
		)
		lines.push(
			'Results below may include older/evergreen content. Be transparent with the user about this.',
		)
		lines.push('')
	}

	if (report.mode === 'web-only') {
		lines.push('**🌐 WEB SEARCH MODE** - Claude will search blogs, docs & news')
		lines.push('')
		lines.push('---')
		lines.push(
			'**⚡ Want better results?** Add API keys to unlock Reddit & X data:',
		)
		lines.push(
			'- `OPENAI_API_KEY` → Reddit threads with real upvotes & comments',
		)
		lines.push('- `XAI_API_KEY` → X posts with real likes & reposts')
		lines.push('- Edit `~/.config/last-30-days/.env` to add keys')
		lines.push('---')
		lines.push('')
	}

	if (report.from_cache) {
		const ageStr = report.cache_age_hours
			? `${report.cache_age_hours.toFixed(1)}h old`
			: 'cached'
		lines.push(
			`**⚡ CACHED RESULTS** (${ageStr}) - use \`--refresh\` for fresh data`,
		)
		lines.push('')
	}

	lines.push(`**Date Range:** ${report.range_from} to ${report.range_to}`)
	lines.push(`**Mode:** ${report.mode}`)
	if (report.openai_model_used)
		lines.push(`**OpenAI Model:** ${report.openai_model_used}`)
	if (report.xai_model_used)
		lines.push(`**xAI Model:** ${report.xai_model_used}`)
	lines.push('')

	if (report.mode === 'reddit-only' && missingKeys === 'x') {
		lines.push(
			'*💡 Tip: Add XAI_API_KEY for X/Twitter data and better triangulation.*',
		)
		lines.push('')
	} else if (report.mode === 'x-only' && missingKeys === 'reddit') {
		lines.push(
			'*💡 Tip: Add OPENAI_API_KEY for Reddit data and better triangulation.*',
		)
		lines.push('')
	}

	// Reddit items
	if (report.reddit_error) {
		lines.push(
			'### Reddit Threads',
			'',
			`**ERROR:** ${report.reddit_error}`,
			'',
		)
	} else if (
		['both', 'reddit-only'].includes(report.mode) &&
		report.reddit.length === 0
	) {
		lines.push(
			'### Reddit Threads',
			'',
			'*No relevant Reddit threads found for this topic.*',
			'',
		)
	} else if (report.reddit.length > 0) {
		lines.push('### Reddit Threads', '')
		for (const item of report.reddit.slice(0, limit)) {
			const engParts: string[] = []
			if (item.engagement) {
				if (item.engagement.score != null)
					engParts.push(`${item.engagement.score}pts`)
				if (item.engagement.num_comments != null)
					engParts.push(`${item.engagement.num_comments}cmt`)
			}
			const engStr = engParts.length > 0 ? ` [${engParts.join(', ')}]` : ''
			const dateStr = item.date ? ` (${item.date})` : ' (date unknown)'
			const confStr =
				item.date_confidence !== 'high' ? ` [date:${item.date_confidence}]` : ''

			lines.push(
				`**${item.id}** (score:${item.score}) r/${item.subreddit}${dateStr}${confStr}${engStr}`,
			)
			lines.push(`  ${item.title}`)
			lines.push(`  ${item.url}`)
			lines.push(`  *${item.why_relevant}*`)

			if (item.comment_insights.length > 0) {
				lines.push('  Insights:')
				for (const insight of item.comment_insights.slice(0, 3)) {
					lines.push(`    - ${insight}`)
				}
			}
			lines.push('')
		}
	}

	// X items
	if (report.x_error) {
		lines.push('### X Posts', '', `**ERROR:** ${report.x_error}`, '')
	} else if (
		['both', 'x-only', 'all', 'x-web'].includes(report.mode) &&
		report.x.length === 0
	) {
		lines.push(
			'### X Posts',
			'',
			'*No relevant X posts found for this topic.*',
			'',
		)
	} else if (report.x.length > 0) {
		lines.push('### X Posts', '')
		for (const item of report.x.slice(0, limit)) {
			const engParts: string[] = []
			if (item.engagement) {
				if (item.engagement.likes != null)
					engParts.push(`${item.engagement.likes}likes`)
				if (item.engagement.reposts != null)
					engParts.push(`${item.engagement.reposts}rt`)
			}
			const engStr = engParts.length > 0 ? ` [${engParts.join(', ')}]` : ''
			const dateStr = item.date ? ` (${item.date})` : ' (date unknown)'
			const confStr =
				item.date_confidence !== 'high' ? ` [date:${item.date_confidence}]` : ''

			lines.push(
				`**${item.id}** (score:${item.score}) @${item.author_handle}${dateStr}${confStr}${engStr}`,
			)
			lines.push(`  ${item.text.slice(0, 200)}...`)
			lines.push(`  ${item.url}`)
			lines.push(`  *${item.why_relevant}*`)
			lines.push('')
		}
	}

	// Web items
	if (report.web_error) {
		lines.push('### Web Results', '', `**ERROR:** ${report.web_error}`, '')
	} else if (report.web.length > 0) {
		lines.push('### Web Results', '')
		for (const item of report.web.slice(0, limit)) {
			const dateStr = item.date ? ` (${item.date})` : ' (date unknown)'
			const confStr =
				item.date_confidence !== 'high' ? ` [date:${item.date_confidence}]` : ''

			lines.push(
				`**${item.id}** [WEB] (score:${item.score}) ${item.source_domain}${dateStr}${confStr}`,
			)
			lines.push(`  ${item.title}`)
			lines.push(`  ${item.url}`)
			lines.push(`  ${item.snippet.slice(0, 150)}...`)
			lines.push(`  *${item.why_relevant}*`)
			lines.push('')
		}
	}

	return lines.join('\n')
}

/** Render reusable context snippet. */
export function renderContextSnippet(report: Report): string {
	const lines: string[] = []
	lines.push(`# Context: ${report.topic} (Last 30 Days)`)
	lines.push('')
	lines.push(
		`*Generated: ${report.generated_at.slice(0, 10)} | Sources: ${report.mode}*`,
	)
	lines.push('')
	lines.push('## Key Sources')
	lines.push('')

	const allItems: [number, string, string, string][] = []
	for (const item of report.reddit.slice(0, 5)) {
		allItems.push([item.score, 'Reddit', item.title, item.url])
	}
	for (const item of report.x.slice(0, 5)) {
		allItems.push([item.score, 'X', `${item.text.slice(0, 50)}...`, item.url])
	}
	for (const item of report.web.slice(0, 5)) {
		allItems.push([
			item.score,
			'Web',
			`${item.title.slice(0, 50)}...`,
			item.url,
		])
	}

	allItems.sort((a, b) => b[0] - a[0])
	for (const [, source, text] of allItems.slice(0, 7)) {
		lines.push(`- [${source}] ${text}`)
	}

	lines.push('')
	lines.push('## Summary')
	lines.push('')
	lines.push(
		'*See full report for best practices, prompt pack, and detailed sources.*',
	)
	lines.push('')

	return lines.join('\n')
}

/** Render full markdown report. */
export function renderFullReport(report: Report): string {
	const lines: string[] = []

	lines.push(`# ${report.topic} - Last 30 Days Research Report`)
	lines.push('')
	lines.push(`**Generated:** ${report.generated_at}`)
	lines.push(`**Date Range:** ${report.range_from} to ${report.range_to}`)
	lines.push(`**Mode:** ${report.mode}`)
	lines.push('')

	lines.push('## Models Used')
	lines.push('')
	if (report.openai_model_used)
		lines.push(`- **OpenAI:** ${report.openai_model_used}`)
	if (report.xai_model_used) lines.push(`- **xAI:** ${report.xai_model_used}`)
	lines.push('')

	if (report.reddit.length > 0) {
		lines.push('## Reddit Threads')
		lines.push('')
		for (const item of report.reddit) {
			lines.push(`### ${item.id}: ${item.title}`)
			lines.push('')
			lines.push(`- **Subreddit:** r/${item.subreddit}`)
			lines.push(`- **URL:** ${item.url}`)
			lines.push(
				`- **Date:** ${item.date ?? 'Unknown'} (confidence: ${item.date_confidence})`,
			)
			lines.push(`- **Score:** ${item.score}/100`)
			lines.push(`- **Relevance:** ${item.why_relevant}`)

			if (item.engagement) {
				lines.push(
					`- **Engagement:** ${item.engagement.score ?? '?'} points, ${item.engagement.num_comments ?? '?'} comments`,
				)
			}

			if (item.comment_insights.length > 0) {
				lines.push('')
				lines.push('**Key Insights from Comments:**')
				for (const insight of item.comment_insights) {
					lines.push(`- ${insight}`)
				}
			}
			lines.push('')
		}
	}

	if (report.x.length > 0) {
		lines.push('## X Posts')
		lines.push('')
		for (const item of report.x) {
			lines.push(`### ${item.id}: @${item.author_handle}`)
			lines.push('')
			lines.push(`- **URL:** ${item.url}`)
			lines.push(
				`- **Date:** ${item.date ?? 'Unknown'} (confidence: ${item.date_confidence})`,
			)
			lines.push(`- **Score:** ${item.score}/100`)
			lines.push(`- **Relevance:** ${item.why_relevant}`)

			if (item.engagement) {
				lines.push(
					`- **Engagement:** ${item.engagement.likes ?? '?'} likes, ${item.engagement.reposts ?? '?'} reposts`,
				)
			}
			lines.push('')
			lines.push(`> ${item.text}`)
			lines.push('')
		}
	}

	if (report.web.length > 0) {
		lines.push('## Web Results')
		lines.push('')
		for (const item of report.web) {
			lines.push(`### ${item.id}: ${item.title}`)
			lines.push('')
			lines.push(`- **Source:** ${item.source_domain}`)
			lines.push(`- **URL:** ${item.url}`)
			lines.push(
				`- **Date:** ${item.date ?? 'Unknown'} (confidence: ${item.date_confidence})`,
			)
			lines.push(`- **Score:** ${item.score}/100`)
			lines.push(`- **Relevance:** ${item.why_relevant}`)
			lines.push('')
			lines.push(`> ${item.snippet}`)
			lines.push('')
		}
	}

	lines.push('## Best Practices')
	lines.push('')
	lines.push('*To be synthesized by Claude*')
	lines.push('')
	lines.push('## Prompt Pack')
	lines.push('')
	lines.push('*To be synthesized by Claude*')
	lines.push('')

	return lines.join('\n')
}

/** Write all output files. */
export function writeOutputs(
	report: Report,
	rawOpenai?: Record<string, unknown> | null,
	rawXai?: Record<string, unknown> | null,
	rawRedditEnriched?: Record<string, unknown>[] | null,
): void {
	ensureOutputDir()

	writeFileSync(
		join(OUTPUT_DIR, 'report.json'),
		JSON.stringify(reportToDict(report), null, 2),
	)
	writeFileSync(join(OUTPUT_DIR, 'report.md'), renderFullReport(report))
	writeFileSync(
		join(OUTPUT_DIR, 'last-30-days.context.md'),
		renderContextSnippet(report),
	)

	if (rawOpenai) {
		writeFileSync(
			join(OUTPUT_DIR, 'raw_openai.json'),
			JSON.stringify(rawOpenai, null, 2),
		)
	}
	if (rawXai) {
		writeFileSync(
			join(OUTPUT_DIR, 'raw_xai.json'),
			JSON.stringify(rawXai, null, 2),
		)
	}
	if (rawRedditEnriched) {
		writeFileSync(
			join(OUTPUT_DIR, 'raw_reddit_threads_enriched.json'),
			JSON.stringify(rawRedditEnriched, null, 2),
		)
	}
}

/** Get path to context file. */
export function getContextPath(): string {
	return join(OUTPUT_DIR, 'last-30-days.context.md')
}
