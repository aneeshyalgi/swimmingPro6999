"""Nutrition: a few questions about how the athlete eats, and a daily fuel plan built from the answers.

The plan is calculated, not generated, so it is instant and its numbers always add up:
1. Energy: resting energy (Mifflin-St Jeor) x 1.4 for daily life. A training day adds the athlete's weekly training
   (swims at 7 MET for their onboarding session length, gym at 5 MET for an hour) spread over their training days.
   The goal then adds a small surplus (build: +10% on training days, +8% on rest days) or a deficit that falls mostly
   on rest days (lean: -8% and -15%). No day goes below 1.2 x resting energy, and under-18s never get a deficit.
2. Protein by body weight (1.6-2.0 g/kg by goal), fat at 25% of energy (at least 0.8 g/kg) and carbohydrate for the
   rest (kept within 3-10 g/kg). Grams are rounded to 5 g and the calories recomputed from them.
3. Water: 35 ml/kg a day, plus 0.5 L for each hour of training on a training day (at most 6 L).
The answers live in one nutrition_profile record per athlete, with the water they logged on their last few days.
The plan is rebuilt on every read, so it follows changes to the athlete's training volume.
"""
from __future__ import annotations

from datetime import date as Date, datetime, timezone
from math import floor
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.auth import get_authenticated_profile
from app.db import get_supabase_client
from app.training import TrainingRoute, find_record, save_record

router = APIRouter(prefix="/api/nutrition", tags=["Nutrition"], route_class=TrainingRoute)

KIND = "nutrition_profile"
KEY = "nutrition"
WATER_DAYS = 7

SWIM_MET, GYM_MET, GYM_MINUTES = 7.0, 5.0, 60
DAILY_LIFE, ENERGY_FLOOR = 1.4, 1.2
MAX_WATER_L = 6.0
SEX_OFFSET = {"male": 5, "female": -161, "other": -78}
PROTEIN_PER_KG = {"perform": 1.6, "recover": 1.7, "build": 1.8, "lean": 2.0}
# Energy multipliers for a (training day, rest day).
ADJUSTMENT = {"perform": (1.0, 1.0), "recover": (1.0, 1.0), "build": (1.1, 1.08), "lean": (0.92, 0.85)}

GOALS = {
    "perform": ("Fuel every session", "More carbs on big training days and steady protein every day, so you have energy for every set."),
    "build": ("Build lean muscle", "A small surplus with protein at every meal, so your gym work turns into muscle."),
    "lean": ("Get leaner, stay fast", "A gentle deficit that falls mostly on rest days, so training days stay fully fuelled."),
    "recover": ("Recover faster", "Quick refuelling after every session and protein spread through the day."),
}
YOUTH_APPROACH = "You're still growing, so this plan never cuts calories. It's about eating enough, at the right times."
WATER_NOW = {"under_1": "under 1 L", "1_2": "1–2 L", "2_3": "2–3 L", "over_3": "over 3 L"}

# What each food contains, so a diet or a food the athlete avoids can rule it out.
FOODS: dict[str, frozenset[str]] = {name: frozenset(tags) for name, tags in {
    "Banana": (), "Toast with jam": ("gluten",), "Rice cakes with jam": (), "A few dates": (), "Oat bar": ("gluten",),
    "Chicken and rice bowl": ("meat",), "Pasta with tomato sauce": ("gluten",), "Salmon with potatoes": ("seafood",),
    "Tofu and rice bowl": ("soy",), "Lentil and rice bowl": (), "Bean burrito bowl": (), "Baked potato with beans": (),
    "Sports drink": (), "Diluted juice": (), "Water": (), "Electrolyte drink": (),
    "Chocolate milk": ("dairy",), "Greek yogurt with fruit": ("dairy",), "Chicken wrap": ("meat", "gluten"),
    "Tuna sandwich": ("seafood", "gluten"), "Eggs on toast": ("eggs", "gluten"), "Soy milk smoothie": ("soy",),
    "Pea protein shake": (),
    "Chicken": ("meat",), "Fish": ("seafood",), "Eggs": ("eggs",), "Greek yogurt": ("dairy",), "Tofu": ("soy",),
    "Lentils": (), "Beans": (), "Chickpeas": (),
    "Rice": (), "Pasta": ("gluten",), "Potatoes": (), "Oats": ("gluten",), "Fruit": (), "Quinoa": (),
    "Olive oil": (), "Oily fish": ("seafood",), "Nuts": ("nuts",), "Avocado": (), "Seeds": (),
}.items()}
DIET_EXCLUDES = {"any": set(), "pescatarian": {"meat"}, "vegetarian": {"meat", "seafood"}, "vegan": {"meat", "seafood", "dairy", "eggs"}}
# In order of preference; every list keeps at least three foods for any diet and any foods avoided.
PRE_SNACK = ["Banana", "Toast with jam", "Rice cakes with jam", "A few dates", "Oat bar"]
PRE_MEAL = ["Chicken and rice bowl", "Pasta with tomato sauce", "Salmon with potatoes", "Tofu and rice bowl",
            "Lentil and rice bowl", "Bean burrito bowl", "Baked potato with beans"]
DURING_LONG = ["Sports drink", "Diluted juice", "Water"]
DURING_SHORT = ["Water", "Electrolyte drink", "Sports drink"]
RECOVERY = ["Chocolate milk", "Greek yogurt with fruit", "Chicken wrap", "Tuna sandwich", "Eggs on toast", "Soy milk smoothie",
            "Tofu and rice bowl", "Pea protein shake", "Lentil and rice bowl", "Bean burrito bowl"]
PROTEIN_SOURCES = ["Chicken", "Fish", "Eggs", "Greek yogurt", "Tofu", "Lentils", "Beans", "Chickpeas"]
CARB_SOURCES = ["Rice", "Pasta", "Potatoes", "Oats", "Quinoa", "Fruit"]
FAT_SOURCES = ["Olive oil", "Oily fish", "Nuts", "Avocado", "Seeds"]


class NutritionAnswers(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal: Literal["perform", "build", "lean", "recover"]
    sex: Literal["male", "female", "other"]
    age: int = Field(ge=8, le=100)
    height_cm: float = Field(ge=100, le=250)
    weight_kg: float = Field(ge=25, le=250)
    swim_time: Literal["early", "midday", "afternoon", "evening", "varies"]
    meals_per_day: int = Field(ge=2, le=6)
    pre_training: Literal["always", "sometimes", "rarely"]
    water: Literal["under_1", "1_2", "2_3", "over_3"]
    diet: Literal["any", "vegetarian", "vegan", "pescatarian"]
    avoid: list[Literal["dairy", "gluten", "nuts", "eggs", "seafood", "soy"]] = Field(default_factory=list, max_length=6)
    challenge: Literal["eating_enough", "cravings", "time", "energy", "hydration", "none"]

    @field_validator("avoid")
    @classmethod
    def distinct(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))


class WaterLog(BaseModel):
    date: Date
    ml: int = Field(ge=0, le=10000)


def round5(value: float) -> int:
    return int(5 * floor(value / 5 + 0.5))


def litres(value: float) -> float:
    """Rounded to the nearest quarter litre (one 250 ml glass)."""
    return floor(value * 4 + 0.5) / 4


def allowed(answers: NutritionAnswers, foods: list[str], count: int = 3) -> list[str]:
    banned = DIET_EXCLUDES[answers.diet] | set(answers.avoid)
    return [food for food in foods if not FOODS[food] & banned][:count]


def spoken(foods: list[str]) -> str:
    """["Eggs", "Greek yogurt", "Tofu"] -> "eggs, Greek yogurt and tofu"."""
    words = [food if food.startswith("Greek") else food.lower() for food in foods]
    return f"{', '.join(words[:-1])} and {words[-1]}" if len(words) > 1 else "".join(words)


def swim_minutes(profile: dict[str, Any]) -> int:
    try:
        return int(profile.get("session_duration") or 90)
    except (TypeError, ValueError):
        return 90


def day_targets(energy: float, weight: float, protein_per_kg: float) -> dict[str, int]:
    protein = weight * protein_per_kg
    fat = max(0.8 * weight, 0.25 * energy / 9)
    carbs = min(10 * weight, max(3 * weight, (energy - 4 * protein - 9 * fat) / 4))
    protein, carbs, fat = round5(protein), round5(carbs), round5(fat)
    return {"calories": 4 * protein + 4 * carbs + 9 * fat, "protein_g": protein, "carbs_g": carbs, "fat_g": fat}


def plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def fuel_timeline(answers: NutritionAnswers, minutes: int) -> list[dict[str, Any]]:
    protein = round5(0.3 * answers.weight_kg)
    if answers.swim_time == "early":
        hungry = " Not hungry yet? Half a banana counts." if answers.pre_training == "rarely" else ""
        before = {"when": "30–60 min before", "title": "Light top-up", "ideas": allowed(answers, PRE_SNACK),
                  "text": f"A small carb snack is enough before an early swim.{hungry}"}
    else:
        before = {"when": "2–3 h before", "title": "Proper meal", "ideas": allowed(answers, PRE_MEAL),
                  "text": "Carbs and some protein, easy on fat and fibre so it settles."}
    long = minutes >= 90
    during = {"when": "Every 15–20 min", "title": "Keep sipping", "ideas": allowed(answers, DURING_LONG if long else DURING_SHORT),
              "text": "Sip a sports drink between sets. 30–60 g of carbs an hour keeps your last sets sharp."
              if long else "Sip water between sets. You sweat more in the pool than you notice."}
    after = {"when": "Within 45 min", "title": "Refuel and repair", "ideas": allowed(answers, RECOVERY),
             "text": f"Make dinner your recovery meal: about {protein} g of protein plus carbs."
             if answers.swim_time == "evening" else f"About {protein} g of protein plus carbs, so you recover for the next session."}
    return [{"key": "before", **before}, {"key": "during", **during}, {"key": "after", **after}]


def focus_habits(answers: NutritionAnswers, goal: str, water_l: float, per_meal: int) -> list[dict[str, str]]:
    """The three habits that matter most: the athlete's biggest challenge, their goal, then what their answers show.
    Each candidate is (topic, icon, title, body); only the first habit on a topic is kept."""
    carbs = spoken(allowed(answers, CARB_SOURCES))
    proteins = spoken(allowed(answers, PROTEIN_SOURCES))
    recover = ("recover", "recover", "Refuel within 45 min", "Protein and carbs straight after training start your recovery for the next session.")
    candidates: list[tuple[str, str, str, str] | None] = [
        {
            "eating_enough": ("snacks", "snack", "Add a snack between meals", "On training days a smoothie or a filling snack between meals makes your targets much easier to hit."),
            "cravings": ("snacks", "plan", "Plan two snacks a day", "Pick them in the morning, like fruit and something with protein, so after-training hunger doesn't choose for you."),
            "time": ("cooking", "batch", "Cook once, eat three times", "Twice a week, cook a big batch of a carb and a protein. On busy days you only put a bowl together."),
            "energy": ("before", "energy", "Never swim on empty", "Have some carbs 30–60 min before every session. Flat sets often start with an empty tank."),
            "hydration": ("water", "water", "A bottle at every session", f"Finish one during each swim and keep sipping through the day toward {water_l:g} L."),
        }.get(answers.challenge),
        {
            "build": ("protein", "protein", "Protein at every meal", f"About {per_meal} g each time, from {proteins}. Spread out, it builds more muscle than one big serving."),
            "lean": ("plate", "veg", "Half a plate of veg", "Fill half your plate with vegetables at lunch and dinner: you stay full while the carbs go to training."),
            "recover": recover,
            "perform": ("carbs", "carbs", "Match carbs to training", f"Bigger portions of {carbs} on training days, smaller ones on rest days."),
        }[goal],
        ("meals", "growth", "Never skip a meal", "You're still growing, so your body needs fuel for training and for growing every day.") if answers.age < 18 else None,
        ("before", "sunrise", "Eat before early swims", "Half a banana or a small glass of juice is enough to make your first sets stronger.")
        if answers.swim_time == "early" and answers.pre_training != "always" else None,
        ("meals", "meals", "Three meals minimum", "Two meals can't carry this much training. Start with a proper breakfast or lunch.") if answers.meals_per_day == 2 else None,
        ("water", "water", "Drink more through the day", f"You drink {WATER_NOW[answers.water]} now. Build up toward {water_l:g} L on training days, a bottle at a time.")
        if answers.water in ("under_1", "1_2") else None,
        {
            "vegan": ("diet", "plant", "Mix your plant proteins", "Combine beans, lentils and grains through the day, and ask your doctor about B12."),
            "vegetarian": ("diet", "iron", "Look after your iron", "Lentils, beans, spinach and fortified cereals, with some vitamin C, keep your iron up for hard training."),
        }.get(answers.diet),
        recover,
        ("colour", "colour", "Eat the rainbow", "Colourful fruit and veg every day bring the vitamins that keep you training."),
    ]
    habits: list[dict[str, str]] = []
    topics: set[str] = set()
    for habit in candidates:
        if habit and habit[0] not in topics:
            topics.add(habit[0])
            habits.append({"icon": habit[1], "title": habit[2], "body": habit[3]})
    return habits[:3]


def fuel_plan(answers: NutritionAnswers, profile: dict[str, Any]) -> dict[str, Any]:
    weight = answers.weight_kg
    swims = max(0, int(profile.get("swim_sessions_per_week") or 0))
    gyms = max(0, int(profile.get("gym_sessions_per_week") or 0))
    minutes = swim_minutes(profile)
    training_days = min(6, swims + gyms)
    hours = (swims * minutes + gyms * GYM_MINUTES) / 60 / training_days if training_days else 0
    weekly = (swims * (SWIM_MET - 1) * minutes + gyms * (GYM_MET - 1) * GYM_MINUTES) / 60 * weight
    resting = 10 * weight + 6.25 * answers.height_cm - 5 * answers.age + SEX_OFFSET[answers.sex]
    youth = answers.age < 18
    goal = "perform" if youth and answers.goal == "lean" else answers.goal
    train_factor, rest_factor = (max(factor, 1.0) if youth else factor for factor in ADJUSTMENT[goal])
    rest_energy = max(resting * DAILY_LIFE * rest_factor, resting * ENERGY_FLOOR)
    train_energy = max((resting * DAILY_LIFE + (weekly / training_days if training_days else 0)) * train_factor, resting * ENERGY_FLOOR)
    per_kg = PROTEIN_PER_KG[goal]
    training = {**day_targets(train_energy, weight, per_kg), "water_l": litres(min(MAX_WATER_L, 0.035 * weight + 0.5 * hours))}
    rest = {**day_targets(rest_energy, weight, per_kg), "water_l": litres(min(MAX_WATER_L, 0.035 * weight))}
    # Protein is used best in 4-5 servings a day, so a three-meal day gets a protein snack too.
    meals = min(5, max(4, answers.meals_per_day))
    per_meal = round5(training["protein_g"] / meals)
    title, approach = GOALS[goal]
    volume = plural(swims, "swim") + (f" and {plural(gyms, 'gym session')}" if gyms else "")
    return {
        "goal": {"key": goal, "title": title, "approach": YOUTH_APPROACH if youth else approach},
        "summary": f"About {training['calories']:,} kcal on training days and {rest['calories']:,} on rest days, for your {volume} a week.",
        "training": {"swims": swims, "gyms": gyms, "swim_minutes": minutes, "training_days": training_days, "hours_per_day": round(hours, 1)},
        "days": {"training": training, "rest": rest},
        "meals": meals,
        "protein_per_meal_g": per_meal,
        "sources": {
            "protein": allowed(answers, PROTEIN_SOURCES), "carbs": allowed(answers, CARB_SOURCES, 4), "fat": allowed(answers, FAT_SOURCES),
        },
        "timeline": fuel_timeline(answers, minutes),
        "habits": focus_habits(answers, goal, training["water_l"], per_meal),
        "youth": youth,
    }


def local_day(value: Date | None, strict: bool = False) -> Date:
    """The athlete's local date (every time zone's date is within a day of UTC's). A date further off comes from a
    wrong device clock: reading falls back to UTC's date, logging (strict) is refused."""
    today = datetime.now(timezone.utc).date()
    if value is not None and abs((value - today).days) <= 1:
        return value
    if value is not None and strict:
        raise HTTPException(status_code=422, detail="Only today can be logged. Check the date on your device.")
    return today


def _defaults(profile: dict[str, Any]) -> dict[str, Any]:
    """Onboarding answers that start the questions off."""
    def number(field: str) -> float | None:
        try:
            return float(profile[field]) if profile.get(field) not in (None, "") else None
        except (TypeError, ValueError):
            return None
    age = number("age")
    return {
        "sex": profile.get("gender") if profile.get("gender") in SEX_OFFSET else None,
        "age": int(age) if age else None, "height_cm": number("height"), "weight_kg": number("weight"),
    }


def _payload(profile: dict[str, Any], details: dict[str, Any] | None, day: Date) -> dict[str, Any]:
    try:
        answers = NutritionAnswers.model_validate(details["answers"]) if details else None
    except ValidationError:
        answers = None  # saved under older questions: asked again
    return {
        "answers": answers.model_dump(mode="json") if answers else None,
        "defaults": _defaults(profile),
        "plan": fuel_plan(answers, profile) if answers else None,
        "water": {"date": day.isoformat(), "ml": int(((details or {}).get("water") or {}).get(day.isoformat(), 0))},
    }


@router.get("")
def get_nutrition(day: Date | None = Query(default=None, alias="date"), authorization: str | None = Header(default=None)):
    profile = get_authenticated_profile(authorization)
    row = find_record(profile["id"], KEY)
    return _payload(profile, row["details"] if row else None, local_day(day))


@router.put("")
def save_nutrition(answers: NutritionAnswers, day: Date | None = Query(default=None, alias="date"),
                   authorization: str | None = Header(default=None)):
    profile = get_authenticated_profile(authorization)
    today = local_day(day)
    row = find_record(profile["id"], KEY)
    details = {
        "answers": answers.model_dump(mode="json"), "water": (row["details"].get("water") if row else None) or {},
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    save_record(profile["id"], KEY, KIND, "Nutrition", None, details)
    return _payload(profile, details, today)


@router.post("/water")
def log_water(entry: WaterLog, authorization: str | None = Header(default=None)):
    profile = get_authenticated_profile(authorization)
    day = local_day(entry.date, strict=True)
    row = find_record(profile["id"], KEY)
    if row is None:
        raise HTTPException(status_code=409, detail="Answer the nutrition questions before logging water.")
    water = dict(sorted({**(row["details"].get("water") or {}), day.isoformat(): entry.ml}.items())[-WATER_DAYS:])
    get_supabase_client().table("user_training_sessions").update({"details": {**row["details"], "water": water}}).eq(
        "user_id", profile["id"]).eq("id", row["id"]).execute()
    return {"date": day.isoformat(), "ml": entry.ml}
