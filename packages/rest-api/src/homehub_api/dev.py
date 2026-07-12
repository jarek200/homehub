"""Run FastAPI locally with an in-memory fake store."""

import uvicorn

from homehub_api.main import create_app
from homehub_api.fake_store import FakeHubStore

store = FakeHubStore()
store.seed_demo_devices()
app = create_app(store=store)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
