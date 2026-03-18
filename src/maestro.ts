import { exec } from "child_process"
import { promisify } from "util"
import * as fs from "fs"
import * as path from "path"
import { ExecutionResult, TestPlan, TestStep } from "./types"
import { fmt } from "./cli"

const execAsync = promisify(exec)

/**
 * Ensures a device/emulator is connected and active.
 */
export async function checkDevice(): Promise<void> {
  const timeout = 15_000
  try {
    const { stdout } = await execAsync("adb devices", { timeout })
    const lines = stdout.trim().split("\n")
    const devices = lines.slice(1).filter(l => l.trim() && !l.includes("offline"))
    if (devices.length === 0) {
      throw new Error("No active Android device or emulator detected. Run 'adb devices' to verify.")
    }
  } catch (err: any) {
    throw new Error(`Device check failed: ${err.message}`)
  }
}

/**
 * Captures the UI hierarchy using Maestro.
 */
export async function getHierarchy(retries = 2): Promise<string> {
  for (let i = 0; i <= retries; i++) {
    try {
      const { stdout } = await execAsync("maestro hierarchy", { timeout: 15_000 })
      return stdout
    } catch (err) {
      if (i === retries) return "Failed to capture hierarchy: " + (err as Error).message
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  return ""
}

/**
 * Captures a screenshot from the device with Windows/PowerShell fallback.
 */
export async function takeScreenshot(fileName: string, retries = 1): Promise<string> {
  const screenshotDir = path.resolve("outputs/screenshots")
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true })

  const filePath = path.join(screenshotDir, fileName.endsWith(".png") ? fileName : `${fileName}.png`)
  const remotePath = "/sdcard/screen.png"
  const timeout = 30_000

  for (let i = 0; i <= retries; i++) {
    try {
      await checkDevice()
      
      // 1. Take screenshot on device
      await execAsync(`adb shell screencap -p ${remotePath}`, { timeout })

      // 2. Pull screenshot from device
      await execAsync(`adb pull ${remotePath} "${filePath}"`, { timeout })

      // 3. Clean up screenshot from device
      await execAsync(`adb shell rm ${remotePath}`, { timeout: 10_000 }).catch(() => {})
      
      return filePath
    } catch (err) {
      if (i === retries) {
        // Windows fallback: capture desktop/active window if adb fails
        if (process.platform === "win32") {
          console.warn(fmt.warn(`ADB screenshot failed. Trying PowerShell fallback...`))
          try {
            const fallbackPath = path.join(path.dirname(filePath), "fallback_" + path.basename(filePath))
            const psCommand = `
              Add-Type -AssemblyName System.Windows.Forms;
              Add-Type -AssemblyName System.Drawing;
              $screen = [System.Windows.Forms.Screen]::PrimaryScreen;
              $top = $screen.Bounds.Top;
              $left = $screen.Bounds.Left;
              $width = $screen.Bounds.Width;
              $height = $screen.Bounds.Height;
              $bitmap = New-Object System.Drawing.Bitmap($width, $height);
              $graphics = [System.Drawing.Graphics]::FromImage($bitmap);
              $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size);
              $bitmap.Save('${fallbackPath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png);
              $graphics.Dispose();
              $bitmap.Dispose();
            `.replace(/\n/g, "")
            
            await execAsync(`powershell -NoProfile -Command "${psCommand}"`, { timeout: 15_000 })
            return fallbackPath
          } catch (fallbackErr: any) {
            console.warn(`PowerShell fallback failed: ${fallbackErr.message}`)
          }
        }
        throw new Error(`Failed to capture screenshot: ${(err as Error).message}`)
      }
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  throw new Error("Failed to capture screenshot after retries")
}

/**
 * Launches the app using adb shell monkey.
 */
export async function launchApp(appId: string): Promise<void> {
  try {
    await execAsync(`adb shell monkey -p ${appId} -c android.intent.category.LAUNCHER 1`)
    await new Promise(r => setTimeout(r, 3000)) // Wait for launch
  } catch (err: any) {
    throw new Error(`Failed to launch app ${appId}: ${err.message}`)
  }
}

/**
 * Renders the structured TestPlan into a valid Maestro YAML string.
 */
export function generateMaestroYaml(plan: TestPlan): string {
  let yaml = `appId: ${plan.appId}\n---\n`
  
  for (const step of plan.steps) {
    const selector = step.id ? `{ id: "${step.id}" }` : `"${step.text}"`
    
    switch (step.type) {
      case "launchApp":
        yaml += `- launchApp\n`
        break
      case "assertVisible":
        yaml += `- assertVisible: ${selector}\n`
        break
      case "assertNotVisible":
        yaml += `- assertNotVisible: ${selector}\n`
        break
      case "tapOn":
        yaml += `- tapOn: ${selector}\n`
        break
      case "inputText":
        yaml += `- inputText: "${step.text || ""}"\n`
        break
      case "eraseText":
        yaml += `- eraseText\n`
        break
      case "waitFor":
        if (step.duration) {
          yaml += `- waitFor: ${step.duration}\n`
        } else {
          yaml += `- waitForAnimationToEnd\n`
        }
        break
      case "scroll":
        if (step.direction) {
          yaml += `- scroll: ${step.direction}\n`
        } else {
          yaml += `- scroll\n`
        }
        break
      case "back":
        yaml += `- back\n`
        break
      case "pressKey":
        yaml += `- pressKey: ${step.key || "Enter"}\n`
        break
      case "takeScreenshot":
        const ts = new Date().toISOString().replace(/[:.]/g, "-")
        yaml += `- takeScreenshot: "screenshot_${ts}"\n`
        break
    }
  }
  
  return yaml
}

/**
 * Saves the YAML content to disk with a sanitized filename.
 */
export function saveYaml(yaml: string, appId: string, goal: string, provider: string, outputPath?: string): string {
  const targetDir = path.resolve("outputs/generated")
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })

  let finalPath: string
  if (outputPath) {
    finalPath = path.resolve(outputPath)
  } else {
    // Windows-safe filename: replace illegal chars < > : " / \ | ? *
    const sanitize = (s: string) => s.replace(/[<>:"\/\\|?*\x00-\x1F]/g, "_")
    
    const sanitizedApp = sanitize(appId)
    const sanitizedGoal = sanitize(goal.substring(0, 40)).toLowerCase()
    const sanitizedProvider = sanitize(provider)
    
    finalPath = path.join(targetDir, `${sanitizedApp}_${sanitizedGoal}_${sanitizedProvider}.yaml`)
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(finalPath)
  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true })

  fs.writeFileSync(finalPath, yaml, "utf-8")
  return finalPath
}

/**
 * Executes a Maestro YAML test and captures results.
 */
export async function runMaestroTest(yamlPath: string, retries = 0): Promise<ExecutionResult> {
  const start = Date.now()
  let output = ""
  let passed = false

  const logDir = path.resolve("outputs/logs")
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  
  const yamlFileName = path.basename(yamlPath, ".yaml")
  const logFilePath = path.join(logDir, `${yamlFileName}_run.log`)

  for (let i = 0; i <= retries; i++) {
    try {
      const { stdout, stderr } = await execAsync(`maestro test "${yamlPath}"`, { timeout: 300_000 })
      output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : "")
      passed = !output.toLowerCase().includes("failed") && !output.toLowerCase().includes("error")
    } catch (err: any) {
      output = (err.stdout ?? "") + "\n" + (err.stderr ?? "") + "\n" + (err.message ?? "")
      passed = false
    }

    if (passed) break
    if (i < retries) {
      console.warn(fmt.warn(`Test failed. Retrying... (${i + 1}/${retries})`))
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  fs.writeFileSync(logFilePath, output, "utf-8")

  return { 
    passed, 
    output, 
    durationMs: Date.now() - start, 
    filePath: yamlPath 
  }
}
