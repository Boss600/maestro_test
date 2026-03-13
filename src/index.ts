#!/usr/bin/env ts-node
import * as fs from "fs"
import * as path from "path"
import { Args, TestReport } from "./types"
import { parseArgs, fmt, c } from "./cli"
import { generateNextStep } from "./ai"
import { runMaestroTest, captureInitialHierarchy, getHierarchy, takeScreenshot } from "./maestro"
import { getApkMetadata, isAppInstalled, getInstalledVersion, installApk } from "./utils"

async function getAvailableFlows(): Promise<string[]> {
  const flowsDir = path.join(process.cwd(), "flows")
  try {
    const files = await fs.promises.readdir(flowsDir)
    return files.filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))
  } catch (err) {
    return []
  }
}

async function executeAgentLoop(
  args: Args,
  appId: string,
  testDescription: string,
  availableFlows: string[] = []
): Promise<TestReport> {
  console.log(fmt.header(`📝  AGENT TEST: ${testDescription.substring(0, 50)}${testDescription.length > 50 ? "..." : ""}`))
  
  const history: string[] = []
  const memory: Record<string, string> = {}
  let passed = false
  let analysis = ""
  const maxSteps = 15
  const start = Date.now()

  // Ensure app is launched first
  const launchYaml = `appId: ${appId}\n---\n- launchApp: { appId: "${appId}", clearState: true }`
  const launchPath = path.resolve("outputs/generated/agent_launch.yaml")
  fs.writeFileSync(launchPath, launchYaml)
  await runMaestroTest(launchPath, appId)

  for (let step = 1; step <= maxSteps; step++) {
    console.log(fmt.step(step, "Capturing UI state..."))
    const hierarchy = await getHierarchy()
    const screenshotName = `step_${step}_${Date.now()}.png`
    let screenshotPath = ""
    try {
      screenshotPath = await takeScreenshot(screenshotName)
    } catch (err) {
      console.log(fmt.warn("Could not capture screenshot."))
    }
    
    console.log(fmt.step(step, `Thinking (Step ${step}/${maxSteps})...`))
    const nextStep = await generateNextStep(args.model, appId, testDescription, hierarchy, history, screenshotPath, availableFlows, memory)
    
    if (nextStep.toUpperCase() === "DONE") {
      console.log(fmt.success("AI signaled test completion."))
      passed = true
      analysis = "Test completed successfully."
      break
    }

    if (nextStep.startsWith("ERROR:")) {
      console.log(fmt.fail(`AI signaled error: ${nextStep}`))
      passed = false
      analysis = nextStep
      break
    }

    // Handle Data Extraction
    if (nextStep.startsWith("EXTRACT:")) {
      const match = nextStep.match(/EXTRACT:\s*([^=]+)\s*=\s*"([^"]+)"/)
      if (match) {
        const [_, key, value] = match
        memory[key.trim()] = value
        console.log(fmt.success(`Memory Updated: ${key.trim()} = ${value}`))
        history.push(`EXTRACT: ${key.trim()} -> SUCCESS`)
        continue // Skip to next step after extraction
      }
    }

    console.log(fmt.info(`Action: ${nextStep}`))

    // Execute the single step
    const stepYaml = `appId: ${appId}\n---\n${nextStep.startsWith("-") ? nextStep : "- " + nextStep}`
    const stepPath = path.resolve(`outputs/generated/agent_step_${step}.yaml`)
    fs.writeFileSync(stepPath, stepYaml)
    
    const result = await runMaestroTest(stepPath, appId)
    
    if (result.passed) {
      history.push(`${nextStep} -> SUCCESS`)
    } else {
      console.log(fmt.warn(`Action failed at step ${step}.`))
      history.push(`${nextStep} -> FAILED`)
    }
    
    // Safety sleep
    await new Promise(r => setTimeout(r, 1000))
  }

  if (!passed && !analysis) {
    analysis = "Reached maximum steps without completion."
  }

  return {
    passed,
    healed: false,
    durationSec: ((Date.now() - start) / 1000).toFixed(1),
    analysis
  }
}

async function main() {
  const args = parseArgs()

  console.log(fmt.header("🤖  Maestro AI Live Agent"))
  if (args.app) console.log(fmt.label("App ID", args.app))
  if (args.apk) console.log(fmt.label("APK Path", args.apk))
  console.log(fmt.label("Model", args.model.toUpperCase()))

  let appId = args.app
  let apkMetadata = null

  if (args.apk) {
    try {
      apkMetadata = await getApkMetadata(args.apk)
      if (!appId) appId = apkMetadata.packageName
    } catch (err: any) {
      console.error(fmt.fail(`Could not analyze APK: ${err.message}`))
      process.exit(1)
    }
  }

  if (args.apk && appId && !args.dryRun) {
    try {
      const isInstalled = await isAppInstalled(appId)
      let shouldInstall = !isInstalled
      if (isInstalled && apkMetadata) {
        const installedVersion = await getInstalledVersion(appId)
        if (installedVersion !== apkMetadata.versionName) shouldInstall = true
      }
      if (shouldInstall) {
        console.log(fmt.info(`Installing ${path.basename(args.apk)}...`))
        await installApk(args.apk)
      }
    } catch (err: any) {}
  }

  if (!appId) {
    console.error(fmt.fail("App ID missing."))
    process.exit(1)
  }

  const tests: { description: string; file?: string }[] = []
  if (args.test) {
    tests.push({ description: args.test })
  } else if (args.suite) {
    const suiteDir = path.resolve(args.suite)
    const files = fs.readdirSync(suiteDir).filter(f => f.endsWith(".txt") || f.endsWith(".feature"))
    for (const file of files) {
      tests.push({ description: fs.readFileSync(path.join(suiteDir, file), "utf-8"), file })
    }
  }

  const availableFlows = await getAvailableFlows()
  const summary: any[] = []
  for (const test of tests) {
    const report = await executeAgentLoop(args, appId, test.description, availableFlows)
    summary.push({ ...test, ...report })
  }

  console.log(fmt.header("📊  AGENT SUMMARY"))
  summary.forEach((res, i) => {
    const status = res.passed ? `${c.green}PASSED${c.reset}` : `${c.red}FAILED${c.reset}`
    console.log(`${c.dim}[${i + 1}]${c.reset} ${status.padEnd(20)} ${res.file ?? "Manual Test"}`)
    if (!res.passed) console.log(`      ${c.red}Error: ${res.analysis}${c.reset}`)
  })
}

main().catch((err) => {
  console.error(fmt.fail(`Unexpected error: ${err.message}`))
  process.exit(1)
})
