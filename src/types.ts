export interface Args {
  command: "generate" | "run" | "generate-and-run"
  appId?: string
  goal?: string
  file?: string
  provider: "claude" | "gemini" | "groq"
  outputPath?: string
  help: boolean
}

export type StepType = 
  | "launchApp"
  | "assertVisible"
  | "assertNotVisible"
  | "tapOn"
  | "inputText"
  | "eraseText"
  | "waitFor"
  | "scroll"
  | "back"
  | "pressKey"
  | "takeScreenshot"

export interface TestStep {
  type: StepType
  text?: string
  id?: string
  direction?: "UP" | "DOWN" | "LEFT" | "RIGHT"
  duration?: number
  key?: string
}

export interface TestPlan {
  appId: string
  testName: string
  description: string
  steps: TestStep[]
}

export interface ExecutionResult {
  passed: boolean
  output: string
  durationMs: number
  exitCode?: number
  filePath?: string
}
