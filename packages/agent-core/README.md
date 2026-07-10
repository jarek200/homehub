# Python Bedrock AgentCore Starter — `packages/agent-core`

This folder follows the official **Amazon Bedrock AgentCore starter toolkit** flow for **Python**.

## Prerequisites

- **Python 3.10+**
- **AWS credentials** with permissions for the toolkit
- **Bedrock model access** enabled for the models your Strands agent will use

## 1. Create a virtual environment

```bash
cd packages/agent-core
python3 -m venv .venv
source .venv/bin/activate
```

## 2. Install dependencies

```bash
pip install -r requirements.txt
agentcore --help
```

This installs:
- `bedrock-agentcore`
- `strands-agents`
- `bedrock-agentcore-starter-toolkit`

## 3. Configure the runtime

```bash
cd packages/agent-core
source .venv/bin/activate
agentcore configure --entrypoint src/agent.py
```

The CLI creates **`.bedrock_agentcore.yaml`** for local dev and deploy.

## 4. Run locally

Preferred (toolkit runtime emulator):

```bash
cd packages/agent-core
source .venv/bin/activate
agentcore dev
```

In another terminal:

```bash
cd packages/agent-core
source .venv/bin/activate
agentcore invoke --dev '{"prompt": "Hello!"}'
```

Quick direct run from repo root:

```bash
pnpm agent:python
```

`pnpm agent:python` uses `.venv/bin/python` if present, otherwise falls back to `python3`.

## 5. Deploy

```bash
cd packages/agent-core
source .venv/bin/activate
agentcore deploy
```

Save the runtime ARN from the output, then invoke with:

```bash
agentcore invoke '{"prompt": "tell me a joke"}'
```

## 6. Clean up

```bash
cd packages/agent-core
source .venv/bin/activate
agentcore destroy
```

## Monorepo notes

- This folder is **Python-first**, not a pnpm workspace package.
- SST (`sst.config.ts`) is unchanged; AgentCore deploy is separate until you wire IAM/outputs in `infra/`.
- Do not commit secrets inside `.bedrock_agentcore.yaml` or shell history.
