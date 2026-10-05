"""SwimGPT Strength & Mobility: the exercise and drill library.

Every principal movement of the SwimGPT Strength & Mobility System is a *family*: an ordered ladder of variants from
the most regressed to the movement the system names (and, for the advanced targets, beyond it). The generator picks the
hardest variant the athlete has earned (progression level), can do with their equipment, and that is safe for their age.
Mobility, activation and warm-up items are *drills*, each tied to the mobility area it serves.

Progression levels (fundamental-to-advanced hierarchy):
  1  SwimGPT fundamentals: push-up, chin-up, goblet squat, hip hinge, plank (the movement "alphabet").
  2  Strength development: more difficulty/load while movement quality holds (chin-up → weighted chin-up,
     goblet squat → stronger squat patterns, plank → dynamic anti-extension control).
  3  Advanced athletic targets: standing AB wheel, front lever, pistol squat, handstand. These are destinations,
     not exercises every swimmer must perform now; regressions are used until strength and quality allow.

Equipment tags: bar (pull-up bar), trap_bar, barbell, weights (dumbbells/kettlebells), plate, band, bike (air/Assault
bike), ab_wheel, roller (foam roller). Bodyweight variants need nothing.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ---------------------------------------------------------------- equipment
EQUIPMENT_BY_FACILITY = {
    "Full Gym Access": frozenset({"bar", "trap_bar", "barbell", "weights", "plate", "band", "bike", "ab_wheel", "roller"}),
    "Basic Gym": frozenset({"bar", "weights", "band", "roller"}),
    "Home Equipment": frozenset({"weights", "band"}),
    None: frozenset({"band"}),  # no gym access: bodyweight, bands and dryland only
}


@dataclass(frozen=True)
class Variant:
    name: str
    level: int                                   # 1 fundamentals · 2 strength development · 3 advanced target
    steps: tuple[str, ...]                       # step-by-step demonstration
    needs: frozenset[str] = frozenset()
    load: str = "Bodyweight"
    tempo: str | None = None
    heavy: bool = False                          # meaningful external load: not for athletes under 14
    reps: str | None = None                      # dose for holds/skills when the system gives sets only


@dataclass(frozen=True)
class Family:
    key: str
    label: str                                   # the movement as the system names it
    bucket: str                                  # main bucket it trains (see strength_system.BUCKETS)
    category: str                                # power | strength | robustness | core (for phase/readiness dosing)
    benefit: str                                 # transfer to swimming
    variants: tuple[Variant, ...]                # regression → progression; later = closer to the target
    gate: str = ""                               # quality rule from the system, shown with the exercise


def _v(name: str, level: int, steps: list[str], **kwargs) -> Variant:
    needs = kwargs.pop("needs", ())
    return Variant(name=name, level=level, steps=tuple(steps), needs=frozenset(needs), **kwargs)


_PULL_STEPS = {
    "band": ["Anchor a band high; half-kneel facing it, arms long overhead.",
             "Depress the shoulder blades first, then drive the elbows down to the ribs.",
             "Pause with the chest tall, then return slowly to a full overhead reach."],
    "row": ["Lie under a sturdy table edge, low bar or rings; grip shoulder-width, body straight from heels to head.",
            "Squeeze glutes and ribs down, then pull the chest to the bar by driving the elbows back.",
            "Lower under control to straight arms without letting the hips sag."],
}


def _vertical_pull(key: str, label: str, grip: str, bar_name: str, weighted_name: str) -> Family:
    hang = f"Hang from the bar with a {grip} grip, arms fully straight."
    return Family(
        key=key, label=label, bucket="upper_strength", category="strength",
        benefit="Vertical pulling strength through the lats, the prime movers of the catch and pull in every stroke. "
                "Relative weighted pull-up strength is a SwimGPT performance KPI.",
        variants=(
            _v("Band lat pulldown (half-kneeling)", 1, _PULL_STEPS["band"], needs={"band"}, load="Band you can control for every rep", tempo="2-1-1"),
            _v("Inverted row (sturdy table, low bar or rings)", 1, _PULL_STEPS["row"], load="Bodyweight; walk the feet forward to make it harder", tempo="2-1-1"),
            _v(bar_name, 1, [hang, "Set the shoulder blades down and back before the elbows bend.",
                             "Pull until the chin clears the bar, keeping ribs down and legs still.",
                             "Lower all the way to straight arms under control."],
               needs={"bar"}, load="Bodyweight; if you can't finish the reps, use a band or slow 3–5 s lowering reps", tempo="2-0-1"),
            _v(weighted_name, 2, [hang + " Add load with a dip belt or a dumbbell between the feet.",
                                  "Set the shoulder blades first, then pull explosively until the chin clears the bar.",
                                  "Lower to straight arms in about two seconds; no kipping."],
               needs={"bar"}, heavy=True, tempo="2-0-X",
               load="Added load leaving ~2 reps in reserve; start 2.5–5 kg and add 1–2.5 kg when every set is crisp"),
        ),
    )


FAMILIES: dict[str, Family] = {f.key: f for f in [
    # ---------------------------------------------------------- lower-body power
    Family(
        key="ncm_jump", label="Non-Countermovement Jump", bucket="lower_power", category="power",
        benefit="Explosive force from a dead stop with no countermovement dip: the same demand as leaving the blocks and pushing off the wall.",
        variants=(_v("Non-countermovement jump (paused squat jump)", 1, [
            "Stand hip-width, sink to a quarter-to-half squat and hold completely still for 2–3 seconds.",
            "Without any bounce or dip, drive up as high as possible, swinging the arms hard.",
            "Land softly, knees tracking over the toes, and fully reset before the next rep."],
            load="Bodyweight, maximum intent every rep", tempo="Hold 2–3 s, then explode"),),
    ),
    Family(
        key="broad_jump", label="Broad Jump", bucket="lower_power", category="power",
        benefit="Horizontal power, the closest dryland match to dive athleticism and the distance you travel off the block.",
        variants=(_v("Standing broad jump (stick the landing)", 1, [
            "Stand behind a line, feet hip-width, arms back.",
            "Swing the arms and jump as far forward as possible, extending hips, knees and ankles together.",
            "Stick the landing for two seconds in a balanced squat; walk back and fully reset between reps."],
            load="Bodyweight, maximum distance with a controlled landing", tempo="Explosive"),),
    ),
    Family(
        key="trap_bar_velocity", label="Trap Bar Strength-Speed", bucket="lower_power", category="power",
        benefit="Strength-speed: high force produced quickly, the bridge between maximal strength and an explosive start or turn push.",
        gate="Moderate load moved as fast as technically possible. If a rep slows down, the load is too heavy.",
        variants=(
            _v("Squat jump (bodyweight)", 1, [
                "Stand hip-width, hands behind the head or swinging.",
                "Dip to a half squat and jump as high as possible.",
                "Land softly and reset before each rep."], load="Bodyweight, maximum intent", tempo="Explosive"),
            _v("Band-resisted speed squat", 1, [
                "Stand on a long band and loop it over the shoulders or hold it at the chest.",
                "Squat under control to parallel.",
                "Drive up as fast as possible against the band, finishing tall on the toes."],
               needs={"band"}, load="Medium-heavy band; every rep fast", tempo="2-0-X"),
            _v("Dumbbell speed deadlift (dumbbells at the sides)", 1, [
                "Stand between two dumbbells, hinge and grip them with a flat back, chest proud.",
                "Push the floor away and stand up as fast as possible, finishing with a strong glute squeeze.",
                "Lower under control and reset your back position before the next rep."],
               needs={"weights"}, heavy=True, load="Moderate dumbbells you can move fast; stop if bar speed slows", tempo="Controlled down, explosive up"),
            _v("Trap-bar strength-speed deadlift", 1, [
                "Stand in the centre of the trap bar, hinge and grip the handles with a neutral spine.",
                "Brace (breathe into the belly, ribs down) and push the floor away as fast as technically possible.",
                "Finish tall without leaning back; lower under control and reset the brace every rep."],
               needs={"trap_bar"}, heavy=True, tempo="Controlled down, explosive up",
               load="Moderate load (~40–60% of your best trap-bar deadlift) moved as fast as technically possible"),
        ),
    ),
    Family(
        key="assault_bike", label="Assault Bike Max Watt", bucket="total_body", category="power",
        benefit="Whole-body power output. The goal is maximum power, not conditioning.",
        variants=(_v("Assault bike max-watt sprint", 1, [
            "Start rolling easily, then on 'go' drive arms and legs as hard as possible for 10 seconds.",
            "Stop at 10 seconds even if you feel fresh: it's a power effort, not conditioning.",
            "Recover completely (easy pedalling or walking) before the next sprint."],
            needs={"bike"}, load="All-out 10 s; very long recovery", reps="10 sec MAX"),),
    ),
    # ---------------------------------------------------------- lower-body strength
    Family(
        key="goblet_squat", label="Goblet Squat", bucket="lower_strength", category="strength",
        benefit="Fundamental squat strength with an upright torso: the base for powerful starts and wall push-offs, "
                "breaststroke kick force, and ankle dorsiflexion trained under control.",
        variants=(
            _v("Tempo bodyweight squat", 1, [
                "Feet shoulder-width, arms forward for balance.",
                "Lower for three seconds with heels flat and knees tracking over the toes.",
                "Pause for one second at the bottom, then stand up tall."], tempo="3-1-1"),
            _v("Goblet squat", 1, [
                "Hold a dumbbell or kettlebell at the chest, elbows under the weight.",
                "Brace, then sit down between the hips with heels flat and chest tall.",
                "Pause briefly at the bottom and drive up through the whole foot."],
               needs={"weights"}, tempo="3-1-1",
               load="Moderate–heavy dumbbell/kettlebell; leave ~2 reps in reserve and add load when every rep is crisp"),
        ),
    ),
    Family(
        key="pistol", label="Goblet Squat → Pistol Squat Progression", bucket="lower_strength", category="strength",
        benefit="Single-leg strength and control: each leg drives its own push-off and kick, and the progression exposes left/right asymmetries.",
        gate="Only progress toward the pistol squat once fundamental squat control is excellent.",
        variants=(
            _v("Split squat (bodyweight)", 1, [
                "Long split stance, back heel up, torso tall.",
                "Lower the back knee toward the floor while the front heel stays down.",
                "Drive up through the front foot; finish all reps, then switch legs."], tempo="3-1-1"),
            _v("Goblet split squat", 1, [
                "Hold a dumbbell or kettlebell at the chest in a long split stance.",
                "Lower under control until the back knee almost touches the floor.",
                "Drive up through the front heel; finish all reps, then switch legs."],
               needs={"weights"}, tempo="3-1-1", load="Moderate dumbbell/kettlebell; every rep balanced and controlled"),
            _v("Box pistol squat (sit to a high box)", 2, [
                "Stand on one leg in front of a box, bench or sturdy chair, other leg forward, arms reaching out.",
                "Sit back slowly to touch the box without dropping onto it.",
                "Stand back up on the one leg without a rocking momentum; lower the box as control improves."],
               tempo="3-1-1"),
            _v("Pistol squat", 3, [
                "Balance on one leg with the other leg held straight out in front, arms forward.",
                "Lower slowly to full depth, heel flat and knee tracking over the toes.",
                "Stand up without bouncing; regress to the box if the heel lifts or the knee caves."], tempo="3-0-1"),
        ),
    ),
    Family(
        key="hip_hinge", label="Hip Hinge", bucket="lower_strength", category="strength",
        benefit="Posterior-chain strength with a neutral spine: powers the dive and wall push-off and protects the lower back during dolphin kick.",
        gate="Emphasise torso pressure, a neutral spine and glute contribution.",
        variants=(
            _v("Single-leg Romanian deadlift (bodyweight)", 1, [
                "Stand on one leg, soft knee, hands at the hips.",
                "Push the hips back and tip the torso forward as the free leg extends behind, back flat.",
                "Stop when the hamstring is loaded, then drive the hips forward to stand tall."], tempo="3-0-1"),
            _v("Dumbbell/kettlebell Romanian deadlift", 1, [
                "Hold the weights in front of the thighs, feet hip-width, soft knees.",
                "Brace and push the hips back, sliding the weights down the legs with a flat back.",
                "Stop at mid-shin or when the back would round; squeeze the glutes to stand tall."],
               needs={"weights"}, tempo="3-0-1", load="Moderate–heavy; ~2 reps in reserve with a perfectly neutral spine"),
            _v("Barbell Romanian deadlift", 2, [
                "Hold the bar at the hips, hands just outside the thighs, soft knees.",
                "Brace hard and push the hips back, keeping the bar against the legs and the spine neutral.",
                "Feel the hamstrings load, then drive the hips through with the glutes to stand tall."],
               needs={"barbell"}, heavy=True, tempo="3-0-1", load="Moderate–heavy; ~2 reps in reserve, never at the cost of a neutral spine"),
        ),
    ),
    # ---------------------------------------------------------- upper-body strength / power
    _vertical_pull("chin_up", "Chin-Up", "shoulder-width underhand", "Chin-up", "Weighted chin-up"),
    _vertical_pull("pull_up", "Weighted Pull-Up", "slightly wider-than-shoulder overhand", "Pull-up", "Weighted pull-up"),
    Family(
        key="push_up", label="Push-Up", bucket="upper_strength", category="strength",
        benefit="Pushing strength with a rigid trunk: the plank-like body line you need to hold a streamline and finish each stroke without the hips sagging.",
        gate="Pelvis and neck stay neutral; no lumbar extension.",
        variants=(
            _v("Incline push-up (hands on a bench or box)", 1, [
                "Hands on a bench slightly wider than shoulders, body in one straight line.",
                "Lower the chest to the bench with elbows about 45° from the body.",
                "Press away while keeping the ribs down and glutes tight."], tempo="2-1-1"),
            _v("Push-up", 1, [
                "Hands under the shoulders, body straight from heels to head, glutes and abs braced.",
                "Lower until the chest is a fist from the floor, elbows about 45°.",
                "Press up as one unit; no sagging hips or poking chin."], tempo="2-1-1"),
        ),
    ),
    Family(
        key="push_up_progression", label="Push-Up Progression", bucket="upper_strength", category="strength",
        benefit="Progressive pushing strength with a rigid trunk, so a stronger upper body never comes at the cost of the body line.",
        gate="Pelvis and neck stay neutral; no lumbar extension.",
        variants=(
            _v("Incline push-up (hands on a bench or box)", 1, [
                "Hands on a bench slightly wider than shoulders, body in one straight line.",
                "Lower the chest to the bench with elbows about 45° from the body.",
                "Press away while keeping the ribs down and glutes tight."], tempo="2-1-1"),
            _v("Push-up", 1, [
                "Hands under the shoulders, body straight from heels to head, glutes and abs braced.",
                "Lower until the chest is a fist from the floor, elbows about 45°.",
                "Press up as one unit; no sagging hips or poking chin."], tempo="2-1-1"),
            _v("Feet-elevated push-up", 2, [
                "Feet on a bench or step, hands on the floor under the shoulders.",
                "Lower under control with the trunk rigid and elbows about 45°.",
                "Press up without letting the lower back arch."], tempo="2-1-1"),
            _v("Weighted push-up (plate on the upper back)", 2, [
                "Have a partner place a plate across the upper back (not the lower back).",
                "Lower under control with the trunk rigid and elbows about 45°.",
                "Press up without letting the lower back arch."],
               needs={"plate"}, heavy=True, tempo="2-1-1", load="Plate load leaving ~2 reps in reserve"),
        ),
    ),
    Family(
        key="powerful_push_up", label="Powerful Push-Up", bucket="upper_power", category="power",
        benefit="Upper-body rate of force development with a stiff trunk: an aggressive catch and fast arm turnover in sprints.",
        gate="Perfect trunk position. No lumbar extension.",
        variants=(
            _v("Explosive push-up (hands stay down)", 1, [
                "Set a perfect push-up plank: glutes tight, ribs down.",
                "Lower under control, then press as fast as possible to full lockout.",
                "Reset the plank before every rep; stop the set if the hips sag."], tempo="2-0-X", load="Bodyweight, maximum speed"),
            _v("Plyometric push-up (hands leave the floor)", 2, [
                "Set a perfect push-up plank: glutes tight, ribs down.",
                "Lower under control, then press so hard the hands leave the floor.",
                "Land softly with bent elbows in the same rigid plank; reset between reps."], tempo="2-0-X", load="Bodyweight, maximum speed"),
        ),
    ),
    # ---------------------------------------------------------- torso
    Family(
        key="ab_wheel", label="Standing AB-Wheel Progression", bucket="core", category="core",
        benefit="Anti-extension torso strength: stops the lower back arching in streamline and under a hard kick. The standing rollout is a long-term destination.",
        gate="Maintain complete torso control; shorten the range the moment the lower back arches.",
        variants=(
            _v("Long-lever plank", 1, [
                "Forearm plank with elbows slightly in front of the shoulders.",
                "Squeeze glutes, pull the ribs down and push the floor away.",
                "Breathe behind the brace; end the set before the hips sag."], reps="20–30 sec"),
            _v("Body saw (forearms down, feet on a towel or sliders)", 1, [
                "Forearm plank with the feet on a towel or sliders on a smooth floor.",
                "Slide the body back by reaching the elbows forward, keeping a posterior pelvic tilt.",
                "Pull back to the start using the abs, not the hips."], tempo="2-0-2"),
            _v("Kneeling ab-wheel rollout (partial range)", 1, [
                "Kneel with hands on the wheel under the shoulders, glutes squeezed, ribs down.",
                "Roll forward only as far as the lower back stays neutral.",
                "Pull back with the abs and lats, not by bending at the hips."], needs={"ab_wheel"}, tempo="2-0-2"),
            _v("Kneeling ab-wheel rollout (full range)", 2, [
                "Kneel with hands on the wheel, glutes squeezed and ribs down.",
                "Roll out until the arms are overhead and the body is nearly straight.",
                "Pull back to the knees with the trunk rigid."], needs={"ab_wheel"}, tempo="2-0-2"),
            _v("Standing ab-wheel rollout to a wall", 3, [
                "Stand facing a wall about a body length away, wheel on the floor.",
                "Roll out until the wheel touches the wall, holding a hollow, rigid torso.",
                "Pull back to standing without the hips piking first; move further from the wall as control improves."],
               needs={"ab_wheel"}, tempo="2-0-2"),
        ),
    ),
    Family(
        key="plank", label="Plank", bucket="core", category="core",
        benefit="Isometric trunk stiffness: the foundation of a stable, connected body line in the water.",
        variants=(
            _v("Front plank", 1, [
                "Forearms under the shoulders, body straight from heels to head.",
                "Squeeze glutes and quads, pull the ribs down, push the floor away.",
                "Breathe calmly behind the brace for the whole hold."]),
            _v("RKC plank (maximal full-body tension)", 2, [
                "Forearm plank with elbows slightly in front of the shoulders and fists together.",
                "Pull the elbows toward the toes and squeeze glutes, quads and abs as hard as possible.",
                "Hold maximal tension for the whole set; quality over duration."]),
        ),
    ),
    # ---------------------------------------------------------- advanced athletic targets
    Family(
        key="front_lever", label="Front Lever Progression", bucket="upper_strength", category="strength",
        benefit="Straight-arm pulling strength with total trunk control: the lat-to-core connection behind a powerful catch and a tight streamline.",
        gate="Choose the regression that allows perfect body position.",
        variants=(
            _v("Hollow body hold", 1, [
                "Lie on your back, press the lower back into the floor.",
                "Lift the shoulders and straight legs, arms reaching overhead in a streamline.",
                "Hold the banana shape; bend the knees if the lower back lifts."], reps="Hold 20–30 sec"),
            _v("Tuck front lever hold", 2, [
                "Hang from the bar, depress the shoulder blades and pull the knees to the chest.",
                "Pull the straight arms down until the back is horizontal.",
                "Hold with a flat back; lower under control."], needs={"bar"}, reps="Hold 6–10 sec"),
            _v("Advanced tuck front lever hold", 3, [
                "From a tuck front lever, open the hips so the back is flat and the knees are away from the chest.",
                "Keep the arms straight and the shoulder blades depressed.",
                "Hold with perfect body position; return to the tuck if the back rounds."], needs={"bar"}, reps="Hold 5–8 sec"),
        ),
    ),
    Family(
        key="handstand", label="Handstand Progression", bucket="shoulder_robustness", category="robustness",
        benefit="Overhead shoulder stability with a stacked body line: the shoulder-flexion strength and torso control a long streamline demands.",
        gate="Only after adequate shoulder flexion and torso control.",
        variants=(
            _v("Pike shoulder hold (hips high, ears between the arms)", 1, [
                "Start in a downward-dog with hands shoulder-width and hips high.",
                "Push the floor away so the ears sit between the arms and the shoulders open.",
                "Hold the pushed-tall position with ribs down."], reps="Hold 20–30 sec"),
            _v("Wall walk to 45–60°", 2, [
                "Start in a push-up position with the feet at the base of a wall.",
                "Walk the feet up the wall and the hands toward it until the body is at 45–60°.",
                "Hold tall through the shoulders, then walk back down under control."], reps="Hold 10–20 sec"),
            _v("Chest-to-wall handstand hold", 3, [
                "Walk up the wall until the chest faces it and the body is vertical.",
                "Push tall through the shoulders with ribs down and glutes squeezed.",
                "Hold a straight line; come down before the lower back arches."], reps="Hold 15–30 sec"),
        ),
    ),
    # ---------------------------------------------------------- shoulder robustness
    Family(
        key="scap_cuff", label="Scapular / Rotator-Cuff Strength", bucket="shoulder_robustness", category="robustness",
        benefit="Rotator-cuff and scapular strength-endurance: the protection against swimmer's shoulder over thousands of strokes a week.",
        variants=(
            _v("Prone Y-T-W raises", 1, [
                "Lie face down, forehead on a towel, arms hanging or on the floor.",
                "Lift the arms into a Y (thumbs up), then a T, then a W, leading with the shoulder blades.",
                "Lower slowly; no shrugging or lower-back arching."], tempo="2-1-2"),
            _v("Band external rotation + band pull-apart (superset)", 1, [
                "External rotation: elbow at the side on a small towel, rotate the forearm out against a light band.",
                "Pull-apart: arms straight in front, pull the band to the chest by squeezing the shoulder blades.",
                "Move slowly; stop if you feel pinching rather than muscular effort."], needs={"band"}, tempo="2-1-2", load="Light band"),
            _v("Side-lying dumbbell external rotation + prone Y raise", 2, [
                "Side-lying: elbow at 90° on a towel at the side, rotate a light dumbbell up toward the ceiling.",
                "Prone Y: face down on a bench, raise light dumbbells into a Y with thumbs up.",
                "Slow, controlled reps; never chase load on cuff work."], needs={"weights"}, tempo="2-1-2", load="Light dumbbells (1–5 kg)"),
        ),
    ),
]}


# ---------------------------------------------------------------- drills (warm-up, activation, mobility, finish)
@dataclass(frozen=True)
class Drill:
    name: str
    kind: str                     # temperature | mobilize | activate | control
    area: str | None              # mobility area served (strength_system.MOBILITY_AREAS), if any
    steps: tuple[str, ...]
    needs: frozenset[str] = field(default_factory=frozenset)


def _d(name: str, kind: str, area: str | None, steps: list[str], needs: tuple[str, ...] = ()) -> Drill:
    return Drill(name=name, kind=kind, area=area, steps=tuple(steps), needs=frozenset(needs))


DRILLS: dict[str, Drill] = {
    # temperature
    "bike_easy": _d("Easy Assault Bike", "temperature", None, ["Easy, conversational pace; arms and legs both working."], ("bike",)),
    "easy_cardio": _d("Easy cardio (skipping, jog, rower or bike)", "temperature", None, ["Easy pace that raises body temperature without fatigue."]),
    # T-spine
    "t_spine_rotation": _d("T-spine rotations", "mobilize", "t_spine_rotation", [
        "On hands and knees, sit the hips back toward the heels to lock the lower back.",
        "Hand behind the head, rotate the elbow down under the body, then up to the ceiling following it with the eyes.",
        "Move from the upper back only; the hips stay still."]),
    "t_spine_rotation_control": _d("Active T-spine rotation control (half-kneeling)", "control", "t_spine_rotation", [
        "Half-kneel side-on to a wall, arms straight in front together.",
        "Rotate the top arm open as far as you can control without the hips turning.",
        "Hold the end range for two seconds, then return slowly."]),
    "t_spine_extension": _d("T-spine extensions", "mobilize", "t_spine_extension", [
        "Kneel facing a bench with elbows on it and a dowel or towel in the hands.",
        "Sink the chest toward the floor, extending through the upper back, not the lower back.",
        "Keep the ribs down; exhale into each rep. (A foam roller across the upper back works too.)"]),
    "t_spine_extension_control": _d("Prone thoracic extension lift-offs (arms in a Y)", "control", "t_spine_extension", [
        "Lie face down with the arms in a Y, thumbs up.",
        "Lift the chest and arms slightly using the upper back, keeping the lower back relaxed.",
        "Hold two seconds at the top, lower slowly."]),
    # shoulders
    "shoulder_flexion_mob": _d("Shoulder-flexion mobilizations", "mobilize", "shoulder_flexion", [
        "Kneel facing a bench, elbows on it shoulder-width, hands together.",
        "Sit the hips back and let the chest sink to open the overhead position.",
        "Breathe out at end range; keep the ribs from flaring."]),
    "shoulder_flexion_control": _d("Shoulder-flexion end-range reaches", "control", "shoulder_flexion", [
        "Stand facing a wall, arms overhead in a narrow streamline, thumbs up.",
        "Lift the hands off the wall at the top of the range without arching the lower back.",
        "Hold one to two seconds, lower, repeat."]),
    "er_mob": _d("External-rotation mobility", "mobilize", "shoulder_external_rotation", [
        "Lie on your back, upper arm out at 90° and elbow bent at 90°.",
        "Let the forearm rotate back toward the floor, using a dowel for a gentle assist.",
        "Stay in a comfortable range: mobilize carefully, never force it."]),
    "er_activation": _d("External-rotation activations (band)", "activate", "shoulder_external_rotation", [
        "Elbow at the side on a small towel, light band in the hand.",
        "Rotate the forearm outward without the elbow leaving the side.",
        "Slow return; no shrugging."], ("band",)),
    "controlled_ir": _d("Controlled internal rotation (side-lying, active)", "control", "shoulder_internal_rotation", [
        "Lie on your back, upper arm out at 90° and elbow bent at 90°.",
        "Actively rotate the forearm forward toward the floor without the shoulder lifting.",
        "Hold the end range briefly. No aggressive sleeper-stretch pressure."]),
    "lat_mob": _d("Lat mobility", "mobilize", "shoulder_flexion", [
        "Kneel side-on to a bench, one forearm on it, and sit the hips back and away.",
        "Feel the stretch along the side of the trunk and armpit.",
        "Breathe slowly into the ribs on that side."]),
    "pec_mob": _d("Pec mobility", "mobilize", "shoulder_flexion", [
        "Forearm on a doorframe, elbow at shoulder height.",
        "Step through gently until the chest opens.",
        "Keep the shoulder blade back and the ribs down; no pain at the front of the shoulder."]),
    "scap_row": _d("Scapular control rows (band)", "activate", "shoulder_external_rotation", [
        "Hold a band anchored at chest height, arms straight.",
        "Draw the shoulder blades back and down first, then row the elbows to the ribs.",
        "Return slowly, letting the shoulder blades glide forward."], ("band",)),
    # hips
    "hip_flexor_mob": _d("Hip-flexor mobilizations", "mobilize", "hip_flexor_quad", [
        "Half-kneel with the back knee on a pad.",
        "Tuck the pelvis under (squeeze the back glute), then shift forward gently.",
        "Reach the same-side arm overhead to deepen the stretch."]),
    "quad_mob": _d("Quad mobility (couch stretch)", "mobilize", "hip_flexor_quad", [
        "Back knee on a pad against a wall or bench, shin up the wall.",
        "Front foot forward, tuck the pelvis under and lift the chest tall.",
        "Stay where the front of the thigh stretches without arching the back."]),
    "hip_flexor_liftoff": _d("Hip-flexor liftoffs", "control", "hamstring", [
        "Sit tall with both legs straight, hands on the floor beside the knee.",
        "Lift one straight leg a few centimetres off the floor using the hip flexors.",
        "Hold one to two seconds and lower slowly: active end-range strength."]),
    "glute_bridge": _d("Controlled glute bridges", "activate", "hip_flexor_quad", [
        "Lie on your back, knees bent, feet flat.",
        "Tuck the pelvis slightly and drive the hips up with the glutes, not the lower back.",
        "Pause at the top, lower one vertebra at a time."]),
    "glute_activation": _d("Glute activation", "activate", None, [
        "Mini-band above the knees: side-lying clamshells or lateral band walks.",
        "Keep the pelvis still and feel the side of the hip working."], ("band",)),
    "hip_ir_er": _d("Hip IR/ER (90/90 switches)", "mobilize", "hip_rotation", [
        "Sit in a 90/90: front and back legs both bent at 90°.",
        "Keeping the chest tall, rotate both knees to the other side.",
        "Move slowly; use the hands for support at first."]),
    "hip_ir": _d("Hip internal rotation (90/90)", "mobilize", "hip_rotation", [
        "Sit in a 90/90 and turn toward the back leg.",
        "Lean gently into the back hip's internal rotation.",
        "Breathe out at end range."]),
    "hip_er": _d("Hip external rotation (90/90)", "mobilize", "hip_rotation", [
        "Sit in a 90/90 and turn toward the front leg with a tall chest.",
        "Hinge forward over the front shin until the outer hip stretches.",
        "Keep the spine long."]),
    "hip_rotation_control": _d("90/90 hip lift-offs", "control", "hip_rotation", [
        "Sit in a 90/90 with a tall chest.",
        "Lift the back knee and foot off the floor using the hip, without leaning away.",
        "Hold one to two seconds, lower slowly."]),
    "hamstring_mob": _d("Hamstring mobilizations", "mobilize", "hamstring", [
        "Lie on your back with a band or towel around one foot.",
        "Raise the straight leg until the hamstring loads, then bend and straighten the knee slowly.",
        "Keep the other leg flat on the floor."]),
    # ankles
    "ankle_df_mob": _d("Ankle dorsiflexion mobilizations (knee-to-wall)", "mobilize", "ankle_dorsiflexion", [
        "Half-kneel facing a wall, front foot a hand-length away.",
        "Drive the knee toward the wall over the middle toes, heel down.",
        "Move back and forth rhythmically; inch the foot back as range improves."]),
    "ankle_mob": _d("Ankle mobilizations", "mobilize", "ankle_dorsiflexion", [
        "Knee-to-wall rocks for dorsiflexion, then slow ankle circles in both directions.",
        "Heel down on the rocks; move through the full circle without pain."]),
    "squat_hold": _d("Controlled heels-down squat hold", "control", "ankle_dorsiflexion", [
        "Squat to full depth with heels flat, holding a support if needed.",
        "Push the knees forward over the toes and sit tall.",
        "Breathe for the hold; it trains control of the new ankle range."]),
    "plantar_mob": _d("Plantar-flexion mobility (kneeling ankle stretch)", "mobilize", "ankle_plantar_flexion", [
        "Kneel with the tops of the feet flat on a mat, toes pointed back.",
        "Sit the hips back toward the heels until the front of the ankles stretch.",
        "Lift the knees slightly to deepen it if comfortable."]),
    "plantar_active": _d("Active plantar flexion", "control", "ankle_plantar_flexion", [
        "Sit with the legs straight and point the toes as far as possible.",
        "From the end range, actively curl and point further for one to two seconds.",
        "Relax and repeat: active control of the kicking range."]),
    # trunk
    "plank_hold": _d("Plank", "activate", None, ["Forearm plank, glutes squeezed, ribs down, steady breathing."]),
}
