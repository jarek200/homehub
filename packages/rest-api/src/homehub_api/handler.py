from mangum import Mangum

from homehub_api.main import app

handler = Mangum(app, lifespan="off")
