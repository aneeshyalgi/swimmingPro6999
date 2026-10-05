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


def _lead_rank(key: str, fit: dict[str, Any], order: list[str]) -> tuple:
    return (len(fit["matched"]), fit["affinity"], fit["feasible"], len(fit["supporting"]), fit["specificity"], -order.index(key))


def coach_key(name: str) -> str | None:
    """Catalog key for a coach name or key ("Coach Brad", "coach brad", "brad"), or None if unknown."""
    normalized = re.sub(r"\s+", " ", str(name)).strip().lower()
    if normalized in COACHES:
        return normalized
    return next((key for key, coach in COACHES.items() if coach["name"].lower() == normalized), None)


def select_coaches(profile: dict[str, Any], chosen: list[str] | None = None) -> tuple[list[str], list[str]]:
    """The athlete's two coaches: the ones they chose, or the two whose programs best fit them.

    `chosen` (or the profile's `chosen_coaches`) holds the coaches the athlete picked during onboarding, head coach
    first. Two picks are used exactly as given. One pick leads, paired with the coach who completes it best under the
    ranking below. No picks (or an empty list) gives the recommended pair.

    Every pair of coaches is ranked by, in order:

    Every pair of coaches is ranked by, in order:
      1. how many of the athlete's events are main events of at least one of the two coaches;
      2. total main-event matches across both coaches;
      3. swimmer-type fit (specialist = 2, adjacent = 1);
      4. whether the athlete can follow both programs (Timothy's program needs a gym);
      5. extra event support beyond main events (Pete's 200 Pace sessions);
      6. how specialised the coaches are for the athlete's events;
      7. catalog order, so the result is always deterministic.
    The coach who fits the athlete best on their own leads (the default coach in chat).
    """
    order, fit, pair_rank = _pair_ranker(profile)
    picks = chosen if chosen is not None else profile.get("chosen_coaches") or []
    keys = list(dict.fromkeys(key for key in (coach_key(name) for name in picks) if key))[:2]
    if len(keys) == 1:
        keys.append(max((key for key in order if key != keys[0]), key=lambda key: pair_rank((keys[0], key))))
    if not keys:
        best = max(((a, b) for i, a in enumerate(order) for b in order[i + 1 :]), key=pair_rank)
        keys = sorted(best, key=lambda key: _lead_rank(key, fit[key], order), reverse=True)
    return keys, [_coach_name(key) for key in keys]


def _pair_ranker(profile: dict[str, Any]):
    order = list(COACHES)
    fit = {key: _coach_fit(key, profile) for key in order}
    events = set(profile.get("main_events") or [])

    def pair_rank(pair: tuple[str, str]) -> tuple:
        first, second = pair
        covered = events & (set(COACHES[first]["main_events"]) | set(COACHES[second]["main_events"]))
        return (
            len(covered),
            len(fit[first]["matched"]) + len(fit[second]["matched"]),
            fit[first]["affinity"] + fit[second]["affinity"],
            fit[first]["feasible"] + fit[second]["feasible"],
            len(fit[first]["supporting"]) + len(fit[second]["supporting"]),
            fit[first]["specificity"] + fit[second]["specificity"],
            -(order.index(first) + order.index(second)),
        )

    return order, fit, pair_rank


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + f" and {items[-1]}"


def _reasons(key: str, fit: dict[str, Any], profile: dict[str, Any], standalone: bool = False) -> list[str]:
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
        reasons.append(
            f"Built for {_join(coach['main_events'][:3])} rather than your events." if standalone
            else f"Complements your other coach with {coach['title'].lower()} sessions."
        )
    return reasons


def _your_week(key: str, profile: dict[str, Any]) -> dict[str, Any] | None:
    structure = COACHES[key]["weekly_structure"]
    requested = int(profile.get("swim_sessions_per_week") or 0)
    if not structure or requested <= 0:
        return None
    sessions = min(max(requested, min(structure)), max(structure))
    return {"requested": requested, "sessions_per_week": sessions, "order": structure[sessions]}


def coach_recommendations(profile: dict[str, Any], coach_names: list[str]) -> list[dict[str, Any]]:
    """Full profile of each selected coach plus why they were recommended, in the given (lead-first) order."""
    recommendations = []
    for name in coach_names:
        key = coach_key(name)
        if key is None:
            continue
        fit = _coach_fit(key, profile)
        recommendations.append({
            **public_profile(key),
            "covered_events": fit["matched"],
            "supported_events": fit["supporting"],
            "reasons": _reasons(key, fit, profile),
            "your_week": _your_week(key, profile),
        })
    return recommendations


def coach_options(profile: dict[str, Any]) -> dict[str, Any]:
    """Every coach the athlete can choose during onboarding, recommended pair first, each with how they fit.

    `recommended` is 1 for the recommended head coach, 2 for the second, else None. `partner` is who the coach would be
    paired with if the athlete picks only them.
    """
    recommended, names = select_coaches(profile, chosen=[])
    order, fit, pair_rank = _pair_ranker(profile)
    ranked = recommended + sorted((key for key in order if key not in recommended),
                                  key=lambda key: _lead_rank(key, fit[key], order), reverse=True)
    coaches = []
    for key in ranked:
        partner = max((other for other in order if other != key), key=lambda other: pair_rank((key, other)))
        coaches.append({
            **public_profile(key),
            "covered_events": fit[key]["matched"],
            "supported_events": fit[key]["supporting"],
            "reasons": _reasons(key, fit[key], profile, standalone=True),
            "your_week": _your_week(key, profile),
            "recommended": recommended.index(key) + 1 if key in recommended else None,
            "partner": _coach_name(partner),
        })
    return {"coaches": coaches, "recommended": names}


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


def plan_context(profile: dict[str, Any]) -> tuple[str, list[str], list[str]]:
    """The two selected coaches' programs (overviews and session catalogue) for the season plan."""
    _, selected = select_coaches(profile)
    context, sources, names = chat_context(selected, " ".join(profile.get("main_events") or []) + " race pace taper", limit=6)
    return context, sorted({item["source_file"] for item in sources}), names
