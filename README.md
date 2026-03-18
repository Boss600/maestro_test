# Maestro AI Agent

This project is an AI-driven system for automating mobile UI tests using the Maestro framework. It has three main parts:

1.  **AI Agent (`src/`)**: A command-line tool that uses AI (like Claude, Gemini, or Groq) to automatically generate Maestro YAML test files from a natural language goal (e.g., "log into the app").
2.  **Reusable Flow Library (`flows/`)**: A collection of pre-made Maestro YAML files for common actions (e.g., opening a settings page).
3.  **Manual Test Plans (`test-suite/`)**: Human-readable `.txt` files describing complex test scenarios, which instruct a QA tester on which reusable flows to run.

## Project Structure

*   `src/`: Contains the core source code for the AI agent.
    *   `ai.ts`: Manages interactions with AI models (Gemini, Claude, etc.) to generate tests.
    *   `cli.ts`: Defines the command-line interface (e.g., the `generate` and `run` commands).
    *   `index.ts`: The main entry point that starts the application.
    *   `maestro.ts`: The bridge that communicates with the Maestro and `adb` command-line tools to control the device.
    *   `types.ts`: Defines custom data types and interfaces used throughout the project.
    *   `utils.ts`: Contains miscellaneous helper functions.
*   `flows/`: A library of reusable, pre-written Maestro test files (`.yaml`) for common actions.
*   `test-suite/`: Contains high-level, human-readable test plans (`.txt`) that describe manual QA scenarios.
*   `outputs/`: The default directory for all generated files.
    *   `generated/`: Where newly AI-generated Maestro test files are saved.
    *   `logs/`: Where logs from test executions are stored.
    *   `screenshots/`: Where screenshots captured during test runs are saved.
*   `assets/`: Contains static image assets.
*   `package.json`: Defines the project's metadata, dependencies, and `npm` scripts.
*   `.env.example`: A template showing the required environment variables (like API keys) needed to run the project.
*   `tsconfig.json`: Configuration file for the TypeScript compiler.
*   `.gitignore`: A list of files and directories that Git should ignore.

## How to Run Tests

Testing involves using the AI agent to either `generate` a new test flow or `run` an existing one.

### Prerequisites:

1.  **Install Dependencies**: Run `npm install`.
2.  **Install Tools**: You need the [Maestro CLI](https://maestro.mobile.dev/getting-started/installing-maestro) and [Android Debug Bridge (adb)](https://developer.android.com/tools/adb) installed and available in your system's PATH.
3.  **Connect Device**: Connect an Android device with USB debugging enabled, or start an Android emulator. Verify with `adb devices`.
4.  **Set API Keys**: Create a `.env` file in the project root (using `.env.example` as a template) and add the necessary API keys for your chosen AI provider (e.g., `GEMINI_API_KEY=...`).

### Gemini Model Configuration

The Gemini AI agent now dynamically discovers available Gemini models for your API key. This means you do not need to specify `GEMINI_MODEL` or `GEMINI_MODEL_SECONDARY` in your `.env` file. Simply setting `GEMINI_API_KEY` is sufficient. The tool will automatically select a compatible Gemini model that supports content generation.

### Step-by-Step Guide to Run a Test:

**Option 1: Generate a New Test**
This creates a new test flow from scratch using AI.

1.  Open your terminal.
2.  Use the `generate` command with the app's package ID and your goal.
    ```bash
    npm run dev -- generate --appId com.example.app --goal "Tap on the login button, then enter username and password"
    ```
3.  The tool will analyze the app, call the AI, and save the resulting Maestro YAML file in `outputs/generated/`.

**Option 2: Run an Existing Test**
This executes a pre-written Maestro file.

1.  Open your terminal.
2.  Use the `run` command with the path to the `.yaml` file.
    ```bash
    npm run dev -- run --file flows/system_settings.yaml
    ```
3.  The tool will run the test on your device and show the result. Logs are saved in `outputs/logs/`.

**Option 3: Generate and Run Immediately**

1.  Open your terminal.
2.  Use the `generate-and-run` command.
    ```bash
    npm run dev -- generate-and-run --appId com.example.app --goal "Go to the profile page"
    ```
3.  This generates the test and immediately runs it.