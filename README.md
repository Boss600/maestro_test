# Maestro AI Test System 🤖

An AI-driven mobile test automation tool that translates natural language goals into executable Maestro YAML tests. It supports multiple AI providers, automatic APK management, and robust execution on Android devices or emulators.

## 🚀 Key Features

- **Natural Language to Maestro**: Generate structured mobile tests from plain English goals.
- **APK-First Workflow**: Automatically detects package IDs and versions from APKs; installs or updates the app if needed.
- **Multi-Provider AI**: Integrated with **Gemini** (Flash/Pro), **Claude** (3.5 Sonnet), and **Groq** (Llama 3).
- **Intelligent Fallbacks**:
  - **Model Fallback**: Automatically switches from Gemini Flash to Pro on quota issues.
  - **Screenshot Fallback**: Uses Windows PowerShell to capture the screen if ADB screenshotting fails.
- **Deterministic Execution**: Generates clean, validated Maestro YAML that can be version-controlled and run repeatedly.
- **Strict Validation**: Ensures AI-generated steps strictly match allowed Maestro operations (`tapOn`, `inputText`, `scroll`, etc.).
- **Robust Retries**: Built-in exponential backoff for AI API failures (rate limits, timeouts, 503s).

## 🛠️ Usage

### Installation
```bash
npm install
```

### CLI Commands

#### 1. Generate a Test
Generate a Maestro YAML file from a goal without running it.
```bash
npm run dev -- generate --appId com.example.app --goal "Login and check profile" --provider gemini
```

#### 2. Run a Saved Test
Execute an existing Maestro YAML test deterministically.
```bash
npm run dev -- run --file outputs/generated/com_example_app_login_check_profile.yaml
```

#### 3. Generate and Run
The full pipeline: analyze state, generate YAML, and execute immediately.
```bash
npm run dev -- generate-and-run --apk ./my-app.apk --goal "Add item to cart" --provider claude
```

### Options
- `--appId <id>`: Android package ID (required if `--apk` is not used).
- `--apk <path>`: Path to APK (auto-installs if version differs; extracts `appId`).
- `--goal <text>`: Natural language description of the test goal.
- `--file <path>`: Path to a Maestro YAML file (for `run` command).
- `--provider <p>`: AI provider: `gemini` (default), `claude`, or `groq`.
- `--outputPath <p>`: Custom path to save the generated YAML.

## 📁 Project Structure

- `src/index.ts`: CLI entry point and orchestration.
- `src/ai.ts`: AI provider implementations, retry logic, and plan validation.
- `src/maestro.ts`: Maestro YAML generation, ADB bridge, and screenshot logic.
- `src/utils.ts`: APK metadata extraction and installation utilities.
- `outputs/`:
  - `generated/`: Sanitized Maestro YAML files.
  - `logs/`: Detailed execution logs for every test run.
  - `screenshots/`: Captured device states and desktop fallbacks.

## 📄 License
ISC
