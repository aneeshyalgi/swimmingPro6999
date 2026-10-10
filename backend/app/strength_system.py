"""SwimGPT Strength & Mobility System: the methodology the gym generator runs on, encoded as data.

This module is the system itself (no document is read at runtime). In short:

* Three assessments come first: mobility (12 areas), movement (the five-movement "alphabet" plus quality checks)
  and performance KPIs. A swimmer who is already very mobile gets more activation/stability, not more stretching.
* Every athlete has nine buckets. The generator asks which bucket currently limits swimming the most, builds it,
  and keeps the strong buckets with the smallest dose that maintains them (vertical integration: no quality is ever
  removed, only its proportion changes).
* Weekly structure: 3 Strength & Mobility sessions × 6 principal movements ≈ 18 movement slots, distributed by coach.
* Four coaching identities, which must feel completely different:
    Timothy  explosive · powerful · neural      (POWER > strength > robustness > hypertrophy)
    Pete     minimalist · precise · race-quality (low volume, neurological, stop when quality drops)
    Robert   complete · balanced · athletic       (most balanced buckets, most comprehensive mobility)
    Tony     strong · durable · economical        (force capacity and durability at an excellent stimulus-to-fatigue ratio)
* The brain of the system: use the smallest effective training stimulus that produces the greatest improvement in
  the athlete's weakest important bucket.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ---------------------------------------------------------------- buckets
BUCKETS = {
    "lower_strength": "Lower-body strength",
    "lower_power": "Lower-body power",
    "upper_strength": "Upper-body strength",
    "upper_power": "Upper-body power",
    "total_body": "Total-body athleticism",
    "shoulder_robustness": "Shoulder robustness",
    "core": "Core/torso strength",
    "mobility": "Mobility",
    "end_range_control": "End-range control",
}
# How much training a bucket receives this block (STEP 2).
BUILD, MAINTAIN, MINIMAL = "build", "maintain", "minimal"

# ---------------------------------------------------------------- assessment A: mobility
@dataclass(frozen=True)
class MobilityArea:
    label: str
    why: str                       # why it matters in the water
    mobilize: tuple[str, ...]      # drills that open the range
    control: tuple[str, ...]       # drills that train active control of the new range
    rule: str                      # the system's algorithm for a restriction


MOBILITY_AREAS: dict[str, MobilityArea] = {
    "shoulder_flexion": MobilityArea(
        "Shoulder flexion (incl. lat and pec length)", "Streamline, body line and distance per stroke",
        ("lat_mob", "pec_mob", "shoulder_flexion_mob"), ("shoulder_flexion_control",),
        "Mobilize lat / pec / shoulder flexion → end-range activation with active shoulder-flexion work."),
    "shoulder_external_rotation": MobilityArea(
        "Shoulder external rotation", "Overhead mobility and shoulder robustness",
        ("er_mob",), ("er_activation",),
        "Mobilize carefully → strengthen and control the available range → add rotator-cuff work."),
    "shoulder_internal_rotation": MobilityArea(
        "Shoulder internal rotation", "EVF/catch mechanics",
        (), ("controlled_ir",),
        "Do not automatically prescribe aggressive sleeper stretching; use controlled, active internal rotation."),
    "t_spine_rotation": MobilityArea(
        "T-spine rotation", "Recovery mechanics; especially important for sprinters",
        ("t_spine_rotation",), ("t_spine_rotation_control",),
        "T-spine mobilization → active rotational control. Priority: Timothy → Pete → Robert → Tony."),
    "t_spine_extension": MobilityArea(
        "T-spine extension", "Streamline, dolphin kick and butterfly catch",
        ("t_spine_extension",), ("t_spine_extension_control",),
        "Mobilize thoracic extension → control it actively overhead without lumbar arching."),
    "hip_rotation": MobilityArea(
        "Hip internal/external rotation", "Breaststroke and movement control",
        ("hip_ir_er",), ("hip_rotation_control",),
        "Mobilize hip rotation → control the new range actively."),
    "hip_flexor_quad": MobilityArea(
        "Hip flexor/quad length", "Hip extension and kick range",
        ("hip_flexor_mob", "quad_mob"), ("glute_bridge",),
        "Hip-flexor mobilization → glute/hip-extension strengthening."),
    "hamstring": MobilityArea(
        "Hamstring length", "Hip and knee motion",
        ("hamstring_mob",), ("hip_flexor_liftoff",),
        "Hamstring mobilization → hip-flexor end-range strength (hip-flexor liftoffs)."),
    "ankle_dorsiflexion": MobilityArea(
        "Ankle dorsiflexion", "Squatting and breaststroke",
        ("ankle_df_mob",), ("squat_hold",),
        "Mobilize dorsiflexion → use controlled squat patterns (especially relevant for breaststroke)."),
    "ankle_plantar_flexion": MobilityArea(
        "Ankle plantar flexion", "Flutter and dolphin kick",
        ("plantar_mob",), ("plantar_active",),
        "Plantar-flexion mobility → active plantar-flexion control (key for flutter and dolphin kick)."),
}
CENTRAL_MOBILITY_RULE = "Mobilize the restricted structure, then train the athlete to actively control the newly available end range."
NEVER_PRESCRIBE = ("sleeper stretch",)  # internal rotation: never aggressive sleeper stretching by default

# Which ranges each stroke depends on (from "why it matters"); every athlete's mobility work covers their strokes.
STROKE_MOBILITY = {
    "Freestyle": ("shoulder_flexion", "t_spine_rotation", "ankle_plantar_flexion"),
    "Backstroke": ("shoulder_flexion", "shoulder_external_rotation", "t_spine_rotation", "ankle_plantar_flexion"),
    "Butterfly": ("t_spine_extension", "shoulder_flexion", "ankle_plantar_flexion"),
    "Breaststroke": ("hip_rotation", "ankle_dorsiflexion", "hip_flexor_quad"),
    "IM": ("hip_rotation", "ankle_dorsiflexion", "shoulder_flexion", "t_spine_rotation"),
}

# Warm-up order by mobility profile (STEP 4).
WARM_UP_ORDER = {
    "hypomobile": ("temperature", "soft_tissue", "mobility", "activation"),     # more time on restricted ranges
    "standard": ("temperature", "soft_tissue", "mobility", "activation"),       # the ASP sequence
    "hypermobile": ("temperature", "activation", "control"),                    # less unnecessary passive mobility
}

# ---------------------------------------------------------------- assessment B: movement
# The fundamental movement "alphabet". A poor score keeps the dependent families at level 1: the athlete does not
# advance merely because they are strong.
MOVEMENT_ALPHABET = {
    "push_up": ("push_up", "push_up_progression", "powerful_push_up", "handstand"),
    "chin_up": ("chin_up", "pull_up", "front_lever"),
    "goblet_squat": ("goblet_squat", "pistol", "trap_bar_velocity"),
    "hip_hinge": ("hip_hinge", "trap_bar_velocity"),
    "plank": ("plank", "ab_wheel", "front_lever", "handstand"),
}
MOVEMENT_CHECKS = ("Scapular control during pulling", "Pelvis and neck position during pushing", "Lumbar compensation",
                   "Proper hip hinge", "Foot stability during squatting")
# The movement assessment's checks, applied to every rep of the families they govern.
QUALITY_CHECKS = {
    "chin_up": "scapular control during pulling", "pull_up": "scapular control during pulling", "front_lever": "scapular control during pulling",
    "push_up": "pelvis and neck position during pushing", "push_up_progression": "pelvis and neck position during pushing",
    "powerful_push_up": "pelvis and neck position during pushing", "handstand": "lumbar compensation (no arching)",
    "ab_wheel": "lumbar compensation (no arching)", "plank": "lumbar compensation (no arching)",
    "hip_hinge": "a proper hip hinge (neutral spine, hips back)", "trap_bar_velocity": "a proper hip hinge (neutral spine, hips back)",
    "goblet_squat": "foot stability during squatting", "pistol": "foot stability during squatting",
}

# ---------------------------------------------------------------- assessment C: performance KPIs
KPIS = {
    "ncm_jump": ("Non-Countermovement Jump", "lower_power"),
    "broad_jump": ("Broad Jump", "lower_power"),              # horizontal power / dive athleticism
    "weighted_pull_up": ("Weighted Pull-Up", "upper_strength"),
    "trap_bar_velocity": ("Trap Bar / Squat Velocity", "lower_power"),  # strength-speed
    "assault_bike_watts": ("Assault Bike Max Watt", "total_body"),
    "imtp": ("Isometric Mid-Thigh Pull", "lower_strength"),   # force-production capacity
}
# Reference ranges are KPIs, not exercises athletes must chase regardless of their individual needs.
RELATIVE_PULL_UP_ELITE = {"male": (1.4, 1.8), "female": (1.2, 1.5)}
BROAD_JUMP_ELITE_CM = {"male": 254, "female": 203}


def relative_pull_up(added_kg_1rm: float, bodyweight_kg: float) -> float:
    """Relative Pull-Up = (1RM added load + bodyweight) / bodyweight."""
    return (added_kg_1rm + bodyweight_kg) / bodyweight_kg


# ---------------------------------------------------------------- session structure
@dataclass(frozen=True)
class Dose:
    drill: str
    amount: str                    # e.g. "8/side", "10", "30 sec/side", "20 sec"


@dataclass(frozen=True)
class WarmUp:
    temperature: str = "5 min easy temperature elevation"
    soft_tissue: tuple[str, ...] = ()            # regions, 30–45 sec each
    mobility: tuple[Dose, ...] = ()
    mobility_rounds: int = 1
    activation: tuple[Dose, ...] = ()
    activation_rounds: int = 1


@dataclass(frozen=True)
class Slot:
    family: str
    sets: int
    reps: str | None                # None: the variant's own hold/skill dose
    rest: int                       # seconds
    target: int = 1                 # progression level of the movement the system names here
    note: str = ""


@dataclass(frozen=True)
class SessionTemplate:
    number: int
    title: str
    focus: str
    main: tuple[Slot, ...]
    warm_up: WarmUp
    finish: tuple[Dose, ...] = ()
    finish_rounds: int = 1
    optional: Slot | None = None    # optional finisher (e.g. Timothy's power KPI finisher)
    notes: tuple[str, ...] = ()
    taper_dose: bool = False        # already designed as a race-week dose (no further taper cuts)


@dataclass(frozen=True)
class MobilityRoutine:
    title: str
    minutes: str
    rounds: int
    drills: tuple[Dose, ...]
    then: tuple[Dose, ...] = ()     # active end-range control after the rounds
    note: str = ""


@dataclass(frozen=True)
class CoachSystem:
    key: str
    coach: str
    system: str
    events: str
    objective: str
    character: str
    feel: str
    philosophy: str
    ratings: dict[str, str]
    t_spine_rotation: str                       # priority of rotation work
    sessions: dict[int, SessionTemplate]
    mobility: MobilityRoutine
    mesocycle: dict[str, str]                   # block → this coach's emphasis
    preference: dict[str, tuple[int, ...]]      # block → session order used when fewer/more than 3 sessions
    block_dose: dict[str, dict[str, int]] = field(default_factory=dict)   # block → set change per category
    rules: tuple[str, ...] = ()


# ---------------------------------------------------------------- shared prescriptions
def _s(family: str, sets: int, reps: str | None, rest: int, target: int = 1, note: str = "") -> Slot:
    return Slot(family, sets, reps, rest, target, note)


def _doses(*items: tuple[str, str]) -> tuple[Dose, ...]:
    return tuple(Dose(drill, amount) for drill, amount in items)


NCM_NOTE = "Full recovery. Explosive wall/start-type force production without relying on a countermovement."
BROAD_NOTE = "Full reset between repetitions. Horizontal power relevant to dive athleticism."
TRAP_NOTE = "Moderate load moved as fast as technically possible."

# ---------------------------------------------------------------- COACH TIMOTHY: pure sprint
_TIMOTHY_ACTIVATION = _doses(("hip_flexor_liftoff", "8/side"), ("glute_bridge", "10"), ("plank_hold", "20 sec"))
_TIMOTHY_FINISH = _doses(("shoulder_flexion_control", "8"), ("t_spine_rotation", "8/side"), ("plantar_active", "8"))
TIMOTHY = CoachSystem(
    key="timothy", coach="Coach Timothy", system="Pure Sprint Strength & Mobility System",
    events="50 Free / Fly / Back / Breast",
    objective="Maximize power production with minimal unnecessary fatigue.",
    character="Explosive. Powerful. Neural.",
    feel="The gym should make the swimmer feel like a faster athlete.",
    philosophy="POWER > strength > robustness > hypertrophy, while avoiding unnecessary fatigue. Maximum speed. Maximum quality. Race at your absolute limit.",
    ratings={"max_strength": "★★★★★", "power": "★★★★★", "lower_body_power": "★★★★★", "upper_body_strength": "★★★★★",
             "training_volume": "Low–Moderate", "t_spine_rotation": "Very high priority", "shoulder_robustness": "High",
             "hip_mobility": "Moderate", "fatigue_tolerance": "Very low", "gym_character": "Explosive"},
    t_spine_rotation="very high",
    sessions={
        1: SessionTemplate(
            1, "Lower-Body Power + Start/Turn Strength", "Lower-body power for starts and turns",
            warm_up=WarmUp(
                temperature="5 min easy Assault Bike", soft_tissue=("Quads", "Hip flexors", "Glutes", "Lats"),
                mobility=_doses(("t_spine_rotation", "8/side"), ("t_spine_extension", "8"), ("hip_flexor_mob", "8/side"),
                                ("ankle_df_mob", "10/side"), ("plantar_active", "10")), mobility_rounds=2,
                activation=_TIMOTHY_ACTIVATION, activation_rounds=2),
            main=(_s("ncm_jump", 5, "3", 120, note=NCM_NOTE),
                  _s("broad_jump", 4, "3", 120, note=BROAD_NOTE),
                  _s("trap_bar_velocity", 5, "3", 150, note=TRAP_NOTE + " 2–3 min recovery."),
                  _s("chin_up", 4, "4", 150, target=2, note="2–3 min recovery."),
                  _s("pistol", 3, "5/side", 90, target=3, note="Only progress toward pistol squat once fundamental squat control is excellent."),
                  _s("ab_wheel", 3, "5–8", 60, target=3, note="Maintain complete torso control.")),
            finish=_TIMOTHY_FINISH, finish_rounds=2),
        2: SessionTemplate(
            2, "Upper-Body Strength + Sprint Posture", "Upper-body strength and sprint posture",
            warm_up=WarmUp(
                soft_tissue=("Pecs", "Lats", "Thoracic region"),
                mobility=_doses(("shoulder_flexion_mob", "8"), ("t_spine_extension", "8"), ("t_spine_rotation", "8/side"), ("er_mob", "8")),
                mobility_rounds=2,
                activation=_doses(("scap_row", "10"), ("er_activation", "10"), ("plank_hold", "20 sec")), activation_rounds=2),
            main=(_s("chin_up", 5, "3", 150, target=2),
                  _s("powerful_push_up", 4, "4–6", 120, target=2, note="Perfect trunk position. No lumbar extension."),
                  _s("front_lever", 4, None, 90, target=3, note="Choose the regression allowing perfect body position."),
                  _s("goblet_squat", 3, "6", 120),
                  _s("hip_hinge", 3, "6", 120, target=2, note="Emphasis on torso pressure, neutral spine and glute contribution."),
                  _s("handstand", 3, None, 90, target=3, note="Only after adequate shoulder flexion and torso control.")),
            finish=_doses(("lat_mob", "30 sec/side"), ("pec_mob", "30 sec/side"), ("t_spine_rotation", "8/side"), ("shoulder_flexion_control", "8")),
            finish_rounds=2),
        3: SessionTemplate(
            3, "Total-Body Maximum Power", "Total-body maximum power",
            warm_up=WarmUp(
                soft_tissue=("Lats", "Hip flexors", "Quads", "Thoracic region"),
                mobility=_doses(("t_spine_rotation", "8/side"), ("t_spine_extension", "8"), ("shoulder_flexion_mob", "8"), ("plantar_active", "10")),
                mobility_rounds=2, activation=_TIMOTHY_ACTIVATION, activation_rounds=2),
            main=(_s("ncm_jump", 4, "3", 120, note=NCM_NOTE),
                  _s("broad_jump", 3, "3", 120, note=BROAD_NOTE),
                  _s("trap_bar_velocity", 4, "3", 150, note=TRAP_NOTE),
                  _s("pull_up", 4, "3", 150, target=2),
                  _s("push_up_progression", 3, "5–8", 90, target=2),
                  _s("ab_wheel", 3, "5–8", 60, target=3, note="Maintain complete torso control.")),
            optional=_s("assault_bike", 3, "10 sec MAX", 240, note="Optional power KPI finisher (2–3 sprints). Very long recovery: the goal is maximum power, not conditioning."),
            finish=_TIMOTHY_FINISH, finish_rounds=1),
    },
    mobility=MobilityRoutine(  # sprint mobility: Pete and Timothy both receive higher T-spine emphasis
        "Sprint Mobility", "10–15 min", 2,
        _doses(("t_spine_rotation", "8/side"), ("t_spine_extension", "8"), ("shoulder_flexion_mob", "8"), ("lat_mob", "30 sec/side"),
               ("pec_mob", "30 sec/side"), ("shoulder_flexion_control", "8"), ("plantar_active", "10")),
        note="Sprint swimming uses less hip rotation and relies more on thoracic rotation, so T-spine work gets very high priority."),
    mesocycle={"W1-2": "Strength + power", "W3-4": "Maximum power", "W5": "Sprint power", "W6": "Neural taper"},
    preference={"W1-2": (3, 2, 1), "W3-4": (3, 1, 2), "W5": (3, 1), "W6": (3, 1)},
    block_dose={"W3-4": {"power": 1}},
    rules=("Prioritize power over strength, robustness and hypertrophy.", "Avoid unnecessary fatigue: every rep fast and crisp."),
)

# ---------------------------------------------------------------- COACH PETE: USRPT
_PETE_WARM_UP = WarmUp(
    temperature="5 min easy temperature elevation",
    mobility=_doses(("shoulder_flexion_mob", "8"), ("t_spine_rotation", "8/side"), ("t_spine_extension", "8"), ("hip_flexor_mob", "8/side"), ("ankle_mob", "10")),
    activation=_doses(("scap_row", "10"), ("hip_flexor_liftoff", "8/side"), ("plank_hold", "20 sec")))
PETE_RULE = ("USRPT rule: the session stops being productive when movement velocity drops substantially, position deteriorates, "
             "or repetitions stop looking athletic. Stop there; never accumulate poor repetitions.")
PETE = CoachSystem(
    key="pete", coach="Coach Pete", system="USRPT Strength & Mobility System", events="Sprint and race-pace events",
    objective="Dryland that resembles the swimming: specific, low-volume, high-quality and neurologically focused.",
    character="Minimalist. Precise. Race-quality focused.",
    feel="Everything unnecessary gets removed. No bodybuilding-style fatigue interfering with race-pace swimming.",
    philosophy="Neuromuscular adaptation, exact race-quality execution and low training volume.",
    ratings={"max_strength": "★★★★", "power": "★★★★★", "lower_body_power": "★★★★", "upper_body_strength": "★★★★",
             "training_volume": "Low", "t_spine_rotation": "Very high priority", "shoulder_robustness": "High",
             "hip_mobility": "Moderate", "fatigue_tolerance": "Very low", "gym_character": "Neural"},
    t_spine_rotation="very high",
    sessions={
        1: SessionTemplate(
            1, "Neural Strength", "Neural strength", warm_up=_PETE_WARM_UP,
            main=(_s("ncm_jump", 4, "2", 120, note="Full recovery; every rep maximal."),
                  _s("chin_up", 4, "3", 150, target=2),
                  _s("goblet_squat", 3, "5", 120),
                  _s("hip_hinge", 3, "5", 120),
                  _s("push_up", 3, "5–8", 90),
                  _s("ab_wheel", 3, "5", 60, target=2)),
            notes=(PETE_RULE,)),
        2: SessionTemplate(
            2, "Race-Power Maintenance", "Race-power maintenance", warm_up=_PETE_WARM_UP,
            main=(_s("broad_jump", 4, "2", 120, note="Full reset between repetitions."),
                  _s("ncm_jump", 4, "2", 120, note="Full recovery."),
                  _s("chin_up", 3, "4", 150, target=2),
                  _s("goblet_squat", 3, "5", 120),
                  _s("push_up", 3, "5", 90),
                  _s("plank", 3, "20–30 sec", 60, target=2)),
            notes=("Low total volume. High execution quality. Long enough recovery to preserve performance.", PETE_RULE)),
        3: SessionTemplate(
            3, "Race-Week Strength Microdose", "Strength/power maintenance microdose", warm_up=_PETE_WARM_UP,
            main=(_s("ncm_jump", 3, "2", 120),
                  _s("chin_up", 3, "3", 150),
                  _s("push_up", 2, "5", 90),
                  _s("goblet_squat", 2, "5", 90),
                  _s("hip_hinge", 2, "5", 90),
                  _s("plank", 2, "20 sec", 45)),
            finish=_doses(("t_spine_rotation", "8/side"), ("t_spine_extension", "8"), ("shoulder_flexion_mob", "8"),
                          ("shoulder_flexion_control", "8"), ("plantar_active", "10")),
            notes=("Deliberately smaller: maintain the strength and power buckets without creating unnecessary fatigue.", PETE_RULE),
            taper_dose=True),
    },
    mobility=MobilityRoutine(
        "Sprint Mobility", "10–15 min", 2,
        _doses(("t_spine_rotation", "8/side"), ("t_spine_extension", "8"), ("shoulder_flexion_mob", "8"), ("lat_mob", "30 sec/side"),
               ("pec_mob", "30 sec/side"), ("shoulder_flexion_control", "8"), ("plantar_active", "10")),
        note="2–3 rounds. Sprint swimming places greater requirements on thoracic rotation."),
    mesocycle={"W1-2": "Strength quality", "W3-4": "Race-power", "W5": "Maintenance", "W6": "Microdose"},
    preference={"W1-2": (1, 2, 3), "W3-4": (2, 1, 3), "W5": (2, 3), "W6": (3, 3)},
    block_dose={"W3-4": {"power": 1}},
    rules=(PETE_RULE,),
)

# ---------------------------------------------------------------- COACH ROBERT: IM & middle distance
_ROBERT_WARM_UP = WarmUp(
    soft_tissue=("Lats", "Pecs", "Quads", "Hip flexors"),
    mobility=_doses(("shoulder_flexion_mob", "8"), ("t_spine_rotation", "8/side"), ("t_spine_extension", "8"), ("hip_ir_er", "8/side"),
                    ("ankle_df_mob", "10"), ("plantar_active", "10")),
    activation=_doses(("scap_row", "10"), ("hip_flexor_liftoff", "8"), ("plank_hold", "20–30 sec")))
_ROBERT_FINISH = _doses(("hip_flexor_liftoff", "8/side"), ("shoulder_flexion_control", "8"))
ROBERT = CoachSystem(
    key="robert", coach="Coach Robert", system="IM & Middle-Distance Strength System", events="200/400 IM and 200 stroke events",
    objective="The most balanced bucket distribution: strength, power, shoulder robustness, hip and ankle mobility, pulling, lower-body and torso strength, rather than extreme specialization.",
    character="Complete. Balanced. Athletic.",
    feel="Build a swimmer capable across every stroke and multiple physiological demands.",
    philosophy="Balanced total athletic development across every stroke.",
    ratings={"max_strength": "★★★★", "power": "★★★★", "lower_body_power": "★★★★", "upper_body_strength": "★★★★",
             "training_volume": "Moderate", "t_spine_rotation": "High", "shoulder_robustness": "Very high",
             "hip_mobility": "Very high", "fatigue_tolerance": "Moderate", "gym_character": "Complete"},
    t_spine_rotation="high",
    sessions={
        1: SessionTemplate(
            1, "Total-Body Strength", "Total-body strength", warm_up=_ROBERT_WARM_UP,
            main=(_s("goblet_squat", 4, "6", 120),
                  _s("chin_up", 4, "4–6", 150, target=2),
                  _s("hip_hinge", 4, "5–6", 120, target=2),
                  _s("push_up_progression", 3, "6–10", 90, target=2),
                  _s("pistol", 3, "5/side", 90, target=3, note="Only progress toward pistol squat once fundamental squat control is excellent."),
                  _s("ab_wheel", 3, "6", 60, target=3, note="Maintain complete torso control.")),
            finish=_ROBERT_FINISH),
        2: SessionTemplate(
            2, "Power + Athleticism", "Power and athleticism", warm_up=_ROBERT_WARM_UP,
            main=(_s("ncm_jump", 4, "3", 120, note=NCM_NOTE),
                  _s("broad_jump", 4, "3", 120, note=BROAD_NOTE),
                  _s("trap_bar_velocity", 4, "3", 150, note=TRAP_NOTE),
                  _s("chin_up", 4, "5", 120),
                  _s("handstand", 3, None, 90, target=3, note="Only after adequate shoulder flexion and torso control."),
                  _s("front_lever", 3, None, 90, target=3, note="Choose the regression allowing perfect body position.")),
            finish=_ROBERT_FINISH),
        3: SessionTemplate(
            3, "Robustness + Strength", "Robustness and strength", warm_up=_ROBERT_WARM_UP,
            main=(_s("goblet_squat", 3, "8", 90),
                  _s("hip_hinge", 3, "6", 90),
                  _s("chin_up", 3, "6", 120),
                  _s("push_up", 3, "8", 90),
                  _s("scap_cuff", 3, "8–12", 45, target=2),
                  # The system gives "3 sets" only; reps follow Robert's own AB-wheel dose in Session 1.
                  _s("ab_wheel", 3, "6", 60, target=2, note="Plank / AB-wheel progression: maintain complete torso control.")),
            finish=_ROBERT_FINISH),
    },
    mobility=MobilityRoutine(
        "IM Mobility", "15 min", 2,
        _doses(("shoulder_flexion_mob", "8"), ("t_spine_rotation", "8/side"), ("t_spine_extension", "8"), ("hip_ir", "8/side"),
               ("hip_er", "8/side"), ("hip_flexor_mob", "30 sec/side"), ("ankle_df_mob", "10"), ("plantar_active", "10")),
        then=_doses(("hip_flexor_liftoff", "8/side"), ("shoulder_flexion_control", "8")),
        note="The most comprehensive mobility routine of the four coaches: shoulders, T-spine, hips and lower body. Mobilize → actively control the new range."),
    mesocycle={"W1-2": "Balanced strength", "W3-4": "Strength + power", "W5": "Race-specific shift", "W6": "Maintenance"},
    preference={"W1-2": (1, 2, 3), "W3-4": (2, 1, 3), "W5": (2, 3, 1), "W6": (3, 2)},
    block_dose={"W3-4": {"power": 1}},
)

# ---------------------------------------------------------------- COACH TONY: distance
_TONY_WARM_UP = WarmUp(
    temperature="5 min easy temperature elevation",
    mobility=_doses(("shoulder_flexion_mob", "8"), ("t_spine_extension", "8"), ("hip_flexor_mob", "8/side"), ("hamstring_mob", "8/side"), ("ankle_mob", "10")),
    activation=_doses(("scap_row", "10"), ("glute_activation", "10"), ("plank_hold", "20–30 sec")))
_TONY_FINISH = _doses(("shoulder_flexion_control", "8"), ("plantar_active", "10"))
TONY = CoachSystem(
    key="tony", coach="Coach Tony", system="Distance Strength & Mobility System", events="400–1500 Free",
    objective="Increase force capacity, durability and movement quality while maintaining an excellent stimulus-to-fatigue ratio.",
    character="Strong. Durable. Economical.",
    feel="Develop enough dryland strength to improve performance without compromising the huge workload distance swimming requires.",
    philosophy="The gym cannot become another source of unnecessary fatigue on top of high swim volume.",
    ratings={"max_strength": "★★★", "power": "★★", "lower_body_power": "★★", "upper_body_strength": "★★★★",
             "training_volume": "Low–Moderate", "t_spine_rotation": "Moderate", "shoulder_robustness": "Very high",
             "hip_mobility": "High", "fatigue_tolerance": "Very low due to swim volume", "gym_character": "Economical"},
    t_spine_rotation="moderate",
    sessions={
        1: SessionTemplate(
            1, "Fundamental Strength", "Fundamental strength", warm_up=_TONY_WARM_UP,
            main=(_s("goblet_squat", 4, "6", 90),
                  _s("chin_up", 4, "5–8", 120),
                  _s("hip_hinge", 4, "6", 90),
                  _s("push_up", 3, "8", 75),
                  _s("plank", 3, "30–45 sec", 60),
                  _s("scap_cuff", 3, "10–12", 45)),
            finish=_TONY_FINISH),
        2: SessionTemplate(
            2, "Strength + Robustness", "Strength and robustness", warm_up=_TONY_WARM_UP,
            main=(_s("pistol", 3, "5–6/side", 90, target=2, note="Goblet squat / pistol progression: progress only with excellent squat control."),
                  _s("chin_up", 4, "4–6", 120, target=2),
                  _s("hip_hinge", 3, "6", 90),
                  _s("push_up", 3, "6–10", 75),
                  _s("ab_wheel", 3, "5–8", 60, target=2),
                  _s("scap_cuff", 3, "10", 45, target=2, note="Shoulder robustness work.")),
            finish=_TONY_FINISH),
        3: SessionTemplate(
            3, "Low-Fatigue Power + Maintenance", "Low-fatigue power and maintenance", warm_up=_TONY_WARM_UP,
            main=(_s("ncm_jump", 3, "3", 120),
                  _s("broad_jump", 3, "3", 120),
                  _s("trap_bar_velocity", 3, "3", 120),
                  _s("chin_up", 3, "5", 120),
                  _s("push_up", 3, "6", 75),
                  _s("plank", 3, "30–45 sec", 60)),  # the system gives "3 sets" only; hold from Tony's Session 1
            finish=_TONY_FINISH,
            notes=("Vertical integration: power is not removed from a distance program; its volume decreases.",)),
    },
    mobility=MobilityRoutine(
        "Recovery Mobility", "10–15 min", 2,
        _doses(("lat_mob", "30 sec/side"), ("pec_mob", "30 sec/side"), ("shoulder_flexion_mob", "8"), ("t_spine_extension", "8"),
               ("hip_flexor_mob", "30 sec/side"), ("quad_mob", "30 sec/side"), ("hamstring_mob", "8/side"), ("plantar_active", "10")),
        then=_doses(("shoulder_flexion_control", "8"),),
        note="Tony's swimmers don't need Timothy/Pete's volume of T-spine rotation unless an assessment shows a restriction."),
    mesocycle={"W1-2": "Strength/robustness", "W3-4": "Strength", "W5": "Maintenance", "W6": "Low fatigue"},
    preference={"W1-2": (1, 3, 2), "W3-4": (1, 2, 3), "W5": (3, 1), "W6": (3, 3)},
    block_dose={"W3-4": {"strength": 1}},
)

COACH_SYSTEMS: dict[str, CoachSystem] = {system.key: system for system in (TIMOTHY, PETE, ROBERT, TONY)}
SYSTEM_BY_COACH_NAME = {system.coach: system.key for system in COACH_SYSTEMS.values()}
# T-spine rotation work, highest priority first.
T_SPINE_ROTATION_PRIORITY = ("timothy", "pete", "robert", "tony")

# ---------------------------------------------------------------- periodisation: vertical integration
# Never "base = only hypertrophy, strength phase = only strength, competition = no gym". All qualities stay present;
# only their proportions change. Mesocycles run 2–10 weeks and are planned backward from competition.
@dataclass(frozen=True)
class Phase:
    key: str
    label: str
    more: tuple[str, ...]
    maintain: tuple[str, ...]
    reduce: tuple[str, ...]
    dose: dict[str, int]              # set change per category (power/strength/robustness/core)
    max_sessions: int | None = None
    low_reps: bool = False            # use the low end of every rep range
    optional_finisher: bool = True
    regress_skills: bool = False      # no novel or soreness-inducing skill progressions


PHASES = {
    "W1-2": Phase("general", "General preparation", more=("strength", "fundamental movement development", "robustness"),
                  maintain=("power (moderate)",), reduce=(), dose={}),
    "W3-4": Phase("specific", "Specific preparation", more=("strength-speed", "power"),
                  maintain=("fundamental strength", "robustness"), reduce=("unnecessary volume",), dose={}),
    "W5": Phase("competition", "Competition phase", more=("power", "mobility", "movement quality"),
                maintain=("strength (maintenance)",), reduce=("total volume", "high-fatigue training"),
                dose={"strength": -1, "robustness": -1, "core": -1}, max_sessions=3, low_reps=True, optional_finisher=False),
    "W6": Phase("taper", "Taper", more=("neural exposure", "explosive movements", "mobility", "strength signal"),
                maintain=(), reduce=("volume (extremely low)", "unnecessary soreness", "exhaustive sessions", "chasing adaptations in the final days"),
                dose={}, max_sessions=2, low_reps=True,  # sets are capped by TAPER_SETS
                optional_finisher=False, regress_skills=True),
}
TAPER_SETS = {"power": 3, "strength": 2, "robustness": 2, "core": 2}   # taper ceilings: extremely low volume
COMPETITION_PRIORITIES = ("A", "B")      # meets worth planning backward from (C meets are training races)
NO_GYM_DAYS_BEFORE_MEET = 2              # no strength session on race day or the two days before it

PROGRAMMING_RULE = ("Use the smallest effective training stimulus that produces the greatest improvement in the athlete's "
                    "weakest important bucket.")
QUALITY_RULES = ("Reduce or regress when movement quality deteriorates, compensation occurs, mobility prevents correct "
                 "execution, or fatigue becomes incompatible with the objective.")
STIMULUS_TO_FATIGUE = "Always ask whether a lower-fatigue exercise or stimulus could achieve the same adaptation."
