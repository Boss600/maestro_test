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
  errorDetail: (msg: string) => `      ${c.red}↳ ${c.dim}${msg}${c.reset}`,
}

export function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const command = argv[0] as any

  if (!command || ["generate", "run", "generate-and-run"].indexOf(command) === -1) {
    if (argv.includes("--help") || argv.includes("-h")) {
      printHelp()
      process.exit(0)
    }
    console.error(fmt.fail("Invalid command. Use 'generate', 'run', or 'generate-and-run'."))
    printHelp()
    process.exit(1)
  }

  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    if (index !== -1 && index + 1 < argv.length) {
      return argv[index + 1]
    }
    return undefined
  }

  const appId = get("--appId")
  const goal = get("--goal")
  const file = get("--file")
  const provider = (get("--provider") || "gemini") as any
  const outputPath = get("--outputPath")

  return {
    command,
    appId,
    goal,
    file,
    provider,
    outputPath,
    help: false
  }
}

export function printHelp() {
  console.log(`
${c.bold}${c.magenta}Maestro AI Test System${c.reset}

${c.bold}Usage:${c.reset}
  npm run dev -- <command> [options]

${c.bold}Commands:${c.reset}
  generate          Generate a Maestro test from a natural language goal.
  run               Execute a saved Maestro YAML test.
  generate-and-run  Generate and then immediately execute the test.

${c.bold}Options:${c.reset}
  --appId <id>      Android package ID (required for generate).
  --goal <text>     Natural language description of the test goal (required for generate).
  --file <path>     Path to the Maestro YAML file (required for run).
  --provider <p>    AI provider: claude, gemini, or groq (default: gemini).
  --outputPath <p>  Specific path to save the generated YAML.
  --help            Show this help message.

${c.bold}Examples:${c.reset}
  npm run dev -- generate --appId com.example --goal "Login and logout"
  npm run dev -- run --file generated/test.yaml
  npm run dev -- generate-and-run --appId com.example --goal "Search for items" --provider claude
`)
}
