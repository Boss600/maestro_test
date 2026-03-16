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
   Create a `.env` file (see `.env.example`):
   ```bash
   GROQ_API_KEY=your_key
   OPENAI_API_KEY=your_key
   ANTHROPIC_API_KEY=your_key
   GEMINI_API_KEY=your_key
   ```

## 🏃 Running Tests

### Single Test
```bash
npm start -- --app com.android.settings --test "Open Network settings and verify Wi-Fi is enabled"
```

### Test Suite
```bash
npm start -- --app com.android.settings --suite test-suite/
```

### Options
- `--model`: `claude`, `gemini`, `groq`, or `openai` (default: auto-detected based on available keys)
- `--apk`: Path to an APK file (will be installed automatically)
- `--dry-run`: Generate the test flow without executing it
- `--no-hierarchy`: Skip capturing UI hierarchy (saves tokens)

### Custom Models
You can override default models in `.env`:
```bash
GROQ_MODEL=llama-3.3-70b-versatile
OPENAI_MODEL=gpt-4o
```
## 📝 License

ISC
