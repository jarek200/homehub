from fastapi import APIRouter, Depends

from homehub_api.auth import verify_api_key_or_jwt
from homehub_api.dependencies import get_store
from homehub_api.errors import ApiError
from homehub_api.models import (
    CreateIssueRequest,
    IssueListResponse,
    IssueResponse,
    UpdateIssueRequest,
)
from homehub_api.store import HubStore

router = APIRouter(prefix="/issues", dependencies=[Depends(verify_api_key_or_jwt)])


@router.get("", response_model=IssueListResponse)
def list_issues(store: HubStore = Depends(get_store)) -> IssueListResponse:
    return IssueListResponse(items=store.list_issues())


@router.post("", response_model=IssueResponse, status_code=201)
def create_issue(
    payload: CreateIssueRequest,
    store: HubStore = Depends(get_store),
) -> IssueResponse:
    return store.create_issue(payload)


@router.get("/{issue_id}", response_model=IssueResponse)
def get_issue(issue_id: str, store: HubStore = Depends(get_store)) -> IssueResponse:
    issue = store.get_issue(issue_id)
    if not issue:
        raise ApiError("Issue not found", 404, "NotFound")
    return issue


@router.patch("/{issue_id}", response_model=IssueResponse)
def update_issue(
    issue_id: str,
    payload: UpdateIssueRequest,
    store: HubStore = Depends(get_store),
) -> IssueResponse:
    return store.update_issue(issue_id, payload)
