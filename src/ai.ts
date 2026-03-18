import Anthropic from "@anthropic-ai/sdk"
import { GoogleGenerativeAI } from "@google/generative-ai"
import Groq from "groq-sdk"
import { fmt } from "./cli"
import * as fs from "fs"
import { TestPlan, TestStep, StepType } from "./types"

const ALLOWED_STEP_TYPES: StepType[] = [
  "launchApp",
  "assertVisible",
  "assertNotVisible",
  "tapOn",
  "inputText",
  "eraseText",
  "waitFor",
  "scroll",
  "back",
  "pressKey",
  "takeScreenshot"
]

const TEST_PLANNER_SYSTEM_PROMPT = `
You are an expert mobile test engineer specializing in Android testing with Maestro.
Your goal is to generate a structured mobile test plan based on a natural language goal and the app's current state.

OUTPUT FORMAT:
You MUST return ONLY a JSON object adhering to this schema:
{
  "appId": "string",
  "testName": "string",
  "description": "string",
  "steps": [
    {
      "type": "launchApp" | "assertVisible" | "assertNotVisible" | "tapOn" | "inputText" | "eraseText" | "waitFor" | "scroll" | "back" | "pressKey" | "takeScreenshot",
      "text": "string (optional)",
      "id": "string (optional)",
      "direction": "UP" | "DOWN" | "LEFT" | "RIGHT" (optional),
      "duration": number (optional),
      "key": "string (optional)"
    }
  ]
}

RULES:
1. Every test MUST start with "launchApp".
2. Use accurate selectors (text or id) based on the UI hierarchy if provided.
3. Be concise. Only include necessary steps to achieve the goal.
4. Return ONLY raw JSON. No markdown code blocks, no explanations, no extra characters.
5. All steps MUST use one of the allowed types: ${ALLOWED_STEP_TYPES.join(", ")}.
`

/**
 * Reusable retry logic with support for rate limits, timeouts, and network errors.
 */
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 2000
): Promise<T> {
  let lastError: any
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      const msg = err.message?.toLowerCase() ?? ""
      const status = err.status || err.statusCode || 0
      
      const isRetryable =
        status === 429 ||
        status === 503 ||
        status === 504 ||
        msg.includes("quota") ||
        msg.includes("limit") ||
        msg.includes("overloaded") ||
        msg.includes("too many requests") ||
        msg.includes("deadline exceeded") ||
        msg.includes("socket hang up") ||
        msg.includes("timeout") ||
        msg.includes("econnreset") ||
        msg.includes("etimedout") ||
        msg.includes("connection reset")

      if (!isRetryable || i === maxRetries - 1) throw err

      const delay = initialDelay * Math.pow(2, i)
      console.warn(
        fmt.warn(
          `${label} — ${msg.substring(0, 60)}... Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`
        )
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError
}

export interface AIPredictor {
  generatePlan(
    appId: string,
    goal: string,
    context: { hierarchy?: string; screenshotPath?: string }
  ): Promise<TestPlan>
}

export class ClaudePredictor implements AIPredictor {
  private client: Anthropic
  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.")
    this.client = new Anthropic({ apiKey })
  }

  async generatePlan(appId: string, goal: string, context: { hierarchy?: string; screenshotPath?: string }): Promise<TestPlan> {
    const prompt = `Goal: ${goal}\nApp ID: ${appId}\n${context.hierarchy ? `UI Hierarchy:\n${context.hierarchy}` : ""}`
    const messages: any[] = []

    if (context.screenshotPath && fs.existsSync(context.screenshotPath)) {
      const imageData = fs.readFileSync(context.screenshotPath).toString("base64")
      messages.push({
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: imageData },
          },
          { type: "text", text: prompt },
        ],
      })
    } else {
      messages.push({ role: "user", content: prompt })
    }

    const response = await withRetry("Claude", () =>
      this.client.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
        max_tokens: 2048,
        system: TEST_PLANNER_SYSTEM_PROMPT,
        messages,
      })
    )

    const raw = (response.content[0] as any).text
    return parseAndValidatePlan(raw)
  }
}

interface Model {
  name: string;
  supportedGenerationMethods: string[];
}

interface ListModelsResponse {
  models: Model[];
}

export class GeminiPredictor implements AIPredictor {
  private genAI: GoogleGenerativeAI
  private apiKey: string
  private model: string | null = null

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set.")
    this.apiKey = apiKey
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  private async findModel(): Promise<string> {
    if (this.model) return this.model
    
    console.log(fmt.info("Checking for available Gemini models..."))
    
    // The google-generative-ai package does not have a listModels method.
    // We must call the REST API manually.
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status} ${response.statusText}`)
    }
    const data: ListModelsResponse = await response.json()
    
    const compatibleModel = data.models.find(m => 
      m.name.includes("gemini") &&
      m.supportedGenerationMethods.includes("generateContent")
    )

    if (!compatibleModel) {
      throw new Error("No compatible Gemini model found for your API key. Please check your Google AI account for available models.")
    }
    
    // The name is the full resource name, e.g., "models/gemini-pro".
    // We just need the ID "gemini-pro".
    const modelId = compatibleModel.name.split("/").pop()!
    this.model = modelId
    
    console.log(fmt.info(`Using model: ${this.model}`))
    return this.model
  }

  async generatePlan(appId: string, goal: string, context: { hierarchy?: string; screenshotPath?: string }): Promise<TestPlan> {
    const modelName = await this.findModel()
    const model = this.genAI.getGenerativeModel({ model: modelName })
    
    const prompt = `Goal: ${goal}\nApp ID: ${appId}\n${context.hierarchy ? `UI Hierarchy:\n${context.hierarchy}` : ""}`
    const parts: any[] = [{ text: TEST_PLANNER_SYSTEM_PROMPT }, { text: prompt }]

    if (context.screenshotPath && fs.existsSync(context.screenshotPath)) {
      const imageData = fs.readFileSync(context.screenshotPath).toString("base64")
      parts.push({
        inlineData: { data: imageData, mimeType: "image/png" },
      })
    }

    const result = await withRetry(`Gemini (${modelName})`, () => model.generateContent(parts))
    return parseAndValidatePlan(result.response.text())
  }
}

export class GroqPredictor implements AIPredictor {
  private client: Groq
  constructor() {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new Error("GROQ_API_KEY is not set.")
    this.client = new Groq({ apiKey })
  }

  async generatePlan(appId: string, goal: string, context: { hierarchy?: string; screenshotPath?: string }): Promise<TestPlan> {
    const prompt = `Goal: ${goal}\nApp ID: ${appId}\n${context.hierarchy ? `UI Hierarchy:\n${context.hierarchy}` : ""}`
    
    const response = await withRetry("Groq", () =>
      this.client.chat.completions.create({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: TEST_PLANNER_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0,
      })
    )
    const raw = response.choices[0]?.message?.content || ""
    return parseAndValidatePlan(raw)
  }
}

function parseAndValidatePlan(raw: string): TestPlan {
  try {
    // Robust cleaning of markdown and extra characters
    let clean = raw.trim()
    if (clean.includes("```")) {
      const match = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      if (match) clean = match[1]
    }
    
    const plan = JSON.parse(clean) as TestPlan

    if (!plan.appId || !plan.testName || !plan.description || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      throw new Error("Invalid plan structure: appId, testName, description, and steps are required.")
    }

    for (const step of plan.steps) {
      if (!ALLOWED_STEP_TYPES.includes(step.type)) {
        throw new Error(`Unsupported step type: ${step.type}. Allowed: ${ALLOWED_STEP_TYPES.join(", ")}`)
      }
    }

    return plan
  } catch (err: any) {
    throw new Error(`Failed to parse AI response: ${err.message}\nRaw response: ${raw}`)
  }
}

export function getProvider(name: string): AIPredictor {
  switch (name.toLowerCase()) {
    case "claude": return new ClaudePredictor()
    case "gemini": return new GeminiPredictor()
    case "groq": return new GroqPredictor()
    default: throw new Error(`Unknown provider: ${name}`)
  }
}
