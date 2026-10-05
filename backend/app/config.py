from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SwimGPT API"
    api_version: str = "v1"
    env: str = "development"
    supabase_url: str = Field(default="", alias="NEXT_PUBLIC_SUPABASE_URL")
    supabase_secret_key: str = Field(default="", alias="SUPABASE_SECRET_KEY")
    supabase_publishable_key: str = Field(default="", alias="NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY_BOSS")
    openai_model: str = Field(default="gpt-4o-mini", alias="OPENAI_MODEL")
    openai_transcription_model: str = Field(default="gpt-4o-mini-transcribe", alias="OPENAI_TRANSCRIPTION_MODEL")
    openai_speech_model: str = Field(default="gpt-4o-mini-tts", alias="OPENAI_SPEECH_MODEL")
    # Training-plan generation needs precise arithmetic and instruction following; a stronger model by default.
    openai_plan_model: str = Field(default="gpt-4.1", alias="OPENAI_PLAN_MODEL")
    stripe_secret_key: str = Field(default="", alias="STRIPE_SECRET_KEY")
    stripe_publishable_key: str = Field(default="", alias="STRIPE_PUBLISHABLE_KEY")
    frontend_url: str = Field(default="http://localhost:3000", alias="FRONTEND_URL")
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
