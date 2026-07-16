"""HomeHub device simulator — SQS reconciler + MQTT virtual devices."""

from __future__ import annotations

import logging
import os
import signal
import sys
import threading
import time

from simulator.reconciler import Reconciler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("homehub.simulator")


def main() -> None:
    table_name = os.environ.get("TABLE_NAME", "").strip()
    queue_url = os.environ.get("SQS_QUEUE_URL", "").strip()
    if not table_name or not queue_url:
        logger.error("TABLE_NAME and SQS_QUEUE_URL are required")
        sys.exit(1)

    reconciler = Reconciler(table_name=table_name, queue_url=queue_url)
    try:
        reconciler.bootstrap_online_devices()
    except Exception:
        # Do not crash the container on bootstrap failure (Lightsail marks that FAILED).
        logger.exception("Bootstrap of online devices failed; continuing to poll SQS")
    stop_event = threading.Event()

    def shutdown(_signum: int, _frame: object) -> None:
        logger.info("Shutting down simulator")
        stop_event.set()
        reconciler.stop_all()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    logger.info("Starting HomeHub device simulator")
    while not stop_event.is_set():
        try:
            reconciler.poll_once()
        except Exception:
            logger.exception("Reconciler poll failed")
            time.sleep(5)

    reconciler.stop_all()
    logger.info("Simulator stopped")


if __name__ == "__main__":
    main()
