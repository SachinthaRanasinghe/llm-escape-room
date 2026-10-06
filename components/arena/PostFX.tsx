'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * The camera's lens: a light bloom on the brightest accents only (the cores,
 * the robots' eyes), then a soft vignette, then tone mapping (`OutputPass`
 * applies the renderer's curve).
 *
 * Uses three's own post-processing passes, so no extra dependency. It takes
 * over rendering with a frame priority of 1; it is only mounted on the high
 * quality tier.
 */

/**
 * Clamps the HDR frame before bloom and zeroes any NaN or infinite pixel: a
 * single bad sample (a degenerate normal on a glossy surface) would otherwise
 * be smeared across the whole screen by the blur.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bool bad = !(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b) || c.r > 1e4 || c.g > 1e4 || c.b > 1e4;
      gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(clamp(c.rgb, 0.0, 24.0), c.a);
    }
  `,
};

const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0.18 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec2 centred = vUv - 0.5;
      vec4 colour = texture2D(tDiffuse, vUv);
      float vignette = smoothstep(0.85, 0.2, length(centred * vec2(1.0, 1.15)));
      colour.rgb *= mix(1.0 - strength, 1.0, vignette);
      gl_FragColor = colour;
    }
  `,
};

export function PostFX() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const { composer, lens, bloom } = useMemo(() => {
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new ShaderPass(SanitizeShader));
    const bloom = new UnrealBloomPass(new Vector2(256, 256), 0.35, 0.25, 2.2);
    composer.addPass(bloom);
    const lens = new ShaderPass(LensShader);
    composer.addPass(lens);
    composer.addPass(new OutputPass());
    return { composer, lens, bloom };
  }, [gl, scene, camera]);

  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
    bloom.resolution.set(size.width, size.height);
  }, [composer, bloom, gl, size]);

  useEffect(() => () => composer.dispose(), [composer]);

  useFrame((_, delta) => {
    composer.render(delta);
  }, 1);

  return null;
}
