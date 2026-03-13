# Maestro AI Live Agent

An autonomous test agent for [Maestro](https://maestro.mobile.dev/) that uses AI (Claude or Gemini) to explore and test Android applications.

## 🚀 Features

- **Autonomous Exploration**: AI analyzes UI hierarchy and screenshots to decide the next step.
- **Natural Language Support**: Write tests in plain English or Gherkin.
- **Maestro Integration**: Generates and executes Maestro YAML flows on the fly.
- **Multimodal**: Supports both UI hierarchy analysis and screenshot-based reasoning.

## 🛠 Project Structure

- `src/`: TypeScript source code for the AI agent.
- `flows/`: Reusable Maestro YAML flows (subflows).
- `test-suite/`: Text/Gherkin test scenario descriptions.
- `assets/`: Project assets (images, icons).
- `outputs/`: Generated test flows, logs, and screenshots.

## ⚙️ Setup

1. **Prerequisites**:
   - Node.js (v16+)
   - [Maestro CLI](https://maestro.mobile.dev/getting-started/installing-maestro) installed.
   - An Android emulator or device connected.

2. **Installation**:
   ```bash
   npm install
   ```

3. **Environment Variables**:
   Set your API keys:
   ```bash
   export ANTHROPIC_API_KEY=your_key
   # OR
   export GEMINI_API_KEY=your_key
   ```

## 🏃 Running Tests

### Single Test
```bash
npx ts-node src/index.ts --app com.android.settings --test "Open Network settings and verify Wi-Fi is enabled"
```

### Test Suite
```bash
npx ts-node src/index.ts --app com.android.settings --suite test-suite/
```

### Options
- `--model`: `claude` (default) or `gemini`
- `--apk`: Path to an APK file (will be installed automatically)
- `--dry-run`: Generate the test flow without executing it

## 📝 License

ISC
