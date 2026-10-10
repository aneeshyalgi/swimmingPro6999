from __future__ import annotations

"""Coach selection, recommendations and the coaching context every AI call is grounded in.

All coaching knowledge comes from the encoded programs (coach_programs.py / coach_sessions.py). Nothing is
downloaded, embedded or searched: the context is rendered from code, so it is identical on every call and testable.
"""
import re
from typing import Any

from app.coach_catalog import COACHES, public_profile
from app.coach_programs import PROGRAMS, CoachProgram, program_for, render_overview, render_session, session_label

SWIMMER_TYPE_LABELS = {"sprinter": "sprinter", "mid": "mid-distance", "distance": "distance", "specialist": "IM specialist"}
GYM_FACILITIES = {"Full Gym Access", "Basic Gym"}


def _coach_name(name: str) -> str:
    return COACHES[name]["name"]


def _has_gym(profile: dict[str, Any]) -> bool:
    facilities = profile.get("facilities") or []
    if int(profile.get("gym_sessions_per_week") or 0) <= 0 or "No Gym Access" in facilities:
        return False
    # Profiles saved before facilities were collected only tell us the planned gym sessions.
    return not facilities or bool(GYM_FACILITIES & set(facilities))


def _coach_fit(key: str, profile: dict[str, Any]) -> dict[str, Any]:
    coach = COACHES[key]
    events = profile.get("main_events") or []
    swimmer_type = str(profile.get("swimmer_type") or "").lower()
    matched = [event for event in events if event in coach["main_events"]]
    supporting = [event for event in events if event in coach["supporting_events"] and event not in matched]
    affinity = 2 if swimmer_type in coach["swimmer_types"] else 1 if swimmer_type in coach["adjacent_swimmer_types"] else 0
    return {
        "matched": matched,
        "supporting": supporting,
        "affinity": affinity,
        "feasible": not coach["requires_gym"] or _has_gym(profile),
        "specificity": len(matched) / len(coach["main_events"]),
    }


def _coach_rank(key: str, fit: dict[str, Any], order: list[str]) -> tuple:
    return (len(fit["matched"]), fit["affinity"], fit["feasible"], len(fit["supporting"]), fit["specificity"], -order.index(key))


def _ranked(profile: dict[str, Any]) -> tuple[list[str], dict[str, dict[str, Any]]]:
    """Every coach key, best fit for the athlete first, with each coach's fit.

    Coaches are ranked by, in order:
      1. how many of the athlete's events are the coach's main events;
      2. swimmer-type fit (specialist = 2, adjacent = 1);
      3. whether the athlete can follow the program (Timothy's program needs a gym);
      4. extra event support beyond main events (Pete's 200 Pace sessions);
      5. how specialised the coach is for the athlete's events;
      6. catalog order, so the result is always deterministic.
    """
    order = list(COACHES)
    fit = {key: _coach_fit(key, profile) for key in order}
    return sorted(order, key=lambda key: _coach_rank(key, fit[key], order), reverse=True), fit


def coach_key(name: str) -> str | None:
    """Catalog key for a coach name or key ("Coach Brad", "coach brad", "brad"), or None if unknown."""
    normalized = re.sub(r"\s+", " ", str(name)).strip().lower()
    if normalized in COACHES:
        return normalized
    return next((key for key, coach in COACHES.items() if coach["name"].lower() == normalized), None)


def recommended_coach(profile: dict[str, Any]) -> str:
    """The coach whose program fits the athlete best (see _ranked)."""
    return _coach_name(_ranked(profile)[0][0])


def select_coach(profile: dict[str, Any], chosen: str | None = None) -> str:
    """The athlete's one coach: the one they chose (`chosen`, or the profile's `chosen_coach`), else the recommended coach."""
    key = coach_key(chosen or profile.get("chosen_coach") or "")
    return _coach_name(key) if key else recommended_coach(profile)


def athlete_coach(profile: dict[str, Any]) -> str:
    """The coach saved on the athlete's profile (re-selected for profiles saved before coaches were stored)."""
    saved = profile.get("recommended_coaches") or []
    return saved[0] if saved else select_coach(profile)


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + f" and {items[-1]}"


def _reasons(key: str, fit: dict[str, Any], profile: dict[str, Any]) -> list[str]:
    coach = COACHES[key]
    swimmer_type = SWIMMER_TYPE_LABELS.get(str(profile.get("swimmer_type") or "").lower())
    reasons = []
    if fit["matched"]:
        verb = "is one of" if len(fit["matched"]) == 1 else "are"
        reasons.append(f"Your {_join(fit['matched'])} {verb} {coach['name']}'s main events.")
    if fit["supporting"]:
        sources = sorted({coach["supporting_events"][event] for event in fit["supporting"]})
        reasons.append(f"Adds {_join(sources)} for your {_join(fit['supporting'])}.")
    if swimmer_type and fit["affinity"] == 2:
        reasons.append(f"Specialises in {swimmer_type} swimmers.")
    elif swimmer_type and fit["affinity"] == 1:
        reasons.append(f"Their program overlaps with {swimmer_type} training.")
    if coach["requires_gym"]:
        reasons.append(
            "Includes a gym program, and you have gym access."
            if fit["feasible"]
            else "Includes gym sessions, but you haven't listed gym access, so those days will need adapting."
        )
    if not fit["matched"] and not fit["supporting"]:
        reasons.append(f"Built for {_join(coach['main_events'][:3])} rather than your events.")
    return reasons


def _your_week(key: str, profile: dict[str, Any]) -> dict[str, Any] | None:
    structure = COACHES[key]["weekly_structure"]
    requested = int(profile.get("swim_sessions_per_week") or 0)
    if not structure or requested <= 0:
        return None
    sessions = min(max(requested, min(structure)), max(structure))
    return {"requested": requested, "sessions_per_week": sessions, "order": structure[sessions]}


def _recommendation(key: str, fit: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    return {
        **public_profile(key),
        "covered_events": fit["matched"],
        "supported_events": fit["supporting"],
        "reasons": _reasons(key, fit, profile),
        "your_week": _your_week(key, profile),
    }


def coach_recommendation(profile: dict[str, Any], coach_name: str) -> dict[str, Any]:
    """Full profile of the athlete's coach plus why they fit the athlete."""
    key = coach_key(coach_name)
    if key is None:
        raise ValueError(f"Unknown coach: {coach_name}")
    return _recommendation(key, _coach_fit(key, profile), profile)


def coach_options(profile: dict[str, Any]) -> dict[str, Any]:
    """Every coach the athlete can choose during onboarding, best fit first, each with how they fit.

    `recommended` is true for the top match only (also returned by name as the response's `recommended`).
    """
    ranked, fit = _ranked(profile)
    coaches = [{**_recommendation(key, fit[key], profile), "recommended": index == 0} for index, key in enumerate(ranked)]
    return {"coaches": coaches, "recommended": _coach_name(ranked[0])}


def resolve_coaches(names: list[str]) -> list[CoachProgram]:
    """The programs for the given coach names (or keys), in the given order, ignoring unknown names."""
    programs = []
    for name in names:
        program = program_for(name)
        if program and program not in programs:
            programs.append(program)
    return programs


_WORD = re.compile(r"[a-z0-9]+(?:/[a-z0-9]+)?")
_STOP = {"the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "my", "is", "it", "how", "what", "should", "i", "me", "do",
         "with", "can", "you", "your", "this", "that", "be", "at", "are", "session", "sessions", "swim", "workout", "please"}


def _relevance(program: CoachProgram, session, taper: bool, query_words: set[str]) -> float:
    """Keyword overlap between a request and one session (type words count most)."""
    type_words = set(_WORD.findall(session.type.lower()))
    text_words = set(_WORD.findall(" ".join(line.lower() for section in session.sections for line in section.lines)))
    score = 3.0 * len(query_words & type_words) + 0.4 * len(query_words & text_words)
    if taper:
        score += 2.5 if "taper" in query_words or "meet" in query_words or "race" in query_words else -1.0
    return score


def chat_context(names: list[str], query: str, limit: int = 8) -> tuple[str, list[dict[str, Any]], list[str]]:
    """Programs of the athlete's coaches for a question: each coach's full overview plus its most relevant sessions.

    Returns (context, sources, coach names). Sources name the sessions used, for provenance in the response.
    """
    programs = resolve_coaches(names)
    if not programs:
        raise ValueError("No valid selected coaches were provided.")
    query_words = {word for word in _WORD.findall(query.lower()) if word not in _STOP}
    ranked = sorted(
        ((program, session, taper, _relevance(program, session, taper, query_words))
         for program in programs for taper, pool in ((False, program.sessions), (True, program.taper)) for session in pool),
        key=lambda item: item[3], reverse=True,
    )
    chosen: list = []
    for program in programs:   # every coach is represented by at least their best-matching sessions
        chosen += [item for item in ranked if item[0] is program][:max(1, limit // (2 * len(programs)))]
    chosen += [item for item in ranked if item not in chosen][:max(0, limit - len(chosen))]
    blocks = [f"=== {program.name} PROGRAM ===\n{render_overview(program)}" for program in programs]
    blocks += [f"--- {render_session(program, session, taper)}" for program, session, taper, _ in chosen]
    others = [session_label(program, session, taper) for program, session, taper, score in ranked
              if (program, session, taper, score) not in chosen]
    if others:
        blocks.append("Other sessions in these programs (ask for any by name): " + "; ".join(others[:60]))
    sources = [{"source_file": session_label(program, session, taper), "coach_name": program.name, "similarity": round(score, 3)}
               for program, session, taper, score in chosen]
    return "\n\n".join(blocks), sources, [program.name for program in programs]


def plan_context(profile: dict[str, Any], coach: str) -> tuple[str, list[str]]:
    """The coach's program (overview and session catalogue) for the athlete's season plan."""
    context, sources, _ = chat_context([coach], " ".join(profile.get("main_events") or []) + " race pace taper", limit=6)
    return context, sorted({item["source_file"] for item in sources})
