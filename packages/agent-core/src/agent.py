"""Amazon Bedrock AgentCore starter entrypoint (Python + Strands)."""

from bedrock_agentcore import BedrockAgentCoreApp
from strands import Agent

app = BedrockAgentCoreApp()
agent = Agent()


@app.entrypoint
def invoke(payload: dict) -> dict:
    """Process a simple prompt payload through the Strands agent."""
    user_message = payload.get("prompt", "Hello! How can I help you today?")
    result = agent(user_message)
    return {"result": result.message}


if __name__ == "__main__":
    app.run()
