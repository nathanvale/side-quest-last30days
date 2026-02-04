/** Terminal UI utilities for last30days skill. */

const IS_TTY = process.stderr.isTTY ?? false

const PURPLE = '\x1b[95m'
const CYAN = '\x1b[96m'
const GREEN = '\x1b[92m'
const YELLOW = '\x1b[93m'
const RED = '\x1b[91m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const MINI_BANNER = `${PURPLE}${BOLD}/last30days${RESET} ${DIM}· researching...${RESET}`

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const REDDIT_MESSAGES = [
	'Diving into Reddit threads...',
	'Scanning subreddits for gold...',
	'Reading what Redditors are saying...',
	'Exploring the front page of the internet...',
	'Finding the good discussions...',
]

const X_MESSAGES = [
	'Checking what X is buzzing about...',
	'Reading the timeline...',
	'Finding the hot takes...',
	'Scanning tweets and threads...',
	'Discovering trending insights...',
]

const ENRICHING_MESSAGES = [
	'Getting the juicy details...',
	'Fetching engagement metrics...',
	'Reading top comments...',
	'Extracting insights...',
]

const PROCESSING_MESSAGES = [
	'Crunching the data...',
	'Scoring and ranking...',
	'Finding patterns...',
	'Removing duplicates...',
]

const WEB_ONLY_MESSAGES = [
	'Searching the web...',
	'Finding blogs and docs...',
	'Crawling news sites...',
]

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]!
}

class Spinner {
	private message: string
	private color: string
	private running = false
	private timer: ReturnType<typeof setInterval> | null = null
	private frameIdx = 0
	private shownStatic = false

	constructor(message: string, color = CYAN) {
		this.message = message
		this.color = color
	}

	start(): void {
		this.running = true
		if (IS_TTY) {
			this.timer = setInterval(() => {
				const frame = SPINNER_FRAMES[this.frameIdx % SPINNER_FRAMES.length]
				process.stderr.write(
					`\r${this.color}${frame}${RESET} ${this.message}  `,
				)
				this.frameIdx++
			}, 80)
		} else if (!this.shownStatic) {
			process.stderr.write(`⏳ ${this.message}\n`)
			this.shownStatic = true
		}
	}

	update(message: string): void {
		this.message = message
		if (!IS_TTY && !this.shownStatic) {
			process.stderr.write(`⏳ ${message}\n`)
		}
	}

	stop(finalMessage = ''): void {
		this.running = false
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}
		if (IS_TTY) {
			process.stderr.write(`\r${' '.repeat(80)}\r`)
		}
		if (finalMessage) {
			process.stderr.write(`✓ ${finalMessage}\n`)
		}
	}
}

/** Progress display for research phases. */
export class ProgressDisplay {
	private topic: string
	private spinner: Spinner | null = null
	private startTime: number

	constructor(topic: string, showBanner = true) {
		this.topic = topic
		this.startTime = Date.now()
		if (showBanner) this.showBanner()
	}

	private showBanner(): void {
		if (IS_TTY) {
			process.stderr.write(`${MINI_BANNER}\n`)
			process.stderr.write(
				`${DIM}Topic: ${RESET}${BOLD}${this.topic}${RESET}\n\n`,
			)
		} else {
			process.stderr.write(`/last30days · researching: ${this.topic}\n`)
		}
	}

	startReddit(): void {
		const msg = pick(REDDIT_MESSAGES)
		this.spinner = new Spinner(`${YELLOW}Reddit${RESET} ${msg}`, YELLOW)
		this.spinner.start()
	}

	endReddit(count: number): void {
		this.spinner?.stop(`${YELLOW}Reddit${RESET} Found ${count} threads`)
	}

	startRedditEnrich(current: number, total: number): void {
		this.spinner?.stop()
		const msg = pick(ENRICHING_MESSAGES)
		this.spinner = new Spinner(
			`${YELLOW}Reddit${RESET} [${current}/${total}] ${msg}`,
			YELLOW,
		)
		this.spinner.start()
	}

	updateRedditEnrich(current: number, total: number): void {
		const msg = pick(ENRICHING_MESSAGES)
		this.spinner?.update(`${YELLOW}Reddit${RESET} [${current}/${total}] ${msg}`)
	}

	endRedditEnrich(): void {
		this.spinner?.stop(`${YELLOW}Reddit${RESET} Enriched with engagement data`)
	}

	startX(): void {
		const msg = pick(X_MESSAGES)
		this.spinner = new Spinner(`${CYAN}X${RESET} ${msg}`, CYAN)
		this.spinner.start()
	}

	endX(count: number): void {
		this.spinner?.stop(`${CYAN}X${RESET} Found ${count} posts`)
	}

	startProcessing(): void {
		const msg = pick(PROCESSING_MESSAGES)
		this.spinner = new Spinner(`${PURPLE}Processing${RESET} ${msg}`, PURPLE)
		this.spinner.start()
	}

	endProcessing(): void {
		this.spinner?.stop()
	}

	showComplete(redditCount: number, xCount: number): void {
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1)
		if (IS_TTY) {
			process.stderr.write(
				`\n${GREEN}${BOLD}✓ Research complete${RESET} ${DIM}(${elapsed}s)${RESET}\n`,
			)
			process.stderr.write(
				`  ${YELLOW}Reddit:${RESET} ${redditCount} threads  ${CYAN}X:${RESET} ${xCount} posts\n\n`,
			)
		} else {
			process.stderr.write(
				`✓ Research complete (${elapsed}s) - Reddit: ${redditCount} threads, X: ${xCount} posts\n`,
			)
		}
	}

	showCached(ageHours: number | null = null): void {
		const ageStr = ageHours != null ? ` (${ageHours.toFixed(1)}h old)` : ''
		process.stderr.write(
			`${GREEN}⚡${RESET} ${DIM}Using cached results${ageStr} - use --refresh for fresh data${RESET}\n\n`,
		)
	}

	showError(message: string): void {
		process.stderr.write(`${RED}✗ Error:${RESET} ${message}\n`)
	}

	startWebOnly(): void {
		const msg = pick(WEB_ONLY_MESSAGES)
		this.spinner = new Spinner(`${GREEN}Web${RESET} ${msg}`, GREEN)
		this.spinner.start()
	}

	endWebOnly(): void {
		this.spinner?.stop(`${GREEN}Web${RESET} Claude will search the web`)
	}

	showWebOnlyComplete(): void {
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1)
		if (IS_TTY) {
			process.stderr.write(
				`\n${GREEN}${BOLD}✓ Ready for web search${RESET} ${DIM}(${elapsed}s)${RESET}\n`,
			)
			process.stderr.write(
				`  ${GREEN}Web:${RESET} Claude will search blogs, docs & news\n\n`,
			)
		} else {
			process.stderr.write(`✓ Ready for web search (${elapsed}s)\n`)
		}
	}

	showPromo(missing: string): void {
		if (missing === 'both') {
			process.stderr.write(
				`\n${YELLOW}⚡ Add API keys to ~/.config/last30days/.env for Reddit & X data${RESET}\n`,
			)
		} else if (missing === 'reddit') {
			process.stderr.write(
				`${DIM}💡 Add OPENAI_API_KEY for Reddit data with real engagement metrics${RESET}\n`,
			)
		} else if (missing === 'x') {
			process.stderr.write(
				`${DIM}💡 Add XAI_API_KEY for X/Twitter data with real likes & reposts${RESET}\n`,
			)
		}
	}
}
