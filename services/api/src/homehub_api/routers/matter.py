from fastapi import APIRouter, Depends

from homehub_api.cores3_products import CORES3_PRODUCTS
from homehub_api.dependencies import get_store
from homehub_api.matter_commission import get_commission, start_commission
from homehub_api.models import (
    CreateMatterCommissionRequest,
    MatterCommissionResponse,
    MatterProductListResponse,
    MatterProductResponse,
)
from homehub_api.observability import MetricUnit, logger, metrics, tracer
from homehub_api.store import HubStore

router = APIRouter(prefix="/matter")


@router.get("/products", response_model=MatterProductListResponse)
def list_matter_products() -> MatterProductListResponse:
    return MatterProductListResponse(
        items=[MatterProductResponse.model_validate(product) for product in CORES3_PRODUCTS]
    )


@router.post("/commission", response_model=MatterCommissionResponse, status_code=202)
@tracer.capture_method
def create_matter_commission(
    payload: CreateMatterCommissionRequest,
    store: HubStore = Depends(get_store),
) -> MatterCommissionResponse:
    job = start_commission(
        store,
        product_id=payload.product_id,
        setup_payload=payload.setup_payload,
        gateway_id=payload.gateway_id,
        name=payload.name,
        location=payload.location,
    )
    metrics.add_metric(name="MatterCommissionStarted", unit=MetricUnit.Count, value=1)
    logger.info(
        "Matter commission started",
        extra={
            "commission_id": job["commissionId"],
            "product_id": job["productId"],
            "gateway_id": job["gatewayId"],
            "node_id": job["nodeId"],
        },
    )
    return MatterCommissionResponse.model_validate(job)


@router.get("/commission/{commission_id}", response_model=MatterCommissionResponse)
@tracer.capture_method
def read_matter_commission(
    commission_id: str,
    store: HubStore = Depends(get_store),
) -> MatterCommissionResponse:
    job = get_commission(store, commission_id)
    return MatterCommissionResponse.model_validate(job)
