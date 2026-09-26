/**
 * GLSL for the landing canvas, kept as template strings rather than `.glsl`
 * files on purpose: `next.config.ts` has no `webpack()` override, and the app
 * builds with Turbopack in dev and webpack in production. A loader would have
 * to be configured for both. Strings need neither.
 *
 * Written against three's default GLSL1 shader prefix, which already declares
 * `position`, `modelViewMatrix` and `projectionMatrix`.
 */

export const PARTICLE_VERTEX_SHADER = /* glsl */ `
attribute float aStream;
attribute float aSeed;
attribute float aAlong;

uniform float uTime;
uniform float uProgress;
uniform float uSize;
uniform float uPixelRatio;
uniform vec2 uPointer;

varying vec3 vColor;
varying float vFade;

// Ink colours, drawn dark onto the cream page with normal blending.
const vec3 BLUE = vec3(0.106, 0.388, 0.702);  // #1b63b3
const vec3 TEAL = vec3(0.165, 0.427, 0.384);  // #2a6d62
const vec3 CLAY = vec3(0.620, 0.290, 0.165);  // #9e4a2a
const vec3 NAVY = vec3(0.055, 0.184, 0.494);  // #0e2f7e

void main() {
  float t = uTime;
  float prog = uProgress;

  float along = fract(aAlong + t * 0.045 + aSeed * 0.15);
  float lane = aStream - 1.0;

  // The three streams fan out from a single origin, then collapse back onto
  // one line as the reader scrolls: parallel isolated work, converging.
  float converge = 1.0 - smoothstep(0.55, 0.98, prog);
  float spread = 0.62 * along * max(converge, 0.14);

  // Mid scroll the outer lanes pull toward each other and brighten. That is
  // the coordination beat: two agents hit the same file and sort it out.
  float collide =
    smoothstep(0.34, 0.54, prog) * (1.0 - smoothstep(0.54, 0.74, prog));
  float pull = abs(lane) * collide * 0.34;

  float x = mix(-1.75, 1.75, along);
  float y = lane * spread - sign(lane) * pull;
  y += 0.075 * sin(along * 7.0 + t * 0.7 + aSeed * 6.2831);
  y += (aSeed - 0.5) * 0.09;

  float z = (aSeed - 0.5) * 0.66 + 0.06 * cos(along * 5.0 + t * 0.5);

  vec3 pos = vec3(x, y, z);
  pos.x += uPointer.x * 0.10 * (0.4 + aSeed);
  pos.y += uPointer.y * -0.08 * (0.4 + aSeed);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float ends =
    smoothstep(0.0, 0.14, along) * (1.0 - smoothstep(0.86, 1.0, along));
  vFade = ends * (0.10 + 0.20 * aSeed);
  vFade *= 0.70 + 0.30 * collide;

  vec3 base = aStream < 0.5 ? BLUE : (aStream < 1.5 ? TEAL : CLAY);
  // Everything resolves to the brand blue as the branches merge into main.
  vColor = mix(base, BLUE, smoothstep(0.7, 1.0, prog));
  // On paper the coordination beat reads as ink getting denser, not brighter.
  vColor = mix(vColor, NAVY, collide * 0.55);

  gl_PointSize = uSize * uPixelRatio * (0.5 + aSeed) * (1.6 / -mv.z);
}
`;

export const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
varying vec3 vColor;
varying float vFade;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = dot(uv, uv);
  if (d > 0.25) discard;
  float alpha = smoothstep(0.25, 0.0, d);
  gl_FragColor = vec4(vColor, alpha * vFade);
}
`;
