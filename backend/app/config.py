from functools import lru_cache
from typing import Any

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
    # The coach's chat replies and the daily plan. A voice call's replies never reason (see main.coach_chat).
    openai_model: str = Field(default="gpt-5.5", alias="OPENAI_MODEL")
    # Only for GPT-5 models: how much they reason before answering.
    openai_reasoning_effort: str = Field(default="low", alias="OPENAI_REASONING_EFFORT")
    openai_transcription_model: str = Field(default="gpt-4o-mini-transcribe", alias="OPENAI_TRANSCRIPTION_MODEL")
    openai_speech_model: str = Field(default="gpt-4o-mini-tts", alias="OPENAI_SPEECH_MODEL")
    # Training-plan generation needs precise arithmetic and instruction following; a stronger model by default.
    openai_plan_model: str = Field(default="gpt-5.5", alias="OPENAI_PLAN_MODEL")
    # Only for GPT-5 plan models: how much they reason before answering. Some reasoning is what made the week coach do
    # what an athlete asks ("only Monday, Wednesday and Friday, more chest") instead of half of it.
    openai_plan_reasoning_effort: str = Field(default="low", alias="OPENAI_PLAN_REASONING_EFFORT")
    # Recognising the stroke in a clip's frames (Stroke Lab); tested best on underwater and side-on clips.
    openai_vision_model: str = Field(default="gpt-5.5", alias="OPENAI_VISION_MODEL")
    stripe_secret_key: str = Field(default="", alias="STRIPE_SECRET_KEY")
    stripe_publishable_key: str = Field(default="", alias="STRIPE_PUBLISHABLE_KEY")
    frontend_url: str = Field(default="http://localhost:3000", alias="FRONTEND_URL")
    # Proxies in front of the API that append the caller's IP to X-Forwarded-For: 1 for a hosting platform's load
    # balancer, 2 with a CDN in front of that. The free video analysis is counted per network, so this must match the
    # deployment. The header is only read from connections on a private network (where those proxies are); otherwise,
    # and in local development, the connection's own address is used.
    trusted_proxy_hops: int = Field(default=1, alias="TRUSTED_PROXY_HOPS")
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


def reasons(model: str) -> bool:
    """Reasoning models (GPT-5, o-series) take a reasoning effort, not a temperature."""
    return model.startswith(("gpt-5", "o1", "o3", "o4"))


def sampling(model: str, effort: str, temperature: float) -> dict[str, Any]:
    """How a call to `model` is made: the reasoning effort for a reasoning model, the temperature for any other."""
    return {"reasoning_effort": effort} if reasons(model) else {"temperature": temperature}
