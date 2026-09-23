import {
  BufferAttribute,
  BufferGeometry,
  PerspectiveCamera,
  Points,
  Scene,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";

import { PARTICLE_FRAGMENT_SHADER, PARTICLE_VERTEX_SHADER } from "./shaders";

export interface LandingSceneOptions {
  canvas: HTMLCanvasElement;
  particleCount: number;
  pixelRatio: number;
}

export interface LandingScene {
  resize(width: number, height: number, pixelRatio: number): void;
  render(
    elapsedSeconds: number,
    progress: number,
    pointerX: number,
    pointerY: number,
  ): void;
  dispose(): void;
}

/**
 * Builds the landing backdrop: three streams of particles that fan out from a
 * single origin, pull together at the coordination beat, and collapse onto one
 * line as the reader reaches the merge section.
 *
 * Pure three.js with no React, so the geometry maths can be exercised without
 * a renderer. Returns `null` instead of throwing when a context cannot be
 * acquired, because the caller must degrade to the static still silently.
 */
export function createLandingScene(
  options: LandingSceneOptions,
): LandingScene | null {
  const { canvas, particleCount, pixelRatio } = options;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
  } catch {
    return null;
  }

  // three logs shader compile failures straight to the console. The landing
  // e2e suite fails on any console error, so keep the check in development
  // where it is useful and silence it in the build that CI drives.
  renderer.debug.checkShaderErrors = process.env.NODE_ENV !== "production";
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 2.6);

  // The shader derives every position from the attributes below, but three
  // still needs a `position` attribute to know the draw count.
  const positions = new Float32Array(particleCount * 3);
  const streams = new Float32Array(particleCount);
  const seeds = new Float32Array(particleCount);
  const alongs = new Float32Array(particleCount);

  for (let i = 0; i < particleCount; i += 1) {
    streams[i] = i % 3;
    seeds[i] = Math.random();
    alongs[i] = Math.random();
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aStream", new BufferAttribute(streams, 1));
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  geometry.setAttribute("aAlong", new BufferAttribute(alongs, 1));

  // Held as a local so the uniforms can be written without indexing through
  // three's `{ [key: string]: IUniform }` signature, which `noUncheckedIndexedAccess`
  // widens to `| undefined`.
  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uSize: { value: 13 },
    uPixelRatio: { value: pixelRatio },
    uPointer: { value: new Vector2(0, 0) },
  };

  const material = new ShaderMaterial({
    vertexShader: PARTICLE_VERTEX_SHADER,
    fragmentShader: PARTICLE_FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    // Additive blending only works against a dark page. On cream paper it
    // washes every particle out to white, so the field is composited normally
    // and the particles carry dark ink colours instead.
    blending: NormalBlending,
  });

  const points = new Points(geometry, material);
  // Every position comes from the shader, so the CPU-side bounding sphere sits
  // at the origin and would cull the whole field.
  points.frustumCulled = false;
  scene.add(points);

  return {
    resize(width, height, nextPixelRatio) {
      renderer.setPixelRatio(nextPixelRatio);
      renderer.setSize(width, height, false);
      uniforms.uPixelRatio.value = nextPixelRatio;
      camera.aspect = height === 0 ? 1 : width / height;
      camera.updateProjectionMatrix();
    },

    render(elapsedSeconds, progress, pointerX, pointerY) {
      uniforms.uTime.value = elapsedSeconds;
      uniforms.uProgress.value = progress;
      uniforms.uPointer.value.set(pointerX, pointerY);
      renderer.render(scene, camera);
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
