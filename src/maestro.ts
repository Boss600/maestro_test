import { exec } from "child_process"
import { promisify } from "util"
import * as fs from "fs"
import * as path from "path"
import { ExecutionResult } from "./types"

const execAsync = promisify(exec)

export async function getHierarchy(): Promise<string> {
  try {
    const { stdout } = await execAsync("maestro hierarchy", {
      timeout: 15_000,
    })
    return stdout
  } catch (err) {
    return "Failed to capture hierarchy: " + (err as Error).message
  }
}

export async function takeScreenshot(fileName: string): Promise<string> {
  try {
    const screenshotDir = path.join(process.cwd(), "outputs/screenshots")
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true })
    
    const filePath = path.join(screenshotDir, fileName)
    await execAsync(`maestro screenshot "${filePath}"`, {
      timeout: 15_000,
    })
    return filePath
  } catch (err) {
    throw new Error("Failed to capture screenshot: " + (err as Error).message)
  }
}

export async function runMaestroTest(yamlPath: string, appId: string): Promise<ExecutionResult> {
  const start = Date.now()
  let output = ""
  let passed = false
  let hierarchy: string | undefined

  try {
    const { stdout, stderr } = await execAsync(`maestro test -e APP_ID=${appId} ${yamlPath}`, {
      timeout: 120_000,
    })
    output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : "")
    passed =
      !output.toLowerCase().includes("failed") &&
      !output.toLowerCase().includes("error") &&
      !stderr.toLowerCase().includes("exception")
  } catch (err: any) {
    output =
      (err.stdout ?? "") + "\n" + (err.stderr ?? "") + "\n" + (err.message ?? "")
    passed = false
  }

  const logDir = path.dirname(path.join(process.cwd(), "outputs/logs/maestro_execution.log"))
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  fs.writeFileSync("outputs/logs/maestro_execution.log", output, "utf-8")

  if (!passed) {
    hierarchy = await getHierarchy()
  }

  return { passed, output, durationMs: Date.now() - start, hierarchy }
}

export async function captureInitialHierarchy(appId: string): Promise<string | undefined> {
  try {
    const launchFlow = `appId: ${appId}\n---\n- launchApp: { appId: "${appId}", clearState: false }`
    const tempPath = "outputs/generated/temp_launch.yaml"
    const tempDir = path.dirname(tempPath)
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
    
    fs.writeFileSync(tempPath, launchFlow)
    await execAsync(`maestro test -e APP_ID=${appId} ${tempPath}`).catch(() => {})
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    
    return await getHierarchy()
  } catch (err) {
    return undefined
  }
}
