// Unit tests for agents/summaryAgent.ts — 13 tests across 4 groups.
//
// @google/generative-ai is mocked via factory-level closures — shared refs
// avoid the jest.mock hoisting problem. global.fetch is intercepted for
// OpenRouter calls. @/lib/security is mocked for sanitiseAiOutput and
// extractDomain. Timeout tests use jest.useFakeTimers() + never-resolving
// promises, advancing 10 001ms to fire the 10-second tryWithTimeout timer.

import { summarisePage } from '../../../agents/summaryAgent'

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@google/generative-ai', () => {
  const generateContent    = jest.fn()
  const getGenerativeModel = jest.fn().mockReturnValue({ generateContent })
  const MockGoogleGenerativeAI = jest.fn().mockImplementation(() => ({ getGenerativeModel }))
  return {
    GoogleGenerativeAI:  MockGoogleGenerativeAI,
    _generateContent:    generateContent,
    _getGenerativeModel: getGenerativeModel,
  }
})

jest.mock('@/lib/security', () => ({
  sanitiseAiOutput: jest.fn(),
  extractDomain:    jest.fn(),
}))

const { _generateContent: mockGenerateContent } =
  jest.requireMock<{
    GoogleGenerativeAI:  jest.Mock
    _generateContent:    jest.MockedFunction<(prompt: string) => Promise<{ response: { text: () => string } }>>
    _getGenerativeModel: jest.Mock
  }>('@google/generative-ai')

const { sanitiseAiOutput: mockSanitise, extractDomain: mockExtractDomain } =
  jest.requireMock<{
    sanitiseAiOutput: jest.MockedFunction<(text: string, max: number) => string>
    extractDomain:    jest.MockedFunction<(url: string) => string>
  }>('@/lib/security')

// ─── Fetch spy — declared before helpers so closures can reference it ─────────

// safe: assigned unconditionally in beforeEach before any test runs
let mockFetch!: jest.SpyInstance

// ─── Helpers ─────────────────────────────────────────────────────────────────

type GeminiResult = { response: { text: () => string } }

function mockGeminiSuccess(text: string): void {
  mockGenerateContent.mockResolvedValue({ response: { text: () => text } })
}

function mockGeminiFailure(error: Error): void {
  mockGenerateContent.mockRejectedValue(error)
}

/** Makes every generateContent call return a Promise that never settles.
 *  Used with jest.useFakeTimers() to trigger the tryWithTimeout mechanism. */
function mockGeminiNeverResolves(): void {
  mockGenerateContent.mockImplementation(
    (): Promise<GeminiResult> => new Promise(() => { /* intentionally never resolves */ }),
  )
}

function makeOpenRouterResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: new Headers({ 'content-type': 'application/json' }) },
  )
}

function makeOpenRouterFailure(status: number): Response {
  return new Response(null, { status })
}

/** Makes fetch return a Promise that never settles — for OpenRouter timeout tests. */
function mockOpenRouterNeverResolves(): void {
  mockFetch.mockImplementation(
    (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
      new Promise(() => { /* intentionally never resolves */ }),
  )
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGenerateContent.mockReset()
  mockSanitise.mockReset()
  mockExtractDomain.mockReset()

  // Defaults — override per test as needed
  mockGeminiSuccess('Gemini summary.')
  mockSanitise.mockImplementation((text: string, maxLength: number): string =>
    text.slice(0, maxLength),
  )
  mockExtractDomain.mockReturnValue('example.com')

  mockFetch = jest.spyOn(global, 'fetch')
  mockFetch.mockResolvedValue(makeOpenRouterResponse('OpenRouter summary.'))

  process.env['GEMINI_API_KEY']     = 'test-gemini-key'
  process.env['OPENROUTER_API_KEY'] = 'test-openrouter-key'
})

afterEach(() => {
  jest.restoreAllMocks()
  delete process.env['GEMINI_API_KEY']
  delete process.env['OPENROUTER_API_KEY']
})

// ═════════════════════════════════════════════════════════════════════════════
// summarisePage
// ═════════════════════════════════════════════════════════════════════════════

describe('summarisePage', () => {

  // ─── Group 1 — Happy path ─────────────────────────────────────────────────

  describe('Group 1 — happy path', () => {

    it('should return a successful AgentResult when Gemini succeeds on the first attempt', async () => {
      // Arrange: beforeEach sets Gemini to return 'Gemini summary.' and
      //          mockSanitise to pass text through unchanged (slice to 500)
      // Act
      const result = await summarisePage('Page content', 'Test page title', 'https://example.com/')
      // Assert
      expect(result).toMatchObject({
        success:    true,
        source:     'primary',
        durationMs: expect.any(Number),
        data:       { summary: 'Gemini summary.' },
      })
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

  })

  // ─── Group 2 — Fallback chain ─────────────────────────────────────────────

  describe('Group 2 — fallback chain', () => {

    describe('timeout behavior', () => {

      afterEach(() => {
        jest.useRealTimers()
      })

      it('should retry Gemini once after a timeout and succeed if the retry resolves', async () => {
        // Arrange: first attempt hangs forever; second attempt resolves immediately
        jest.useFakeTimers()
        mockGenerateContent
          .mockImplementationOnce(
            (): Promise<GeminiResult> => new Promise(() => { /* hangs */ }),
          )
          .mockResolvedValueOnce({ response: { text: () => 'Retry summary.' } })
        // Act
        const resultPromise = summarisePage('Page content', 'Test page title', 'https://example.com/')
        await Promise.resolve()          // flush pending microtasks before advancing clock
        jest.advanceTimersByTime(10_001) // fire attempt-1 timeout → TimeoutError
        const result = await resultPromise // retry runs; second generateContent resolves
        // Assert: source is 'primary' — same Gemini model retried within tryModel
        expect(result).toMatchObject({
          success:    true,
          source:     'primary',
          durationMs: expect.any(Number),
          data:       { summary: 'Retry summary.' },
        })
      })

      it('should fall back to Kimi when Gemini times out on both the initial call and the retry', async () => {
        // Arrange: all Gemini calls hang; Kimi succeeds immediately
        jest.useFakeTimers()
        mockGeminiNeverResolves()
        mockFetch.mockResolvedValue(makeOpenRouterResponse('Kimi summary.'))
        // Act
        const resultPromise = summarisePage('Page content', 'Test page title', 'https://example.com/')
        await Promise.resolve()          // flush before first timer advance
        jest.advanceTimersByTime(10_001) // fire attempt-1 timeout
        await Promise.resolve()          // let catch block run and register attempt-2 setTimeout
        jest.advanceTimersByTime(10_001) // fire attempt-2 timeout → tryModel returns null
        const result = await resultPromise // Kimi fetch resolves via microtask
        // Assert
        expect(result).toMatchObject({
          success:    true,
          source:     'fallback',
          durationMs: expect.any(Number),
          data:       { summary: 'Kimi summary.' },
        })
      })

    })

    it('should skip to Kimi immediately on a Gemini rate-limit error — no retry', async () => {
      // Arrange: RATE_LIMIT is a non-TimeoutError — tryModel skips without retry
      mockGeminiFailure(new Error('RATE_LIMIT'))
      mockFetch.mockResolvedValue(makeOpenRouterResponse('Kimi summary.'))
      // Act
      const result = await summarisePage('Page content', 'Test page title', 'https://example.com/')
      // Assert: generateContent called exactly once — no retry attempt
      expect(mockGenerateContent).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        success:    true,
        source:     'fallback',
        durationMs: expect.any(Number),
        data:       { summary: 'Kimi summary.' },
      })
    })

    it('should skip to Kimi immediately on a Gemini API error — no retry', async () => {
      // Arrange: API_ERROR is a non-TimeoutError — skipped immediately, same as rate limit
      mockGeminiFailure(new Error('API_ERROR'))
      mockFetch.mockResolvedValue(makeOpenRouterResponse('Kimi summary.'))
      // Act
      const result = await summarisePage('Page content', 'Test page title', 'https://example.com/')
      // Assert
      expect(mockGenerateContent).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        success:    true,
        source:     'fallback',
        durationMs: expect.any(Number),
        data:       { summary: 'Kimi summary.' },
      })
    })

    it('should fall back to DeepSeek when both Gemini and Kimi fail', async () => {
      // Arrange: Gemini errors; Kimi returns 500; DeepSeek returns a valid response
      mockGeminiFailure(new Error('Gemini error'))
      mockFetch
        .mockResolvedValueOnce(makeOpenRouterFailure(500))                    // Kimi: fails
        .mockResolvedValueOnce(makeOpenRouterResponse('DeepSeek summary.'))   // DeepSeek: succeeds
      // Act
      const result = await summarisePage('Page content', 'Test page title', 'https://example.com/')
      // Assert: source is 'fallback' — DeepSeek is the third model in the array
      expect(result).toMatchObject({
        success:    true,
        source:     'fallback',
        durationMs: expect.any(Number),
        data:       { summary: 'DeepSeek summary.' },
      })
    })

    it('should return a failure AgentResult when all three models fail', async () => {
      // Arrange: Gemini errors; both OpenRouter calls return 500
      mockGeminiFailure(new Error('Gemini error'))
      mockFetch.mockResolvedValue(makeOpenRouterFailure(500))
      // Act
      const result = await summarisePage('Page content', 'Test page title', 'https://example.com/')
      // Assert: source is 'primary' — comes from buildFailure which hardcodes 'primary'
      expect(result).toMatchObject({
        success:    false,
        source:     'primary',
        durationMs: expect.any(Number),
        error:      expect.any(String),
      })
    })

  })

  // ─── Group 3 — Output handling ────────────────────────────────────────────

  describe('Group 3 — output handling', () => {

    it('should pass the raw AI output and the 500-char limit to sanitiseAiOutput', async () => {
      // Arrange: Gemini returns a string containing HTML tags
      const rawOutput = '<p>Summary with HTML</p>'
      mockGeminiSuccess(rawOutput)
      // Act
      const result = await summarisePage('Page content', 'Test page title', 'https://example.com/')
      // Assert: sanitiseAiOutput receives the exact AI output and OUTPUT_MAX_CHARS = 500
      expect(mockSanitise).toHaveBeenCalledWith(rawOutput, 500)
      expect(result).toMatchObject({
        success: true, source: 'primary', durationMs: expect.any(Number),
        data:    { summary: rawOutput }, // default mock slices to 500 — rawOutput is shorter
      })
    })

    it('should return a summary truncated to 500 characters when the AI response is over the limit', async () => {
      // Arrange: 600-char output — mockSanitise slices to maxLength (500)
      const longOutput = 'a'.repeat(600)
      mockGeminiSuccess(longOutput)
      // Act
      const result = await summarisePage('Page content', 'Test page title', 'https://example.com/')
      // Assert: sanitiseAiOutput called with full output and 500; result trimmed to 500
      expect(mockSanitise).toHaveBeenCalledWith(longOutput, 500)
      expect(result).toMatchObject({ success: true, source: 'primary', durationMs: expect.any(Number) })
      if (result.success) {
        expect(result.data.summary.length).toBe(500)
      }
    })

    it('should try the next model when the AI returns an empty string', async () => {
      // Arrange: empty text() causes callGemini to throw EMPTY_RESPONSE — not a timeout,
      //          so tryModel skips Gemini immediately without retrying
      mockGenerateContent.mockResolvedValue({ response: { text: (): string => '' } })
      mockFetch.mockResolvedValue(makeOpenRouterResponse('Kimi summary.'))
      // Act
      const result = await summarisePage('Page content', 'Test page title', 'https://example.com/')
      // Assert: generateContent called once (no retry), Kimi succeeded
      expect(mockGenerateContent).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        success: true, source: 'fallback', durationMs: expect.any(Number),
        data:    { summary: 'Kimi summary.' },
      })
    })

    it('should try the next model when sanitiseAiOutput returns an empty string after sanitisation', async () => {
      // Arrange: Gemini returns whitespace — sanitiseAiOutput simulates stripping it to empty
      mockGenerateContent.mockResolvedValue({ response: { text: (): string => '   ' } })
      mockSanitise.mockReturnValueOnce('') // first call (Gemini's whitespace output) → empty
      mockFetch.mockResolvedValue(makeOpenRouterResponse('Kimi summary.'))
      // Act
      const result = await summarisePage('Page content', 'Test page title', 'https://example.com/')
      // Assert: Kimi succeeded after Gemini's sanitised output was empty
      expect(result).toMatchObject({
        success: true, source: 'fallback', durationMs: expect.any(Number),
        data:    { summary: 'Kimi summary.' },
      })
    })

  })

  // ─── Group 4 — Input handling ─────────────────────────────────────────────

  describe('Group 4 — input handling', () => {

    it('should truncate input text to exactly 3 000 characters before sending to the model', async () => {
      // Arrange: 4 000-char text — only first 3 000 chars should reach generateContent
      const longText = 'b'.repeat(4_000)
      // Act
      await summarisePage(longText, 'Test page title', 'https://example.com/')
      // Assert: the prompt passed to generateContent contains exactly 3 000 'b' chars,
      //         not 3 001 — buildUserMessage wraps the truncated text as "Page content:\n\n<text>"
      const prompt = mockGenerateContent.mock.calls[0]?.[0] ?? ''
      expect(prompt).toContain('b'.repeat(3_000))
      expect(prompt).not.toContain('b'.repeat(3_001))
    })

    it('should call extractDomain with the url parameter', async () => {
      // Arrange: pass a distinct URL to verify the exact argument
      // Act
      await summarisePage('Page content', 'Test page title', 'https://example.com/article')
      // Assert
      expect(mockExtractDomain).toHaveBeenCalledWith('https://example.com/article')
    })

  })

})
