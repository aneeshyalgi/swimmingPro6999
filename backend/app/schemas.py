from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.context import coach_key
from app.swim_times import swim_time_parts


class SwimTime(BaseModel):
    minutes: int = Field(default=0, ge=0, le=180)
    seconds: int = Field(ge=0, le=59)
    hundredths: int = Field(default=0, ge=0, le=99)

    @model_validator(mode="before")
    @classmethod
    def parse_legacy_text(cls, value: Any):
        return swim_time_parts(value) if isinstance(value, str) else value

    @model_validator(mode="after")
    def require_positive(self):
        if self.minutes == self.seconds == self.hundredths == 0:
            raise ValueError("Swim times must be greater than zero.")
        return self


ONBOARDING_EVENTS = [
    *[f"{distance}m Freestyle" for distance in (50, 100, 200, 400, 800, 1500)],
    *[f"{distance}m {stroke}" for stroke in ("Backstroke", "Breaststroke", "Butterfly") for distance in (50, 100, 200)],
    "200m IM", "400m IM",
]
FACILITIES = ["25m Pool", "50m Pool", "Full Gym Access", "Basic Gym", "Home Equipment", "No Gym Access"]
GYM_FACILITIES = {"Full Gym Access", "Basic Gym"}
# Realistic race speed in seconds per 100 m (world records are about 41-47 s; slower than 4:00/100 m is not a race time).
FASTEST_PER_100, SLOWEST_PER_100 = 40.0, 240.0
# In yards the fastest is about 35 s per 100 yd (the 50y freestyle record is 17.63).
FASTEST_PER_100_YARDS = 34.0
# A 25-yard pool swims the same events in yards, except the long freestyles: the 400m, 800m and 1500m are swum as the
# 500y, 1000y and 1650y there.
YARD_FREESTYLES = {"400m Freestyle": "500y Freestyle", "800m Freestyle": "1000y Freestyle", "1500m Freestyle": "1650y Freestyle"}


def yard_event(event: str) -> str:
    """The short course yards event an onboarding event is in a 25-yard pool ("100m Backstroke" is "100y Backstroke")."""
    return YARD_FREESTYLES.get(event) or event.replace("m ", "y ", 1)


def seconds_of(time: "SwimTime") -> float:
    return time.minutes * 60 + time.seconds + time.hundredths / 100


class OnboardingSubmission(BaseModel):
    """What the onboarding form collects. The account (auth user and name) comes from the session, never the body."""

    age: int = Field(ge=13, le=100)
    gender: Literal["male", "female", "other"]
    country: str = Field(min_length=1, max_length=80)
    height: float | None = Field(default=None, ge=100, le=250)
    weight: float = Field(ge=25, le=250)
    swim_experience: int = Field(ge=0, le=80)
    main_events: list[str] = Field(min_length=1, max_length=len(ONBOARDING_EVENTS))
    pbs_lcm: dict[str, SwimTime] = Field(default_factory=dict)
    pbs_scm: dict[str, SwimTime] = Field(default_factory=dict)
    # Short course yards (a 25-yard pool), keyed by the yard event (yard_event). Optional, and asked only of athletes
    # who join from now on: the profile column is null for everyone who joined before.
    pbs_scy: dict[str, SwimTime] = Field(default_factory=dict)
    swimmer_type: Literal["sprinter", "mid", "distance", "specialist"]
    swim_sessions_per_week: int = Field(ge=1, le=14)
    gym_sessions_per_week: int = Field(ge=0, le=7)
    session_duration: Literal["60", "90", "120", "150"]
    facilities: list[str] = Field(min_length=1, max_length=len(FACILITIES))
    coaching_situation: Literal["team", "club", "solo"]
    one_year_goal: str = Field(default="", max_length=600)
    one_year_goal_times: dict[str, SwimTime] = Field(default_factory=dict)
    # The one coach the athlete picked; none uses the recommended coach. Not a profile column: the final coach is
    # stored as recommended_coaches (a one-item list).
    coach: str | None = Field(default=None, max_length=80)
    # A new athlete under 16: the parent or guardian who agrees to them using SwimGPT (kept in consents.py, not the
    # profile).
    guardian_name: str = Field(default="", max_length=120)
    guardian_email: str = Field(default="", max_length=254)
    guardian_consent: bool = False

    # Older clients also send auth_user_id, user_key, full_name, coaches and recommended_coaches; they are ignored.
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    @field_validator("pbs_lcm", "pbs_scm", "pbs_scy", "one_year_goal_times", mode="before")
    @classmethod
    def drop_blank_times(cls, value: Any):
        if isinstance(value, dict):
            return {event: time for event, time in value.items() if time not in (None, "") and not (isinstance(time, str) and not time.strip())}
        return value

    @field_validator("age", "height", "weight", "swim_experience", "swim_sessions_per_week", "gym_sessions_per_week", mode="before")
    @classmethod
    def parse_numeric_fields(cls, value: Any):
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return None
            try:
                return float(stripped) if "." in stripped else int(stripped)
            except ValueError:
                return value
        return value

    @field_validator("session_duration", mode="before")
    @classmethod
    def duration_text(cls, value: Any):
        return str(value) if isinstance(value, int) else value

    @model_validator(mode="after")
    def consistent(self):
        if self.coach and coach_key(self.coach) is None:
            raise ValueError("Choose a coach from the list.")
        unknown = [event for event in self.main_events if event not in ONBOARDING_EVENTS]
        if unknown or len(set(self.main_events)) != len(self.main_events):
            raise ValueError(f"Choose distinct events from the list (unknown: {', '.join(unknown) or 'duplicates'}).")
        if any(item not in FACILITIES for item in self.facilities) or len(set(self.facilities)) != len(self.facilities):
            raise ValueError("Choose facilities from the list.")
        if not any(item.endswith("Pool") for item in self.facilities):
            raise ValueError("Select the pool you train in (25m or 50m).")
        if "No Gym Access" in self.facilities and GYM_FACILITIES & set(self.facilities):
            raise ValueError("'No Gym Access' can't be combined with a gym option.")
        for label, times, required in [("long course PB", self.pbs_lcm, True), ("short course PB", self.pbs_scm, False), ("1-year target", self.one_year_goal_times, True)]:
            extra = [event for event in times if event not in self.main_events]
            if extra:
                raise ValueError(f"{label} given for an event that isn't selected: {', '.join(extra)}.")
            missing = [event for event in self.main_events if event not in times]
            if required and missing:
                raise ValueError(f"Add a {label} for: {', '.join(missing)}.")
            for event, time in times.items():
                per_100 = seconds_of(time) / int(event.split("m")[0]) * 100
                if not FASTEST_PER_100 <= per_100 <= SLOWEST_PER_100:
                    raise ValueError(f"The {label} for {event} ({time.minutes}:{time.seconds:02d}.{time.hundredths:02d}) isn't a realistic swim time.")
        selected_in_yards = {yard_event(event) for event in self.main_events}
        extra = [event for event in self.pbs_scy if event not in selected_in_yards]
        if extra:
            raise ValueError(f"short course yards PB given for an event that isn't selected: {', '.join(extra)}.")
        for event, time in self.pbs_scy.items():
            per_100 = seconds_of(time) / int(event.split("y")[0]) * 100
            if not FASTEST_PER_100_YARDS <= per_100 <= SLOWEST_PER_100:
                raise ValueError(f"The short course yards PB for {event} ({time.minutes}:{time.seconds:02d}.{time.hundredths:02d}) isn't a realistic swim time.")
        return self

    def to_storage_record(self) -> dict[str, Any]:
        record = self.model_dump(exclude={"coach", "guardian_name", "guardian_email", "guardian_consent"})
        for field in ("height", "weight"):  # whole numbers stay integers, as in existing rows
            if isinstance(record[field], float) and record[field].is_integer():
                record[field] = int(record[field])
        for field in ("pbs_lcm", "pbs_scm", "pbs_scy", "one_year_goal_times"):
            record[field] = {event: time.model_dump() for event, time in getattr(self, field).items()}
        return record


class CoachOptionsRequest(BaseModel):
    """The onboarding answers that decide how well each coach fits (see context._coach_fit)."""

    main_events: list[str] = Field(default_factory=list, max_length=len(ONBOARDING_EVENTS))
    swimmer_type: str = Field(default="", max_length=20)
    facilities: list[str] = Field(default_factory=list, max_length=len(FACILITIES))
    gym_sessions_per_week: int = Field(default=0, ge=0, le=7)
    swim_sessions_per_week: int = Field(default=0, ge=0, le=14)

    model_config = ConfigDict(extra="ignore")


class CoachSwitchRequest(BaseModel):
    """The coach an athlete switches to from the dashboard: a coach's name ("Coach Brad") or catalog key ("brad")."""

    coach: str = Field(min_length=1, max_length=40)
    # Paying for the switch: the athlete ticked the box to have it happen straight away (app/withdrawal.py).
    start_now: bool = False


class OnboardingSubmissionResponse(BaseModel):
    message: str
    user_key: str
    profile_id: str | None = None
    coach: str
    coach_match: dict[str, Any] = Field(default_factory=dict)
    coach_profile: dict[str, Any] = Field(default_factory=dict)


class CheckoutSessionRequest(BaseModel):
    auth_user_id: str
    user_key: str
    plan_id: str
    # The athlete ticked the box to have their plan start straight away (app/withdrawal.py).
    start_now: bool = False
    # An account made before tokens ticked the box agreeing to the Terms that brought them in (app/consents.py).
    accept_terms: bool = False


class CheckoutSessionResponse(BaseModel):
    checkout_url: str
    session_id: str


class PaymentVerificationResponse(BaseModel):
    paid: bool
    plan_id: str | None = None
    user_key: str | None = None


class CoachChatMessage(BaseModel):
    role: str
    content: str


# How much of the conversation the coach is given with each message, typed or said on a voice call: its last 50
# messages (the chat sends them; app.coach_history.conversation_history shortens the older ones).
HISTORY_MESSAGES = 50


class CoachChatRequest(BaseModel):
    user_key: str
    selected_coaches: list[str] = Field(min_length=1, max_length=1)
    active_coach: str | None = None
    message: str = Field(min_length=1, max_length=4000)
    history: list[CoachChatMessage] = Field(default_factory=list, max_length=HISTORY_MESSAGES)
    # "conversation": a live voice call; the reply is spoken aloud, so it must be short and plain speech.
    mode: Literal["chat", "conversation"] = "chat"


class CoachChatResponse(BaseModel):
    content: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    # The kinds of session the reply prescribes, when it prescribes any: the chat offers to add them to the athlete's weeks.
    plan: Literal["swim", "gym", "both"] | None = None
