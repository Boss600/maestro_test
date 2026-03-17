import { exec } from "child_process"
import { promisify } from "util"
import * as fs from "fs"
import * as path from "path"
import { ExecutionResult } from "./types"
import { fmt } from "./cli"

const execAsync = promisify(exec)

export async function getHierarchy(retries = 2): Promise<string> {
  for (let i = 0; i <= retries; i++) {
    try {
      const { stdout } = await execAsync("maestro hierarchy", {
        timeout: 15_000,
      })
      return stdout
    } catch (err) {
      if (i === retries) return "Failed to capture hierarchy: " + (err as Error).message
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  return "" // Should not reach here
}

export async function takeScreenshot(fileName: string, retries = 1): Promise<string> {
  const screenshotDir = path.join(process.cwd(), "outputs/screenshots")
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true })

  const filePath = path.join(screenshotDir, fileName)
  const remotePath = "/sdcard/screen.png"
  const timeout = 30_000

  for (let i = 0; i <= retries; i++) {
    try {
      // 1. Check for devices
      const { stdout: devicesOutput } = await execAsync("adb devices", { timeout })
      const lines = devicesOutput.trim().split('\n')
      const devices = lines.slice(1).filter(line => line.trim() && !line.includes("List of devices attached"))
      if (devices.length === 0 || devices.every(line => line.includes("offline"))) {
        throw new Error(`No active Android device found. Output:\n${devicesOutput}`)
      }

      // 2. Take screenshot on device
      try {
        await execAsync(`adb shell screencap -p ${remotePath}`, { timeout })
      } catch (err: any) {
        let message = `Failed to run 'adb shell screencap': ${err.message}\n`
        if (err.stderr) message += `stderr: ${err.stderr}\n`
        if (err.stdout) message += `stdout: ${err.stdout}\n`
        if (err.code) message += `exit code: ${err.code}\n`
        
        message += `\n\nTroubleshooting suggestions:\n`
        message += `1. Run "adb devices" to ensure your device is connected and not "offline".\n`
        message += `2. Manually run "adb shell screencap -p /sdcard/test.png" and "adb pull /sdcard/test.png" to check for device-side errors.\n`
        message += `3. Ensure the device screen is on and not displaying secure content (e.g., password fields).\n`
        throw new Error(message)
      }

      // 3. Pull screenshot from device
      try {
        await execAsync(`adb pull ${remotePath} "${filePath}"`, { timeout })
      } catch (err: any) {
        throw new Error(`Failed to run 'adb pull': ${err.message}\n${err.stderr ?? ''}`)
      }

      // 4. Clean up screenshot from device
      try {
        await execAsync(`adb shell rm ${remotePath}`, { timeout: 10_000 })
      } catch (err: any) {
        // Don't fail the whole operation if cleanup fails, but log it
        console.warn(`Warning: Failed to remove screenshot from device: ${err.message}`)
      }
      
      return filePath
    } catch (err) {
      if (i === retries) {
        // Intelligent fallback for Windows: capture desktop if adb fails
        if (process.platform === "win32") {
          console.warn(fmt.warn(`Primary screenshot failed. Trying desktop capture fallback on Windows...`))
          try {
            const desktopFilePath = path.join(path.dirname(filePath), "desktop_" + fileName)
            // Use PowerShell to capture the primary screen as a last resort
            const psCommand = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bmp); $graphics.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $bmp.Save('${desktopFilePath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)`
            await execAsync(`powershell -Command "${psCommand}"`, { timeout: 15_000 })
            return desktopFilePath
          } catch (fallbackErr: any) {
            console.warn(`Desktop fallback also failed: ${fallbackErr.message}`)
          }
        }
        // Re-throw the specific error from the steps above if fallback fails or is not Windows
        throw new Error(`Failed to capture screenshot: ${(err as Error).message}`)
      }
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  throw new Error("Failed to capture screenshot after retries")
}

export async function runMaestroTest(yamlPath: string, appId: string, retries = 1): Promise<ExecutionResult> {
  const start = Date.now()
  let output = ""
  let passed = false
  let hierarchy: string | undefined

  for (let i = 0; i <= retries; i++) {
    try {
      const { stdout, stderr } = await execAsync(`maestro test -e APP_ID=${appId} "${yamlPath}"`, {
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

    if (passed) break
    
    if (i < retries) {
      console.log(fmt.warn(`Maestro test failed (attempt ${i + 1}/${retries + 1}). Retrying in 3s...`))
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  const logFilePath = path.join(process.cwd(), "outputs/logs/maestro_execution.log")
  const logDir = path.dirname(logFilePath)
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  fs.writeFileSync(logFilePath, output, "utf-8")

  if (!passed) {
    hierarchy = await getHierarchy()
  }

  return { passed, output, durationMs: Date.now() - start, hierarchy }
}

export async function captureInitialHierarchy(appId: string): Promise<string | undefined> {
  try {
    const launchFlow = `appId: ${appId}\n---\n- launchApp: { appId: "${appId}", clearState: false }`
    const tempPath = path.join(process.cwd(), "outputs/generated/temp_launch.yaml")
    const tempDir = path.dirname(tempPath)
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
    
    fs.writeFileSync(tempPath, launchFlow)
    await execAsync(`maestro test -e APP_ID=${appId} "${tempPath}"`).catch(() => {})
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    
    return await getHierarchy()
  } catch (err) {
    return undefined
  }
}

export function extractMaestroError(output: string): string | undefined {
  const lines = output.split("\n")
  // Look for the specific step that failed or the Error message
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.includes("FAILED") && line.startsWith("-")) return line
    if (line.startsWith("Error:")) return line
  }
  return undefined
}

export function logStep(stepData: {
  step: number
  type: "text" | "vision" | "extraction"
  action: string
  status: "SUCCESS" | "FAILED" | "HEALED"
  error?: string
  durationMs?: number
}) {
  const logFilePath = path.join(process.cwd(), "outputs/logs/session_steps.jsonl")
  const logDir = path.dirname(logFilePath)
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...stepData
  })
  fs.appendFileSync(logFilePath, entry + "\n", "utf-8")
}
