# UX SpecForge

UX SpecForge is a local web tool for turning PRD and design evidence into a reviewable UI flow map, AI-polished cross-platform interaction specs, and generated spec documents for H5, Android, iOS, and game clients.

## Local Web

1. Install dependencies:

```bash
npm install
```

2. Create local environment config:

```bash
cp .env.example .env
```

3. Fill `ANTHROPIC_API_KEY` in `.env` for real AI calls.

4. Build and run the local web server:

```bash
npm run local:web
```

5. Open the app:

[http://127.0.0.1:8787](http://127.0.0.1:8787)

The production local web path serves the built Vite app and the Express `/api/*` routes from one local origin. It does not require Rust, Tauri, or a Tauri webview.

## Docker

1. Make sure `.env` exists and contains at least `ANTHROPIC_API_KEY` for real AI calls.

2. Build and start the container:

```bash
docker compose up --build
```

For background mode:

```bash
docker compose up --build -d
```

3. Open:

[http://127.0.0.1:8787](http://127.0.0.1:8787)

4. Stop:

```bash
docker compose down
```

The container listens on `0.0.0.0` internally so Docker port forwarding works, but Compose publishes it only to `127.0.0.1:8787` on the host. Generated specs and caches are mounted at `./generated` and `./.cache`.

## Environment

Required:

- `ANTHROPIC_API_KEY`: API key used by the local Express proxy.

Common local settings:

- `LOCAL_PROXY_PORT=8787`: local API/web port.
- `LOCAL_PROXY_HOST=127.0.0.1`: host binding for direct local runs.
- `DISABLE_STATIC_WEB=false`: set to `true` to disable Express static serving.
- `ANTHROPIC_BASE_URL=https://litellm.wenext.technology/`: optional compatible API base URL.
- `CLAUDE_MODEL=gpt-5.5`: model name used by the server.
- `MOCK_DECOMPOSE=false`: set to `true` for local decomposition smoke work without model calls.

PRD decomposition tuning:

- `DECOMPOSITION_CALL_TIMEOUT_MS=180000`: timeout for each model call.
- `DECOMPOSITION_L1_CONCURRENCY=3`: number of parallel L1 PRD slice readers for large documents.
- `DECOMPOSITION_BRANCH_CONCURRENCY=2`: number of parallel page-branch polish calls.
- `LARGE_PRD_SLICE_TARGET_LENGTH=16384`: target characters per large-PRD slice. Increase this when the model context window is large and stable.
- `DECOMPOSITION_L1_REDUCER_MAX_CANDIDATES=48`: max slice candidates sent into the final merge pass.
- `DECOMPOSITION_L1_REDUCER_CONTEXT_CHARS=36000`: approximate text budget for the final merge pass.

Optional integrations:

- `FIGMA_TOKEN`: enables Figma import.
- `LARK_CLI_BIN=lark-cli`, `LARK_IDENTITY=user`, and Lark credential fields enable Feishu/Lark import.

## Verification

Build the app:

```bash
npm run build
```

With the server running on `http://127.0.0.1:8787`, run:

```bash
npm run smoke:local-web
```

Health endpoint:

[http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health)

## Troubleshooting

- If the browser loads but AI actions fail, check `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` in `.env`.
- If `npm run smoke:local-web` cannot connect, confirm `npm run start` or `docker compose up` is running and that port `8787` is free.
- If Docker starts but the app is unreachable, run `docker compose ps` and confirm port mapping includes `127.0.0.1:8787->8787/tcp`.
- If Figma or Lark imports fail, verify optional credentials and that required CLIs are available inside the environment you are using.
