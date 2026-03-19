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
Your goal is to generate a structured mobile test plan based on a natural language goal and the app's current state (UI hierarchy and screenshot context).

### CORE PRINCIPLES:
1.  **Hierarchy-Groundred Realism**: Your primary goal is to generate a realistic, minimal sequence of steps that a human would perform. Analyze the UI hierarchy and screenshot carefully. Do not hallucinate elements or interactions.
2.  **Minimal & Robust**: Generate the fewest steps needed for success, but ensure they are logical and robust.
3.  **Strict Output**: You MUST return ONLY the raw JSON object. No markdown, no explanations.

### OUTPUT FORMAT:
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
      "direction": "UP" | "DOWN" | "LEFT" | "RIGHT" (optional)",
      "duration": number (optional)",
      "key": "string (optional)"
    }
  ]
}

### INTERACTION STRATEGY:

#### **CRITICAL OVERRIDE**: The first step of ANY test MUST be 'launchApp'. This overrides any initial blocking UI dismissal or other actions. Always begin with 'launchApp'.

#### 1. Hierarchy-Groundred Element Selection
When choosing an element to interact with, prioritize using selectors in this order:
1.  **Resource ID**: Use the 'id' selector if a stable 'resource-id' is available. This is the most robust method.
2.  **Interactive Controls**: Prefer 'tapOn' for elements that are clearly buttons, input fields, tabs, or navigation components.
3.  **Visible Text**: Only use 'tapOn' with a 'text' selector as a last resort, and only when the UI strongly implies the text is interactive (e.g., a link or a menu item). For non-interactive text, use 'assertVisible'.

#### 2. Input vs. Tappable Text Distinction
You must distinguish between different types of text:
-   **Content/Result Text**: Use 'assertVisible' to verify its presence. Do NOT tap it.
-   **Placeholder/Label Text**: This text often describes an input field. Tap the *field itself*, not the label.
-   **Tappable/CTA Text**: Text on buttons or links (e.g., "Sign In," "Next," "Submit"). This is safe to 'tapOn'.

#### 3. Search-First Rule
For any goal involving searching (e.g., "search for X," "find Y"):
1.  **Identify Search Field**: First, find an element that is a search input field (e.g., an 'EditText' with 'resource-id' like 'search_src_text', or text like "Search...").
2.  **Tap the Field**: 'tapOn' the search field you identified.
3.  **Input Query**: Use 'inputText' to type the search query.
4.  **Submit**: Use 'pressKey: Enter' or 'tapOn' a visible search/submit button.
5.  **Verify**: Only after submitting the search should you use 'assertVisible' to check for the expected results on the screen.
**CRITICAL**: Do NOT 'tapOn' the search query text (e.g., 'tapOn: "OpenAI"') as the first step.

#### 4. Common Mobile UI Patterns
Before starting the main goal, identify and handle any blocking UI elements:
-   **Popups (Consent/Privacy/Permissions)**: If a dialog is present, tap the "Accept", "Allow", or "Continue" button to dismiss it.
-   **Onboarding/Carousels**: If an intro screen is visible, tap "Skip" or "Next" until the main app UI is reachable.
-   **Login/Signup Forms**: If the goal requires being logged in and a login form is present, complete the necessary 'inputText' and 'tapOn' steps.
`;

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
    const originalPrompt = `Goal: ${goal}
App ID: ${appId}
${context.hierarchy ? `UI Hierarchy:
${context.hierarchy}` : ""}`
    
    try {
      const messages: any[] = []
      if (context.screenshotPath && fs.existsSync(context.screenshotPath)) {
        const imageData = fs.readFileSync(context.screenshotPath).toString("base64")
        messages.push({
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: imageData } },
            { type: "text", text: originalPrompt },
          ],
        })
      } else {
        messages.push({ role: "user", content: originalPrompt })
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
      return parseAndValidatePlan(raw, goal)
    } catch (err: any) {
      if (err.message.includes("Failed to parse or validate AI response")) {
        console.warn(fmt.warn("Initial AI-generated plan failed validation. Retrying with a stricter prompt..."));
        const stricterPromptSuffix = "Your previous test plan was invalid or too speculative. Be more conservative, hierarchy-grounded, and prefer canonical controls (search fields, input fields, buttons) over tapping target text directly. Output only valid Maestro YAML.";
        const stricterPrompt = originalPrompt + stricterPromptSuffix;
        
        const messages: any[] = []
        if (context.screenshotPath && fs.existsSync(context.screenshotPath)) {
          const imageData = fs.readFileSync(context.screenshotPath).toString("base64")
          messages.push({
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: imageData } },
              { type: "text", text: stricterPrompt },
            ],
          })
        } else {
          messages.push({ role: "user", content: stricterPrompt })
        }
        
        const finalResponse = await withRetry("Claude (Retry)", () =>
          this.client.messages.create({
            model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
            max_tokens: 2048,
            system: TEST_PLANNER_SYSTEM_PROMPT,
            messages,
          })
        )
        const finalRaw = (finalResponse.content[0] as any).text
        return parseAndValidatePlan(finalRaw, goal)
      }
      throw err;
    }
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
    
    const modelId = compatibleModel.name.split("/").pop()!
    this.model = modelId
    
    console.log(fmt.info(`Using model: ${this.model}`))
    return this.model
  }

  async generatePlan(appId: string, goal: string, context: { hierarchy?: string; screenshotPath?: string }): Promise<TestPlan> {
    const originalPrompt = `Goal: ${goal}
App ID: ${appId}
${context.hierarchy ? `UI Hierarchy:
${context.hierarchy}` : ""}`
    
    try {
      const modelName = await this.findModel()
      const model = this.genAI.getGenerativeModel({ model: modelName })
      const parts: any[] = [{ text: TEST_PLANNER_SYSTEM_PROMPT }, { text: originalPrompt }]

      if (context.screenshotPath && fs.existsSync(context.screenshotPath)) {
        const imageData = fs.readFileSync(context.screenshotPath).toString("base64")
        parts.push({ inlineData: { data: imageData, mimeType: "image/png" } })
      }

      const result = await withRetry(`Gemini (${modelName})`, () => model.generateContent(parts))
      return parseAndValidatePlan(result.response.text(), goal)
    } catch (err: any) {
      if (err.message.includes("Failed to parse or validate AI response")) {
        console.warn(fmt.warn("Initial AI-generated plan failed validation. Retrying with a stricter prompt..."));
        const stricterPromptSuffix = "Your previous test plan was invalid or too speculative. Be more conservative, hierarchy-grounded, and prefer canonical controls (search fields, input fields, buttons) over tapping target text directly. Output only valid Maestro YAML.";
        const stricterPrompt = originalPrompt + stricterPromptSuffix;
        
        const modelName = await this.findModel()
        const model = this.genAI.getGenerativeModel({ model: modelName })
        const parts: any[] = [{ text: TEST_PLANNER_SYSTEM_PROMPT }, { text: stricterPrompt }]
        if (context.screenshotPath && fs.existsSync(context.screenshotPath)) {
          const imageData = fs.readFileSync(context.screenshotPath).toString("base64")
          parts.push({ inlineData: { data: imageData, mimeType: "image/png" } })
        }
        
        const finalResult = await withRetry(`Gemini (${modelName} - Retry)`, () => model.generateContent(parts))
        return parseAndValidatePlan(finalResult.response.text(), goal)
      }
      throw err
    }
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
    const originalPrompt = `Goal: ${goal}
App ID: ${appId}
${context.hierarchy ? `UI Hierarchy:
${context.hierarchy}` : ""}`

    try {
      const response = await withRetry("Groq", () =>
        this.client.chat.completions.create({
          model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: TEST_PLANNER_SYSTEM_PROMPT },
            { role: "user", content: originalPrompt },
          ],
          temperature: 0,
        })
      )
      const raw = response.choices[0]?.message?.content || ""
      return parseAndValidatePlan(raw, goal)
    } catch (err: any) {
      if (err.message.includes("Failed to parse or validate AI response")) {
        console.warn(fmt.warn("Initial AI-generated plan failed validation. Retrying with a stricter prompt..."));
        const stricterPromptSuffix = "Your previous test plan was invalid or too speculative. Be more conservative, hierarchy-grounded, and prefer canonical controls (search fields, input fields, buttons) over tapping target text directly. Output only valid Maestro YAML.";
        const stricterPrompt = originalPrompt + stricterPromptSuffix;
        
        const finalResponse = await withRetry("Groq (Retry)", () =>
          this.client.chat.completions.create({
            model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: TEST_PLANNER_SYSTEM_PROMPT },
              { role: "user", content: stricterPrompt },
            ],
            temperature: 0,
          })
        )
        const finalRaw = finalResponse.choices[0]?.message?.content || ""
        return parseAndValidatePlan(finalRaw, goal)
      }
      throw err;
    }
  }
}

function parseAndValidatePlan(raw: string, goal: string): TestPlan {
  try {
    let clean = raw.trim()
    if (clean.includes("```")) {
      const match = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      if (match) clean = match[1]
    }
    
    const plan = JSON.parse(clean) as TestPlan

    if (!plan.appId || !plan.testName || !plan.description || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      throw new Error("Invalid plan structure: appId, testName, description, and steps are required.")
    }

    if (plan.steps[0].type !== 'launchApp') {
      throw new Error("Validation failed: A test plan must start with a `launchApp` step.");
    }

    for (const step of plan.steps) {
      if (!ALLOWED_STEP_TYPES.includes(step.type)) {
        throw new Error(`Unsupported step type: ${step.type}. Allowed: ${ALLOWED_STEP_TYPES.join(", ")}`)
      }
      if (step.type === 'tapOn' && !step.text && !step.id) {
        throw new Error("Validation failed: `tapOn` step must have `text` or `id`.");
      }
      if (step.type === 'inputText' && typeof step.text !== 'string') {
        throw new Error("Validation failed: `inputText` step must have a `text` value.");
      }
      if (step.type === 'assertVisible' && !step.text && !step.id) {
          throw new Error("Validation failed: `assertVisible` step must have `text` or `id`.");
      }
    }

    const isSearchGoal = /search|find|look up/i.test(goal);
    if (isSearchGoal) {
      const inputTextStep = plan.steps.find(s => s.type === 'inputText');
      
      if (plan.steps.length > 1 && plan.steps[1].type === 'tapOn' && inputTextStep) {
        const firstTapText = plan.steps[1].text;
        if (firstTapText && firstTapText.toLowerCase() === inputTextStep.text?.toLowerCase()) {
          throw new Error("Validation failed: The first action is `tapOn` with the search query text. The AI should tap a search bar first.");
        }
      }

      if (inputTextStep) {
        const inputTextIndex = plan.steps.findIndex(s => s.type === 'inputText');
        const hasPrecedingTap = plan.steps.slice(0, inputTextIndex).some(s => s.type === 'tapOn');
        if (inputTextIndex > 0 && !hasPrecedingTap) {
            throw new Error("Validation failed: `inputText` is called without a preceding `tapOn` action to focus an input field.");
        }
      }
    }

    return plan
  } catch (err: any) {
    throw new Error(`Failed to parse or validate AI response: ${err.message}
Raw response: ${raw}`)
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
