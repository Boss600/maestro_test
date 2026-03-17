import Anthropic from "@anthropic-ai/sdk"
import { GoogleGenerativeAI } from "@google/generative-ai"
import Groq from "groq-sdk"
import OpenAI from "openai"
import { fmt } from "./cli"
import * as fs from "fs"
import * as path from "path"

const VISION_AGENT_SYSTEM_PROMPT = `
Expert mobile test engineer acting as a Live Agent.
You execute tests ONE STEP AT A TIME.

Your Goal:
Achieve the goal described in the "Test Description" by providing the SINGLE NEXT Maestro command.

DATA EXTRACTION & MEMORY:
- If you need to "read" or "remember" a value for later (e.g., a balance, an ID, a code), use the command: EXTRACT: key="value"
- You can then use this value in later steps (e.g., inputText: "\${value}")
- The "Working Memory" section will show you what you have already extracted.

VISUAL ANALYSIS:
You are provided with BOTH a UI Hierarchy (XML) and a Screenshot.
- Use the Screenshot to identify icons and buttons that lack text labels in the XML.
- Common icons: Gear (Settings), Trash (Delete), Profile/Avatar (Account), Plus (Add), Magnifying Glass (Search).
- To interact with an element found only in the screenshot, try to find its "resource-id" or "bounds" in the XML that corresponds to its position.

Rules:
- Return ONLY valid Maestro YAML for the next step.
- Do NOT return a full file. Just the step (e.g., "- tapOn: \"Login\"").
- If the goal is fully achieved, return "DONE".
- If you are stuck, return "ERROR: <reason>".

CONTEXT-AWARE MEMORY & LOOP PREVENTION:
- Use the "Action History" to track your progress.
- If an action resulted in "FAILED", you MUST NOT repeat it exactly. Try a different selector (e.g., use ID instead of Text), scroll, or try a different path.
- If you find yourself repeating actions, BREAK the loop by trying a new approach.

Commands allowed (in order of preference):
  - tapOn: { id: "resource-id" }   // MOST RELIABLE
  - tapOn: "Text Label"            // VERY RELIABLE
  - assertVisible: "Text Label" or { id: "resource-id" }
  - scrollUntilVisible: { element: { text: "Text" }, direction: DOWN|UP }
  - inputText: "text"
  - runFlow: flows/filename.yaml
  - back, waitForAnimationToEnd
  - tapOn: { point: "X%,Y%" }          // LEAST RELIABLE - USE ONLY AS A LAST RESORT
    - "X%,Y%" MUST be percentages (e.g., "50%,75%"). DO NOT use pixels or decimals.

Special elements:
- Switches/Toggles: Do NOT tap on a Switch using text. Find its resource-id and tap on that. If it has no ID, tap on the text label next to it.

Notes:
- Return ONLY the YAML step, no markdown, no explanation.
`

const TEXT_ONLY_AGENT_SYSTEM_PROMPT = `
Expert mobile test engineer acting as a Live Agent.
You execute tests ONE STEP AT A TIME based ONLY on the UI Hierarchy (XML).

Your Goal:
Achieve the goal described in the "Test Description" by providing the SINGLE NEXT Maestro command.

**IMPORTANT: Visual Analysis**
- If you determine the next logical action requires identifying a purely visual element (like an icon without a text label) that is NOT described in the UI hierarchy, you MUST return the special command: REQUEST_SCREENSHOT
- Do NOT guess. If the element (e.g., a gear icon for settings) has no "text" or "resource-id" in the XML, you need a screenshot.

DATA EXTRACTION & MEMORY:
- To "read" a value, use the command: EXTRACT: key="value"
- The "Working Memory" section will show you what you have already extracted.

Rules:
- Return ONLY the next Maestro command (e.g., "- tapOn: \"Login\""), "REQUEST_SCREENSHOT", "DONE", or "ERROR: <reason>".
- Do NOT return a full file or multiple steps.

CONTEXT-AWARE MEMORY & LOOP PREVENTION:
- Use the "Action History" to track your progress.
- If an action resulted in "FAILED", you MUST NOT repeat it. Try a different selector or a new approach.

Commands allowed (in order of preference):
  - tapOn: { id: "resource-id" }   // MOST RELIABLE
  - tapOn: "Text Label"            // VERY RELIABLE
  - assertVisible: "Text Label" or { id: "resource-id" }
  - scrollUntilVisible: { element: { text: "Text" }, direction: DOWN|UP }
  - inputText: "text"
  - runFlow: flows/filename.yaml
  - back, waitForAnimationToEnd

Notes:
- Return ONLY the YAML step, no markdown, no explanation.
`

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
      const isRetryable =
        msg.includes("503") ||
        msg.includes("overloaded") ||
        msg.includes("too many requests") ||
        msg.includes("429") ||
        msg.includes("deadline exceeded") ||
        msg.includes("socket hang up") ||
        msg.includes("timeout") ||
        msg.includes("econnreset") ||
        msg.includes("etimedout")

      if (!isRetryable || i === maxRetries - 1) throw err

      const delay = initialDelay * Math.pow(2, i)
      console.log(
        fmt.warn(
          `${label} — AI service busy (503/429). Retrying in ${delay}ms... (Attempt ${
            i + 1
          }/${maxRetries})`
        )
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError
}

// Track if Gemini primary has hit quota limits to switch to secondary persistently for the session
let useGeminiSecondary = false

export async function generateNextStep(
  model: "claude" | "gemini" | "groq" | "openai",
  appId: string,
  testDescription: string,
  currentHierarchy: string,
  history: string[] = [],
  options: {
    screenshotPath?: string
    availableFlows?: string[]
    memory?: Record<string, string>
    useVision?: boolean
  }
): Promise<string> {
  const {
    screenshotPath,
    availableFlows = [],
    memory = {},
    useVision = false,
  } = options

  const systemPrompt = useVision
    ? VISION_AGENT_SYSTEM_PROMPT
    : TEXT_ONLY_AGENT_SYSTEM_PROMPT

  const flowsContext = availableFlows.length > 0 
    ? `Available reusable flows in "flows/":\n${availableFlows.map(f => `- ${f}`).join("\n")}`
    : "No reusable flows available."

  const memoryContext = Object.keys(memory).length > 0
    ? `Working Memory (Extracted Data):\n${Object.entries(memory).map(([k, v]) => `- \${${k}}: ${v}`).join("\n")}`
    : "Working Memory: Empty"

  const promptText = `
Test Description: ${testDescription}
App ID: ${appId}

${flowsContext}

${memoryContext}

Current UI Hierarchy:
${currentHierarchy}

Action History (Steps already taken):
${history.length > 0 ? history.join("\n") : "None"}

What is the SINGLE NEXT Maestro command? (Return "DONE" if finished)`

  let rawText = ""
  if (model === "claude") {
    const apiKey = process.env.ANTHROPIC_API_KEY!
    const client = new Anthropic({ apiKey })
    // Claude does not support vision in this implementation yet
    const response = await withRetry("Claude Agent", () =>
      client.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: "user", content: promptText }],
      })
    )
    rawText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim()
  } else if (model === "groq") {
    const apiKey = process.env.GROQ_API_KEY!
    const client = new Groq({ apiKey })
    
    const messages: any[] = [
      { role: "system", content: systemPrompt },
    ]

    const userContent: any[] = [{ type: "text", text: promptText }]

    if (useVision && screenshotPath && fs.existsSync(screenshotPath)) {
      const imageData = fs.readFileSync(screenshotPath).toString("base64")
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${imageData}`,
        },
      })
    }
    
    messages.push({ role: "user", content: userContent })

    const response = await withRetry("Groq Agent", () =>
      client.chat.completions.create({
        model: process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct",
        messages,
        max_tokens: 256,
        temperature: 0,
      })
    )
    rawText = response.choices[0]?.message?.content || ""
  } else if (model === "openai") {
    const apiKey = process.env.OPENAI_API_KEY!
    const client = new OpenAI({ apiKey })
    
    const messages: any[] = [
      { role: "system", content: systemPrompt },
    ]

    const userContent: any[] = [{ type: "text", text: promptText }]

    if (useVision && screenshotPath && fs.existsSync(screenshotPath)) {
      const imageData = fs.readFileSync(screenshotPath).toString("base64")
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${imageData}`,
        },
      })
    }

    messages.push({ role: "user", content: userContent })

    const response = await withRetry("OpenAI Agent", () =>
      client.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o",
        messages,
        max_tokens: 256,
        temperature: 0,
      })
    )
    rawText = response.choices[0]?.message?.content || ""
  } else { // Gemini
    const apiKey = process.env.GEMINI_API_KEY!
    const genAI = new GoogleGenerativeAI(apiKey)
    const primaryModelName = process.env.GEMINI_MODEL || "gemini-1.5-flash-latest"
    const secondaryModelName = process.env.GEMINI_MODEL_SECONDARY || "gemini-1.5-pro-latest"
    
    let gemModel = genAI.getGenerativeModel({ model: useGeminiSecondary ? secondaryModelName : primaryModelName })
    
    let parts: any[] = [{ text: `${systemPrompt}\n\n${promptText}` }]
    
    if (useVision && screenshotPath && fs.existsSync(screenshotPath)) {
      const imageData = fs.readFileSync(screenshotPath).toString("base64")
      
      // If it's a desktop capture (fallback), let the AI know it needs to find the emulator window
      if (path.basename(screenshotPath).startsWith("desktop_")) {
        parts = [{ text: `${systemPrompt}\n\nNOTE: The following screenshot is a FULL DESKTOP CAPTURE (intelligent fallback). Locate the Android emulator window within the desktop image to determine the next step.\n\n${promptText}` }]
      }

      parts.push({
        inlineData: {
          data: imageData,
          mimeType: "image/png"
        }
      })
    } else if (useVision) {
      // If vision was requested but no screenshot is available, provide a fallback note
      parts = [{ text: `${systemPrompt}\n\nNOTE: Vision was requested but screenshot capture failed. Please proceed using the UI Hierarchy (XML) provided below.\n\n${promptText}` }]
    }

    let result
    try {
      result = await withRetry(useGeminiSecondary ? "Gemini Agent (Secondary)" : "Gemini Agent", () => gemModel.generateContent(parts))
    } catch (err: any) {
      const msg = err.message?.toLowerCase() ?? ""
      const isQuotaError = msg.includes("quota") || msg.includes("exhausted") || msg.includes("429")
      
      if (!useGeminiSecondary && isQuotaError) {
        console.warn(fmt.warn(`Gemini primary model quota exhausted. Switching to secondary: ${secondaryModelName}`))
        useGeminiSecondary = true
        gemModel = genAI.getGenerativeModel({ model: secondaryModelName })
        result = await withRetry("Gemini Agent (Secondary)", () => gemModel.generateContent(parts))
      } else {
        throw err
      }
    }
    rawText = result.response.text().trim()
  }

  return rawText.replace(/```ya?ml\n?/g, "").replace(/```/g, "").trim()
}

// These are still here for backward compatibility if needed, though the Agent is the primary focus now
export async function generateWithClaude() { /* ... */ }
export async function generateWithGemini() { /* ... */ }
export async function interpretResult() { /* ... */ }
