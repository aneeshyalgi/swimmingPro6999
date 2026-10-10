"""Mental Performance: a few questions about the athlete's mental game and wellbeing, a plan built from the answers,
and a one-tap daily check-in of how they feel.

Everything shown is chosen from fixed, reviewed text (no AI), because it touches on wellbeing:
- their five self-ratings (confidence, focus, calm under pressure, motivation, bouncing back), with their strongest and
  weakest as "strength" and "working on";
- a race-day routine fitted to how they feel before races and how they handle a bad swim;
- three mental skills picked by their goal, their weakest rating and what they told us about sleep, stress and mood;
- a support card pointing to people and free helplines when they say they've often felt low or worried, are under high
  stress while sleeping poorly, or their check-ins have been low on several days of the last week.
The answers and check-ins live in one mental_profile record per athlete; the plan is rebuilt on every read.
"""
from __future__ import annotations

from datetime import date as Date, datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.auth import get_authenticated_profile
from app.db import get_supabase_client
from app.nutrition import local_day
from app.training import TrainingRoute, find_record, save_record

router = APIRouter(prefix="/api/mental", tags=["Mental performance"], route_class=TrainingRoute)

KIND = "mental_profile"
KEY = "mental"
CHECKIN_DAYS = 14
LOW_MOOD, LOW_DAYS = 2, 3  # this many check-ins at or below LOW_MOOD in the last week shows the support card

SKILLS = {"confidence": "Confidence", "focus": "Focus", "calm": "Calm under pressure", "motivation": "Motivation", "resilience": "Bouncing back"}
GOALS = {
    "nerves": ("Race calm, race fast", "calm", "Nerves mean you care. A set routine, slow breathing and one clear thought behind the blocks turn them into speed."),
    "confidence": ("Race with confidence", "confidence", "Confidence comes from evidence. You'll collect it in training, so you walk to the blocks knowing you're ready."),
    "focus": ("Stay locked in", "focus", "Put your attention on what you control: your race plan, your stroke and the next length."),
    "resilience": ("Bounce back fast", "resilience", "Every swimmer has bad days. A quick reset keeps one bad swim from turning into a bad week."),
    "motivation": ("Find your drive", "motivation", "Motivation follows progress. Small goals you control make every session count."),
    "balance": ("Balance and recharge", "calm", "Swimming is one part of your life. Sleep and downtime keep you fresh, in the pool and out of it."),
}
# key: (icon, title, why it helps, how to do it)
TOOLS: dict[str, tuple[str, str, str, list[str]]] = {
    "cue_words": ("message", "Cue words", "One or two words that pull your mind back to your race.",
                  ["Pick words for your race, like “long and strong”", "Say them in warm-up and behind the blocks", "Use them when your mind drifts mid-race"]),
    "visualisation": ("eye", "Race visualisation", "Swimming it in your head first prepares you for the real thing.",
                      ["Close your eyes for 60 seconds", "See your start, turns and finish in real time", "Touch the wall at your target time"]),
    "reset": ("rotate", "The 3R reset", "Turns a bad swim into a lesson, then lets it go.",
              ["Recognise: one sentence on what went wrong", "Release: one long breath out", "Refocus: one thing to do next time"]),
    "evidence": ("notebook", "Confidence log", "Proof you're ready, collected one session at a time.",
                 ["After each session, note one thing you did well", "Read the list the night before a race", "Remind yourself the work is done"]),
    "process": ("target", "Process goals", "Goals you control make every session feel worth it.",
                ["Pick one technical goal per session", "Tick it off when you hit it", "Look back at your wins each week"]),
    "control": ("shield", "Control the controllables", "Your energy goes to what you can change.",
                ["Effort, technique and attitude are yours", "Rivals, lanes and the clock aren't", "When you worry, steer back to the first list"]),
    "wind_down": ("moon", "Wind-down routine", "Better sleep means better training and a calmer head.",
                  ["Screens off 30 minutes before bed", "Same bedtime most nights", "Write tomorrow's to-dos down so your mind can rest"]),
    "energise": ("zap", "Power-up routine", "Lifts your energy when you feel flat before racing.",
                 ["Upbeat music during warm-up", "Arm swings and jumps behind the blocks", "Short, sharp cue words like “attack”"]),
    "talk": ("users", "Talk it out", "Sharing the load makes it lighter.",
             ["Tell someone you trust how things are going", "Your coach can adjust training on heavy weeks", "Asking for help is a strength"]),
}
GOAL_TOOLS = {
    "nerves": ["control", "visualisation", "cue_words"], "confidence": ["evidence", "visualisation", "cue_words"],
    "focus": ["cue_words", "control", "visualisation"], "resilience": ["reset", "control", "evidence"],
    "motivation": ["process", "evidence", "visualisation"], "balance": ["wind_down", "talk", "control"],
}
SKILL_TOOL = {"confidence": "evidence", "focus": "cue_words", "calm": "control", "motivation": "process", "resilience": "reset"}
# The athlete's own habits that a skill builds on.
USES = {"visualisation": "visualisation", "cue_words": "self_talk", "evidence": "journaling", "talk": "talking", "energise": "music"}
WELLBEING = {
    "sleep": {"well": ("Sleeping well", "good"), "ok": ("Sleep is okay", "fair"), "poorly": ("Sleeping poorly", "low")},
    "stress": {"low": ("Low stress", "good"), "medium": ("Some stress", "fair"), "high": ("High stress", "low")},
    "mood": {"good": ("Feeling good", "good"), "mixed": ("Up and down", "fair"), "low": ("Often low or worried", "low")},
}


class MentalAnswers(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal: Literal["nerves", "confidence", "focus", "resilience", "motivation", "balance"]
    confidence: int = Field(ge=1, le=5)
    focus: int = Field(ge=1, le=5)
    calm: int = Field(ge=1, le=5)
    motivation: int = Field(ge=1, le=5)
    resilience: int = Field(ge=1, le=5)
    pre_race: Literal["calm", "excited", "anxious", "flat"]
    routine: Literal["set", "loose", "none"]
    setback: Literal["move_on", "replay", "doubt", "frustrated"]
    sleep: Literal["well", "ok", "poorly"]
    stress: Literal["low", "medium", "high"]
    mood: Literal["good", "mixed", "low"]
    tools: list[Literal["breathing", "visualisation", "music", "self_talk", "journaling", "talking"]] = Field(default_factory=list, max_length=6)

    @field_validator("tools")
    @classmethod
    def distinct(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))


class CheckIn(BaseModel):
    date: Date
    mood: int = Field(ge=1, le=5)


def race_routine(answers: MentalAnswers) -> dict[str, Any]:
    feel = answers.pre_race
    blocks = {
        "anxious": ("Breathe, then go", "Two rounds of box breathing, then your cue words. Nerves are energy: point them at the wall."),
        "flat": ("Switch on", "Shake out, take three sharp breaths and use a short cue like “attack”."),
        "excited": ("Use the buzz", "One slow breath out, then your cue words. The butterflies are fuel."),
        "calm": ("Stay in your bubble", "One slow breath and your cue words. Nothing else to do."),
    }[feel]
    warm_up = ("Wake up", "Upbeat music and a sharper warm-up with a few fast 25s.") if feel == "flat" else (
        "Same as always", "Your usual warm-up. Familiar steps tell your brain you're ready." if feel == "anxious"
        else "Your usual warm-up, finished with a couple of race-pace efforts.")
    after = ("3R reset", "One sentence on what happened, one long breath out, one thing for next time. Then let it go.") \
        if answers.setback != "move_on" else ("Learn and let go", "Swim down, name one thing that went well and one to improve, then move on.")
    return {
        "note": {
            "set": "You have a routine: keep it, and add any step you don't do yet.",
            "loose": "Do these steps the same way every race, so they become automatic.",
            "none": "Start with this. The same steps every race make them automatic.",
        }[answers.routine],
        "steps": [
            {"key": "night", "when": "Night before", "title": "Settle in", "text": "Pack your bag early, swim the race once in your head, then lights out on time."},
            {"key": "warmup", "when": "Warm-up", "title": warm_up[0], "text": warm_up[1]},
            {"key": "blocks", "when": "Behind the blocks", "title": blocks[0], "text": blocks[1]},
            {"key": "after", "when": "After the race", "title": after[0], "text": after[1]},
        ],
    }


def toolkit(answers: MentalAnswers, working_on: str) -> list[dict[str, Any]]:
    """Three skills: the goal's main one, then what the answers call for, then the rest of the goal's skills."""
    order = [GOAL_TOOLS[answers.goal][0]]
    if answers.mood == "low" or answers.stress == "high":
        order.append("talk")
    if answers.sleep == "poorly":
        order.append("wind_down")
    if answers.pre_race == "flat":
        order.append("energise")
    if answers.setback != "move_on":
        order.append("reset")
    order += [SKILL_TOOL[working_on], *GOAL_TOOLS[answers.goal][1:], "cue_words", "visualisation", "control"]
    picked = list(dict.fromkeys(order))[:3]
    return [{"key": key, "icon": TOOLS[key][0], "title": TOOLS[key][1], "why": TOOLS[key][2], "steps": TOOLS[key][3],
             "uses": USES.get(key) in answers.tools} for key in picked]


def answers_need_support(answers: MentalAnswers) -> bool:
    return answers.mood == "low" or (answers.stress == "high" and answers.sleep == "poorly")


def mind_plan(answers: MentalAnswers) -> dict[str, Any]:
    title, goal_skill, approach = GOALS[answers.goal]
    skills = [{"key": key, "label": label, "value": getattr(answers, key)} for key, label in SKILLS.items()]
    values = [skill["value"] for skill in skills]
    # All rated the same: no single strength, and the goal's skill is the one to work on.
    strength = None if max(values) == min(values) else max(skills, key=lambda skill: skill["value"])["key"]
    working_on = min(skills, key=lambda skill: (skill["value"], skill["key"] != goal_skill))["key"]
    reset_text = {
        "nerves": "Calms race nerves in about a minute. Use it behind the blocks.",
        "balance": "A minute to switch off after a busy day, or before bed.",
    }.get(answers.goal, "A minute of slow breathing to settle and refocus. Use it before races and hard sets.")
    return {
        "goal": {"key": answers.goal, "title": title, "approach": approach},
        "skills": skills,
        "strength": strength,
        "working_on": working_on,
        "reset": {"text": reset_text, "uses": "breathing" in answers.tools},
        "routine": race_routine(answers),
        "toolkit": toolkit(answers, working_on),
        "wellbeing": [{"key": key, "label": WELLBEING[key][getattr(answers, key)][0], "tone": WELLBEING[key][getattr(answers, key)][1]}
                      for key in ("sleep", "stress", "mood")],
    }


def week_of(checkins: dict[str, int], day: Date) -> list[dict[str, Any]]:
    days = [day - timedelta(days=offset) for offset in range(6, -1, -1)]
    return [{"date": item.isoformat(), "mood": checkins.get(item.isoformat())} for item in days]


def _payload(details: dict[str, Any] | None, day: Date) -> dict[str, Any]:
    try:
        answers = MentalAnswers.model_validate(details["answers"]) if details else None
    except ValidationError:
        answers = None  # saved under older questions: asked again
    week = week_of((details or {}).get("checkins") or {}, day)
    low_days = sum(1 for item in week if item["mood"] is not None and item["mood"] <= LOW_MOOD)
    return {
        "answers": answers.model_dump(mode="json") if answers else None,
        "plan": mind_plan(answers) if answers else None,
        "week": week,
        "support": bool(answers and answers_need_support(answers)) or low_days >= LOW_DAYS,
    }


@router.get("")
def get_mental(day: Date | None = Query(default=None, alias="date"), authorization: str | None = Header(default=None)):
    profile = get_authenticated_profile(authorization)
    row = find_record(profile["id"], KEY)
    return _payload(row["details"] if row else None, local_day(day))


@router.put("")
def save_mental(answers: MentalAnswers, day: Date | None = Query(default=None, alias="date"),
                authorization: str | None = Header(default=None)):
    profile = get_authenticated_profile(authorization)
    row = find_record(profile["id"], KEY)
    details = {
        "answers": answers.model_dump(mode="json"), "checkins": (row["details"].get("checkins") if row else None) or {},
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    save_record(profile["id"], KEY, KIND, "Mental performance", None, details)
    return _payload(details, local_day(day))


@router.post("/checkin")
def check_in(entry: CheckIn, authorization: str | None = Header(default=None)):
    profile = get_authenticated_profile(authorization)
    day = local_day(entry.date, strict=True)
    row = find_record(profile["id"], KEY)
    if row is None:
        raise HTTPException(status_code=409, detail="Answer the mental performance questions before checking in.")
    checkins = dict(sorted({**(row["details"].get("checkins") or {}), day.isoformat(): entry.mood}.items())[-CHECKIN_DAYS:])
    details = {**row["details"], "checkins": checkins}
    get_supabase_client().table("user_training_sessions").update({"details": details}).eq("user_id", profile["id"]).eq("id", row["id"]).execute()
    payload = _payload(details, day)
    return {"week": payload["week"], "support": payload["support"]}
