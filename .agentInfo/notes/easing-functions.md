<<<<<<< tmp_merge/ours_.agentInfo_notes_easing-functions.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_easing-functions.md
=======
<<<<<<< tmp_merge/ours_.agentInfo_notes_easing-functions.md
=======
# Easing functions

tags: easing, animation

This note summarizes commonly used easing equations for smooth animations:

- **Linear**: `f(t) = t` – constant speed; transitions progress uniformly.
- **Quadratic**: `f(t) = t^2` (ease-in) or `f(t) = 1 - (1 - t)^2` (ease-out). Works well for simple acceleration or deceleration.
- **Cubic**: `f(t) = t^3` (ease-in) or `f(t) = 1 - (1 - t)^3` (ease-out). Provides a steeper curve than quadratic.
- **Quartic**: `f(t) = t^4` / `1 - (1 - t)^4`. Smooth start or end with stronger acceleration.
- **Quintic**: `f(t) = t^5` / `1 - (1 - t)^5`. Even more pronounced easing for dramatic effects.
- **Sine**: `f(t) = 1 - cos(t * \pi/2)` – gentle start and stop similar to natural motion.
- **Exponential**: `f(t) = 2^{10(t - 1)}` (ease-in) or `1 - 2^{-10 t}` (ease-out). Good for elements that quickly accelerate or decelerate.
- **Circular**: `f(t) = 1 - \sqrt{1 - t^2}` – mimics the motion of a circle section for soft transitions.
- **Back**: `f(t) = t^3 - t * sin(t * \pi)` – starts by moving backward before accelerating forward; useful for anticipation.
- **Elastic**: `f(t) = 2^{-10 t} * sin((t - 0.075) * (2\pi) / 0.3) + 1` – overshoots and oscillates before settling.
- **Bounce**: piecewise quadratic approximations that simulate a bouncing effect when an object falls and rebounds.

Use these easing functions in CSS transitions, JavaScript animations or game tweens to give motion more personality. Choose stronger curves for dynamic effects and gentler ones for subtle moves.
>>>>>>> tmp_merge/theirs_.agentInfo_notes_easing-functions.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_easing-functions.md
>>>>>>> tmp_merge/theirs_.agentInfo_notes_easing-functions.md
