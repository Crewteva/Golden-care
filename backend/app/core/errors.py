"""One error format for the whole API:

    {"error": {"code": "email_taken", "fields": {"email": "taken"}, ...}}

The frontend turns `code` and the field codes into Arabic / English messages.
"""
import logging

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger(__name__)


class AppError(Exception):
    def __init__(self, status: int, code: str, *, fields: dict | None = None, **extra):
        super().__init__(code)
        self.status = status
        self.code = code
        self.fields = fields or {}
        self.extra = extra


def field_error(field: str, code: str, status: int = 422) -> AppError:
    return AppError(status, "validation", fields={field: code})


def _body(code: str, fields: dict | None = None, **extra) -> dict:
    error = {"code": code, **extra}
    if fields:
        error["fields"] = fields
    return {"error": error}


def install(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError):
        return JSONResponse(jsonable_encoder(_body(exc.code, exc.fields, **exc.extra)), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        fields = {}
        for err in exc.errors():
            loc = [str(part) for part in err.get("loc", []) if part not in ("body", "query", "path")]
            name = ".".join(loc) or "body"
            kind = err.get("type", "invalid")
            if kind in ("missing", "string_too_short") and name not in fields:
                fields[name] = "required" if kind == "missing" else "too_short"
            else:
                fields.setdefault(name, "invalid" if kind != "string_too_long" else "too_long")
        return JSONResponse(_body("validation", fields), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "error")
        return JSONResponse(_body(code), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(_body("server_error"), status_code=500)
