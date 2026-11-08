"""Golden Care OS API. Starts the database pool, applies migrations and starting data, mounts /api."""
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.core import errors
from app.routes import api_router
from app.storage import db
from app.storage.migrate import run_migrations
from app.storage.seed import run_seed

logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
log = logging.getLogger("goldencare")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.open_pool()
    with db.pool.connection() as conn:
        run_migrations(conn)
        run_seed(conn)
    log.info("Golden Care API ready")
    yield
    db.close_pool()


app = FastAPI(
    title="Golden Care OS API",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.api_docs else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.api_docs else None,
)
errors.install(app)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def guard_and_log(request: Request, call_next):
    started = time.perf_counter()
    # CSRF protection: browsers can't add this header to cross-site requests without CORS approval.
    if request.method in UNSAFE_METHODS and request.headers.get("x-requested-with") != "GoldenCare":
        return JSONResponse({"error": {"code": "csrf"}}, status_code=403)
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers["X-Content-Type-Options"] = "nosniff"
    elapsed = (time.perf_counter() - started) * 1000
    log.info("%s %s → %s (%.0f ms)", request.method, request.url.path, response.status_code, elapsed)
    return response


app.include_router(api_router)
from app.devshot import router as _devshot  # TEMP
app.include_router(_devshot)  # TEMP
