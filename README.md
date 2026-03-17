# Maestro AI Live Agent 🤖

An AI-driven mobile test automation agent that translates natural language descriptions into Maestro commands, executes them on real devices or emulators, and self-heals using vision when steps fail.

## 🚀 Key Features

- **Natural Language Testing**: Write tests in plain English or Gherkin.
- **Intelligent Dual-Agent Loop**: 
  - **Text-Only Reasoner**: Uses UI Hierarchy (XML) for fast, cost-effective execution.
  - **Vision-Heal**: Automatically captures screenshots and switches to Vision models when it encounters unlabelled icons or failed steps.
- **Robust Multi-Model Support**: Integrated with Gemini, Claude, OpenAI, and Groq.
- **Self-Healing Architecture**: Automatically retries transient failures and switches models (e.g., Flash -> Pro) if quotas are exhausted.
- **Cross-Platform Reliability**: 
  - Full Windows and Unix/Linux support.
  - **Intelligent Fallback**: Can capture the Windows desktop if ADB screenshotting fails, allowing the AI to "see" the emulator.
- **Structured Observability**: 
  - Detailed CLI error reporting with exact failure extraction.
  - `session_steps.jsonl` for machine-readable execution history.
  - Comprehensive logging of every AI decision and Maestro action.

## 🛠️ Usage

### Installation
```bash
npm install
```

### Running a Test
```bash
# Run a single manual test
npx ts-node src/index.ts --app com.example.app --test "Open settings and toggle dark mode"

# Run a test suite from a directory
npx ts-node src/index.ts --apk ./app.apk --suite ./test-suite/
```

### Arguments
- `--app <appId>`: Android package ID.
- `--apk <path>`: Path to APK (auto-installs if version differs).
- `--test "<desc>"`: The test description.
- `--suite <dir>`: Directory containing `.txt` or `.feature` files.
- `--model <name>`: `gemini` (default), `claude`, `openai`, or `groq`.

## 📁 Project Structure

- `src/index.ts`: Orchestration loop and CLI entry point.
- `src/ai.ts`: AI model interfaces, prompts, and retry/switching logic.
- `src/maestro.ts`: Maestro CLI/ADB bridge and screenshot logic.
- `src/utils.ts`: Device and APK utilities.
- `outputs/`: 
  - `generated/`: Temp YAML flows created by the AI.
  - `logs/`: Maestro execution logs and structured `session_steps.jsonl`.
  - `screenshots/`: Captured UI and desktop fallbacks.

## 📄 License
ISC
