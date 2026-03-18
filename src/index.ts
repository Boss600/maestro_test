#!/usr/bin/env ts-node
import "dotenv/config"
import { parseArgs, fmt, printHelp } from "./cli"
import { getProvider } from "./ai"
import { 
  checkDevice, 
  getHierarchy, 
  takeScreenshot, 
  generateMaestroYaml, 
  saveYaml, 
  runMaestroTest,
  launchApp
} from "./maestro"
import * as fs from "fs"
import * as path from "path"
import * as utils from "./utils"

/**
 * PHASE 1: GENERATE
 * Analyze app context, call LLM, produce structured plan, render YAML, and save.
 */
async function generate(appId: string, goal: string, providerName: string, outputPath?: string) {
  console.log(fmt.header(`GENERATING MOBILE TEST`))
  console.log(fmt.label("App ID", appId))
  console.log(fmt.label("Goal", goal))
  console.log(fmt.label("Provider", providerName))

  // 1. Connectivity Check
  console.log(fmt.step(1, "Verifying Android device connection..."))
  await checkDevice()

  // 2. Launch Target App
  console.log(fmt.step(2, `Launching app: ${appId}`))
  await launchApp(appId)

  // 3. Capture Initial State
  console.log(fmt.step(3, "Capturing UI state (hierarchy & screenshot)..."))
  const hierarchy = await getHierarchy()
  let screenshotPath: string | undefined
  try {
    screenshotPath = await takeScreenshot("initial_state.png")
  } catch (err: any) {
    console.warn(fmt.warn(`State capture warning: ${err.message}`))
  }

  // 4. AI Planning
  console.log(fmt.step(4, "Consulting AI for test plan..."))
  const provider = getProvider(providerName)
  const plan = await provider.generatePlan(appId, goal, { hierarchy, screenshotPath })
  
  console.log(fmt.success(`Structured plan received: "${plan.testName}"`))
  console.log(fmt.info(`Generated ${plan.steps.length} steps.`))

  // 5. YAML Rendering
  console.log(fmt.step(5, "Rendering Maestro YAML..."))
  const yaml = generateMaestroYaml(plan)

  // 6. Persistence
  console.log(fmt.step(6, "Saving generated test to disk..."))
  const savedPath = saveYaml(yaml, appId, goal, providerName, outputPath)
  console.log(fmt.success(`Maestro test saved: ${savedPath}`))
  
  return savedPath
}

/**
 * PHASE 2: RUN
 * Load saved YAML and execute simply via Maestro.
 */
async function run(filePath: string) {
  console.log(fmt.header("EXECUTING MAESTRO TEST"))
  console.log(fmt.label("File", filePath))

  if (!fs.existsSync(filePath)) {
    throw new Error(`Test file not found: ${filePath}`)
  }

  // 1. Connectivity Check
  console.log(fmt.step(1, "Verifying Android device connection..."))
  await checkDevice()

  // 2. Execute
  console.log(fmt.step(2, "Running maestro test (deterministic)..."))
  const result = await runMaestroTest(filePath)

  if (result.passed) {
    console.log(fmt.success("Test passed successfully!"))
  } else {
    console.log(fmt.fail("Test execution failed."))
    console.log(fmt.errorDetail(result.output.substring(0, 800) + (result.output.length > 800 ? "..." : "")))
  }

  return result
}

/**
 * Handles APK metadata extraction and installation if necessary.
 */
async function handleApkWorkflow(apkPath: string, providedAppId?: string): Promise<string> {
  console.log(fmt.header("APK PREPARATION"))
  
  if (!fs.existsSync(apkPath)) {
    throw new Error(`APK file not found at: ${apkPath}`)
  }

  console.log(fmt.step(1, "Extracting APK metadata..."))
  const metadata = await utils.getApkMetadata(apkPath)
  const appId = metadata.packageName
  
  console.log(fmt.label("Package", appId))
  console.log(fmt.label("Version", metadata.versionName))

  if (providedAppId && providedAppId !== appId) {
    console.warn(fmt.warn(`Warning: Provided appId (${providedAppId}) does not match APK package (${appId}). Using APK package.`))
  }

  console.log(fmt.step(2, "Checking device installation..."))
  await checkDevice()
  
  const isInstalled = await utils.isAppInstalled(appId)
  const installedVersion = isInstalled ? await utils.getInstalledVersion(appId) : null

  if (!isInstalled || installedVersion !== metadata.versionName) {
    const reason = !isInstalled ? "App not installed" : `Version mismatch (installed: ${installedVersion})`
    console.log(fmt.warn(`${reason}. Installing APK: ${path.basename(apkPath)}...`))
    await utils.installApk(apkPath)
    console.log(fmt.success("APK installed successfully."))
  } else {
    console.log(fmt.success("Correct app version already installed."))
  }

  return appId
}

async function main() {
  const rawArgs = parseArgs() as any
  
  // Manually parse --apk since we are restricted from modifying cli.ts
  const apkIndex = process.argv.indexOf("--apk")
  const apkPath = (apkIndex !== -1 && apkIndex + 1 < process.argv.length) ? process.argv[apkIndex + 1] : undefined

  try {
    switch (rawArgs.command) {
      case "generate":
      case "generate-and-run":
        // 1. APK Workflow (Optional)
        let effectiveAppId = rawArgs.appId
        if (apkPath) {
          effectiveAppId = await handleApkWorkflow(apkPath, rawArgs.appId)
        }

        // 2. Validation
        if (!effectiveAppId || !rawArgs.goal) {
          console.error(fmt.fail("Missing --appId (or --apk) and --goal for test generation."))
          printHelp()
          process.exit(1)
        }

        // 3. Execution
        const savedFile = await generate(effectiveAppId, rawArgs.goal, rawArgs.provider, rawArgs.outputPath)
        
        if (rawArgs.command === "generate-and-run") {
          await run(savedFile)
        }
        break

      case "run":
        if (!rawArgs.file) {
          console.error(fmt.fail("Missing --file for 'run' mode."))
          printHelp()
          process.exit(1)
        }
        await run(rawArgs.file)
        break
        
      default:
        printHelp()
        break
    }
  } catch (err: any) {
    console.error(fmt.fail(`Fatal Error: ${err.message}`))
    process.exit(1)
  }
}

main()
