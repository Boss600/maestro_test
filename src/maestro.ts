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
  const screenshotDir = path.join(process.cwd(), "outputs/screenshots")
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true })

  const filePath = path.join(screenshotDir, fileName)
  const remotePath = "/sdcard/screen.png"
  const timeout = 30_000

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
    // Re-throw the specific error from the steps above
    throw new Error(`Failed to capture screenshot: ${(err as Error).message}`)
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
