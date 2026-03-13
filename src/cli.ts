import { Args } from "./types"

export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
}

export const fmt = {
  step: (n: number, msg: string) =>
    `${c.dim}[${n}]${c.reset} ${c.cyan}${msg}${c.reset}`,
  success: (msg: string) => `${c.green}✔${c.reset}  ${msg}`,
  fail: (msg: string) => `${c.red}✘${c.reset}  ${msg}`,
  warn: (msg: string) => `${c.yellow}⚠${c.reset}  ${msg}`,
  info: (msg: string) => `${c.dim}ℹ${c.reset}  ${c.dim}${msg}${c.reset}`,
  header: (msg: string) =>
    `\n${c.bold}${c.magenta}${"─".repeat(50)}${c.reset}\n${c.bold}${c.white}  ${msg}${c.reset}\n${c.bold}${c.magenta}${"─".repeat(50)}${c.reset}`,
  label: (key: string, val: string) =>
    `  ${c.dim}${key}:${c.reset} ${c.cyan}${val}${c.reset}`,
}

export function parseArgs(): Args {
  const args = process.argv.slice(2)

  if (args.includes("--help") || args.includes("-h")) {
    printHelp()
    process.exit(0)
  }

  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }

  const app = get("--app")
  const apk = get("--apk")
  const test = get("--test")
  const suite = get("--suite")

  if (!app && !apk) {
    console.error(
      fmt.fail("Missing required argument: --app or --apk is required.\n")
    )
    printHelp()
    process.exit(1)
  }

  if (!test && !suite) {
    console.error(
      fmt.fail("Either --test or --suite must be provided.\n")
    )
    printHelp()
    process.exit(1)
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY

  const defaultModel = anthropicKey ? "claude" : (geminiKey ? "gemini" : "claude")

  return {
    app,
    apk,
    test,
    suite,
    model: (get("--model") as "claude" | "gemini") ?? defaultModel,
    output: get("--output") ?? "outputs/generated/generated.yaml",
    dryRun: args.includes("--dry-run"),
    noHierarchy: args.includes("--no-hierarchy"),
    help: false,
  }
}

export function printHelp() {
  console.log(`
${c.bold}${c.magenta}Maestro AI Test Generator${c.reset}

${c.bold}Usage:${c.reset}
  npx ts-node src/index.ts [--app <appId> | --apk <path>] [--test "<desc>" | --suite <dir>] [options]

${c.bold}Required:${c.reset}
  --app    <appId>        Android package ID (e.g. com.google.android.calculator)
  --apk    <path>         Path to a local .apk file to install and test
  --test   "<text>"       Natural language or Gherkin description of the test
  OR
  --suite  <dir>          Directory containing .feature or .txt test descriptions

${c.bold}Options:${c.reset}
  --model  claude|gemini  AI model to use (default: claude)
  --output <file>         Output YAML filename (default: outputs/generated/generated.yaml)
  --dry-run               Generate YAML only, skip execution
  --no-hierarchy          Skip capturing UI hierarchy (saves tokens)
  --help                  Show this help message
`)
}
