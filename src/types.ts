export interface Args {
  app?: string
  apk?: string
  test?: string
  suite?: string
  model: "claude" | "gemini" | "groq" | "openai"
  output: string
  dryRun: boolean
  noHierarchy: boolean
  help: boolean
}

export interface ExecutionResult {
  passed: boolean
  output: string
  durationMs: number
  hierarchy?: string
}

export interface TestReport {
  passed: boolean
  healed: boolean
  durationSec: string
  analysis: string
}
