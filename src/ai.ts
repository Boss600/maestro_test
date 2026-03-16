import Anthropic from "@anthropic-ai/sdk"
import { GoogleGenerativeAI } from "@google/generative-ai"
import Groq from "groq-sdk"
import OpenAI from "openai"
import { fmt } from "./cli"
import * as fs from "fs"

const AGENT_SYSTEM_PROMPT = `
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

Commands allowed:
  - tapOn: "Text" or { id: "id" } or { point: "X,Y" }
    - Note: "X,Y" must be absolute integer pixels (e.g., "500,1000") or percentages (e.g., "50%,50%").
    - NEVER use decimal ratios like "0.5,0.8".
  - inputText: "text"
  - assertVisible: "text"
  - scrollUntilVisible: { element: { text: "Text" }, direction: DOWN|UP }
  - back, waitForAnimationToEnd
  - runFlow: flows/filename.yaml

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
        msg.includes("deadline exceeded")

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

export async function generateNextStep(
  model: "claude" | "gemini" | "groq" | "openai",
  appId: string,
  testDescription: string,
  currentHierarchy: string,
  history: string[] = [],
  screenshotPath?: string,
  availableFlows: string[] = [],
  memory: Record<string, string> = {}
): Promise<string> {
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
    const response = await withRetry("Claude Agent", () =>
      client.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
        max_tokens: 256,
        system: AGENT_SYSTEM_PROMPT,
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
      { role: "system", content: AGENT_SYSTEM_PROMPT },
    ]

    if (screenshotPath && fs.existsSync(screenshotPath)) {
      const imageData = fs.readFileSync(screenshotPath).toString("base64")
      messages.push({
        role: "user",
        content: [
          { type: "text", text: promptText },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${imageData}`,
            },
          },
        ],
      })
    } else {
      messages.push({ role: "user", content: promptText })
    }

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
      { role: "system", content: AGENT_SYSTEM_PROMPT },
    ]

    if (screenshotPath && fs.existsSync(screenshotPath)) {
      const imageData = fs.readFileSync(screenshotPath).toString("base64")
      messages.push({
        role: "user",
        content: [
          { type: "text", text: promptText },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${imageData}`,
            },
          },
        ],
      })
    } else {
      messages.push({ role: "user", content: promptText })
    }

    const response = await withRetry("OpenAI Agent", () =>
      client.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o",
        messages,
        max_tokens: 256,
        temperature: 0,
      })
    )
    rawText = response.choices[0]?.message?.content || ""
  } else {
    const apiKey = process.env.GEMINI_API_KEY!
    const genAI = new GoogleGenerativeAI(apiKey)
    const gemModel = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-1.5-flash-latest" })
    
    const parts: any[] = [{ text: `${AGENT_SYSTEM_PROMPT}\n\n${promptText}` }]
    
    if (screenshotPath && fs.existsSync(screenshotPath)) {
      const imageData = fs.readFileSync(screenshotPath).toString("base64")
      parts.push({
        inlineData: {
          data: imageData,
          mimeType: "image/png"
        }
      })
    }

    const result = await withRetry("Gemini Agent", () => gemModel.generateContent(parts))
    rawText = result.response.text().trim()
  }

  return rawText.replace(/```ya?ml\n?/g, "").replace(/```/g, "").trim()
}

// These are still here for backward compatibility if needed, though the Agent is the primary focus now
export async function generateWithClaude() { /* ... */ }
export async function generateWithGemini() { /* ... */ }
export async function interpretResult() { /* ... */ }
