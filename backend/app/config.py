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
    # The coach's chat replies and the daily plan.
    openai_model: str = Field(default="gpt-6.1-sol", alias="OPENAI_MODEL")
    # A voice call's replies, spoken the moment they're ready, so from a model that can answer without reasoning first
    # (see main.coach_chat): GPT-6.1 Sol always reasons, which left ~4 s of silence before each reply; GPT-6 Sol starts
    # in about 1 s, at the same price.
    openai_voice_model: str = Field(default="gpt-6-sol", alias="OPENAI_VOICE_MODEL")
    # Only for reasoning models (GPT-5, GPT-6): how much they reason before answering.
    openai_reasoning_effort: str = Field(default="low", alias="OPENAI_REASONING_EFFORT")
    openai_transcription_model: str = Field(default="gpt-4o-mini-transcribe", alias="OPENAI_TRANSCRIPTION_MODEL")
    openai_speech_model: str = Field(default="gpt-4o-mini-tts", alias="OPENAI_SPEECH_MODEL")
    # Training-plan generation needs precise arithmetic and instruction following; a stronger model by default.
    openai_plan_model: str = Field(default="gpt-6.1-sol", alias="OPENAI_PLAN_MODEL")
    # Only for reasoning plan models (GPT-5, GPT-6): how much they reason before answering. Some reasoning is what made
    # the week coach do what an athlete asks ("only Monday, Wednesday and Friday, more chest") instead of half of it.
    openai_plan_reasoning_effort: str = Field(default="low", alias="OPENAI_PLAN_REASONING_EFFORT")
    # Recognising the stroke in a clip's frames (Stroke Lab); tested best on underwater and side-on clips.
    openai_vision_model: str = Field(default="gpt-6.1-sol", alias="OPENAI_VISION_MODEL")
    # Tokens for the AI features (app/tokens.py), once their migration has run. Off: every AI feature is free, as before.
    tokens_enabled: bool = Field(default=True, alias="TOKENS_ENABLED")
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


# Reasoning models that always reason: GPT-6.1 Sol and GPT-6 Astra take low, medium, high or xhigh, never none (GPT-6
# Sol and Luna can answer without reasoning). The o-series never could.
ALWAYS_REASON = ("gpt-6.1-sol", "gpt-6-astra", "o1", "o3", "o4")


def reasons(model: str) -> bool:
    """Reasoning models (GPT-5, GPT-6, o-series) take a reasoning effort, not a temperature."""
    return model.startswith(("gpt-5", "gpt-6", "o1", "o3", "o4"))


def sampling(model: str, effort: str, temperature: float) -> dict[str, Any]:
    """How a call to `model` is made: the reasoning effort for a reasoning model, the temperature for any other. Asked
    not to reason (none, or minimal), a model that always reasons reasons as little as it can (low)."""
    if not reasons(model):
        return {"temperature": temperature}
    if effort in ("none", "minimal") and model.startswith(ALWAYS_REASON):
        effort = "low"
    return {"reasoning_effort": effort}
