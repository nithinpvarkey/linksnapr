import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AgentResult, SummaryResult } from '@/lib/types'
import { sanitiseAiOutput, extractDomain } from '@/lib/security'

// ─── Constants ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'Summarise what this webpage is about in 3 to 4 sentences based on the content provided. ' +
  'If the content is limited, use the page title and any available text to make a reasonable inference about what the page covers. ' +
  'Be specific — name the actual subject, product, person, or event if identifiable. ' +
  'Do not start with "This page" or "This article". ' +
  'Do not say you lack content or cannot help. ' +
  'Write in plain English. No AI disclaimers.'

const INPUT_CHAR_LIMIT = 4_000   // chars sent to any model
const OUTPUT_MAX_CHARS = 500     // passed to sanitiseAiOutput
const CALL_TIMEOUT_MS  = 10_000  // per attempt — not per model total
const AGENT_NAME       = 'SummaryAgent'

// ─── Private helpers ─────────────────────────────────────────────────────────

class TimeoutError extends Error {
  constructor() {
    super('Request timed out')
    this.name = 'TimeoutError'
  }
}

function buildFailure(error: string, durationMs: number): AgentResult<SummaryResult> {
  return { success: false, error, source: 'primary', durationMs }
}

function buildUserMessage(text: string): string {
  return `Page content:\n\n${text}`
}

function tryWithTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new TimeoutError()), CALL_TIMEOUT_MS)
    promise.then(
      result => { clearTimeout(id); resolve(result) },
      err    => { clearTimeout(id); reject(err as Error) },
    )
  })
}

async function callGemini(text: string): Promise<string> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('MISSING_KEY')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model:             'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
  })

  const result = await model.generateContent(buildUserMessage(text))
  const output = result.response.text()
  if (!output) throw new Error('EMPTY_RESPONSE')
  return output
}

interface OpenRouterChoice {
  message: { content: string }
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[]
}

function isOpenRouterResponse(data: unknown): data is OpenRouterResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'choices' in data &&
    Array.isArray((data as { choices: unknown }).choices)
  )
}

async function callOpenRouter(model: string, text: string): Promise<string> {
  const apiKey = process.env['OPENROUTER_API_KEY']
  if (!apiKey) throw new Error('MISSING_KEY')

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  'https://linksnapr.app',
      'X-Title':       'LinkSnapr',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: buildUserMessage(text) },
      ],
      max_tokens: 200,
    }),
  })

  if (response.status === 429) throw new Error('RATE_LIMIT')
  if (response.status >= 500) throw new Error('API_ERROR')
  if (!response.ok)           throw new Error(`HTTP_ERROR_${response.status}`)

  const data: unknown = await response.json()
  if (!isOpenRouterResponse(data)) throw new Error('INVALID_RESPONSE')

  const first = data.choices[0]
  if (!first) throw new Error('INVALID_RESPONSE')

  const { content } = first.message
  if (!content) throw new Error('EMPTY_RESPONSE')
  return content
}

async function tryModel(
  label: string,
  call: () => Promise<string>,
  domain: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await tryWithTimeout(call())
    } catch (err) {
      if (err instanceof TimeoutError) {
        if (attempt === 1) {
          console.error({
            timestamp: new Date().toISOString(),
            agent:     AGENT_NAME,
            domain,
            model:     label,
            message:   'Timeout — retrying once',
          })
          continue
        }
        console.error({
          timestamp: new Date().toISOString(),
          agent:     AGENT_NAME,
          domain,
          model:     label,
          message:   'Retry also timed out — skipping model',
        })
        return null
      }
      // Rate limit, API error, missing key, or any other failure — skip immediately
      console.error({
        timestamp: new Date().toISOString(),
        agent:     AGENT_NAME,
        domain,
        model:     label,
        error:     err instanceof Error ? err.message : 'Unknown error',
      })
      return null
    }
  }
  return null
}

// ─── Exported function ────────────────────────────────────────────────────────

/**
 * Generates a summary of the page content using Gemini 2.5 Flash,
 * falling back to Kimi then DeepSeek if any model fails or times out.
 * Each model gets one retry on timeout — rate limit and API errors skip
 * immediately to the next fallback. Never throws — always returns AgentResult.
 */
export async function summarisePage(
  text: string,
  url: string,
): Promise<AgentResult<SummaryResult>> {
  const start     = Date.now()
  const domain    = extractDomain(url)
  const truncated = text.slice(0, INPUT_CHAR_LIMIT)

  const models = [
    {
      label:  'gemini-2.5-flash',
      source: 'primary'  as const,
      call:   () => callGemini(truncated),
    },
    {
      label:  'moonshot-v1-8k',
      source: 'fallback' as const,
      call:   () => callOpenRouter('moonshot-v1-8k', truncated),
    },
    {
      label:  'deepseek/deepseek-chat',
      source: 'fallback' as const,
      call:   () => callOpenRouter('deepseek/deepseek-chat', truncated),
    },
  ]

  for (const model of models) {
    const result = await tryModel(model.label, model.call, domain)

    if (result === null) {
      console.error({
        timestamp: new Date().toISOString(),
        agent:     AGENT_NAME,
        domain,
        message:   `${model.label} failed — trying next model`,
      })
      continue
    }

    const sanitised = sanitiseAiOutput(result, OUTPUT_MAX_CHARS)

    if (sanitised.length === 0) {
      console.error({
        timestamp: new Date().toISOString(),
        agent:     AGENT_NAME,
        domain,
        model:     model.label,
        message:   'Empty output after sanitisation — trying next model',
      })
      continue
    }

    const durationMs = Date.now() - start

    if (process.env['NODE_ENV'] !== 'production') {
      console.log({
        timestamp: new Date().toISOString(),
        agent:     AGENT_NAME,
        domain,
        model:     model.label,
        durationMs,
        status:    'success',
      })
    }

    return {
      success: true,
      data:    { summary: sanitised },
      source:  model.source,
      durationMs,
    }
  }

  return buildFailure('Summary unavailable for this page', Date.now() - start)
}
