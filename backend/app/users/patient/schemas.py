from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class RegisterIn(BaseModel):
    full_name_ar: str = Field(min_length=2, max_length=120)
    full_name_en: str | None = Field(default=None, max_length=120)
    phone: str = Field(min_length=8, max_length=30)
    email: str | None = Field(default=None, max_length=200)
    date_of_birth: date
    gender: Literal["female", "male"]
    password: str = Field(min_length=1, max_length=200)
    accept_terms: bool
    consent_messages: bool = False


class ProfileUpdate(BaseModel):
    email: str | None = Field(default=None, max_length=200)
    preferred_lang: Literal["ar", "en"]
    consent_messages: bool
