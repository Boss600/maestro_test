import { exec } from "child_process"
import { promisify } from "util"
import * as path from "path"

const execAsync = promisify(exec)

// Hardcoded for now based on discovery, but could be made configurable
const AAPT_PATH = `C:\\Users\\CalebD\\AppData\\Local\\Android\\Sdk\\build-tools\\36.1.0\\aapt.exe`

export interface ApkMetadata {
  packageName: string
  versionName: string
  versionCode: string
}

export async function getApkMetadata(apkPath: string): Promise<ApkMetadata> {
  try {
    const { stdout } = await execAsync(`"${AAPT_PATH}" dump badging "${apkPath}"`)
    
    const packageMatch = stdout.match(/package: name='([^']+)'/)
    const versionMatch = stdout.match(/versionName='([^']+)'/)
    const codeMatch = stdout.match(/versionCode='([^']+)'/)

    if (packageMatch && packageMatch[1]) {
      return {
        packageName: packageMatch[1],
        versionName: versionMatch ? versionMatch[1] : "unknown",
        versionCode: codeMatch ? codeMatch[1] : "0"
      }
    }
    throw new Error("Could not find package metadata in aapt output.")
  } catch (err) {
    throw new Error(`Failed to extract metadata from APK: ${(err as Error).message}`)
  }
}

export async function isAppInstalled(appId: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`adb shell pm list packages ${appId}`)
    return stdout.includes(`package:${appId}\n`) || stdout.trim() === `package:${appId}`
  } catch (err) {
    return false
  }
}

export async function getInstalledVersion(appId: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`adb shell dumpsys package ${appId}`)
    const match = stdout.match(/versionName=([^\n\r]+)/)
    return match ? match[1].trim() : null
  } catch (err) {
    return null
  }
}

export async function installApk(apkPath: string): Promise<void> {
  try {
    // -r: replace existing application
    // -t: allow test packages
    // -g: grant all runtime permissions
    await execAsync(`adb install -r -t -g "${apkPath}"`)
  } catch (err) {
    throw new Error(`Failed to install APK: ${(err as Error).message}`)
  }
}
