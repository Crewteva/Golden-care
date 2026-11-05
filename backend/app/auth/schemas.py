from typing import Literal

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=12)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=200)


class RoleIn(BaseModel):
    role: str = Field(min_length=2, max_length=40)
    branch_id: int | None = None


class ForgotIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=200)


class PreferencesIn(BaseModel):
    preferred_lang: Literal["ar", "en"]


class MfaDisableIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    code: str = Field(min_length=6, max_length=12)
