"use client";

import { useEffect, useRef } from "react";
import styles from "./LaunchpadRocket.module.css";

const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

// Match sample A's pixel treatment. Luminance carries the original surface
// shading, grain, and highlights; the chroma gate leaves space untouched.
const fragmentShaderSource = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_video;

  void main() {
    vec3 source = texture2D(u_video, v_uv).rgb;
    float high = max(max(source.r, source.g), source.b);
    float low = min(min(source.r, source.g), source.b);
    float delta = high - low;
    float hue = 0.0;
    if (delta > 0.0001) {
      if (high == source.r) hue = mod((source.g - source.b) / delta, 6.0);
      else if (high == source.g) hue = (source.b - source.r) / delta + 2.0;
      else hue = (source.r - source.g) / delta + 4.0;
      hue = mod(hue * 60.0 + 360.0, 360.0);
    }
    float saturation = delta / max(high, 0.001);
    float mask = smoothstep(27.0, 37.0, hue)
      * (1.0 - smoothstep(67.0, 77.0, hue))
      * smoothstep(0.12, 0.4, saturation)
      * smoothstep(120.0 / 255.0, 170.0 / 255.0, source.r);
    float luminance = dot(source, vec3(0.2126, 0.7152, 0.0722));
    float light = clamp(luminance / (210.0 / 255.0), 0.42, 1.16);
    vec3 ivory = min(vec3(1.0), vec3(249.0, 235.0, 211.0) / 255.0
      * pow(vec3(light), vec3(0.8, 1.0, 1.15)));
    gl_FragColor = vec4(mix(source, ivory, mask), 1.0);
  }
`;

function startIvoryRender(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
  if (!gl) return () => {};

  const shader = (type: number, source: string) => {
    const compiled = gl.createShader(type);
    if (!compiled) return null;
    gl.shaderSource(compiled, source);
    gl.compileShader(compiled);
    if (gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) return compiled;
    gl.deleteShader(compiled);
    return null;
  };
  const vertex = shader(gl.VERTEX_SHADER, vertexShaderSource);
  const fragment = shader(gl.FRAGMENT_SHADER, fragmentShaderSource);
  if (!vertex || !fragment) return () => {};

  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!program || !buffer || !texture) return () => {};
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return () => {};
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 0, 1, -1, 1, 0,
    -1, 1, 0, 1, 1, 1, 1, 1,
  ]), gl.STATIC_DRAW);
  for (const [name, offset] of [["a_position", 0], ["a_uv", 8]] as const) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset);
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.uniform1i(gl.getUniformLocation(program, "u_video"), 0);

  let frame = 0;
  let lastTime = -1;
  let allocated = false;
  const draw = () => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastTime) {
      if (!allocated) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        allocated = true;
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      canvas.dataset.ready = "true";
      lastTime = video.currentTime;
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frame);
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  };
}

/** Exact Narrativ case-study sequence from hirael.com/embed/templates/agency-landing. */
export default function LaunchpadRocket() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const stopRendering = startIvoryRender(canvas, video);
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPlayback = () => {
      if (motionPreference.matches) {
        video.pause();
        video.currentTime = 0;
      } else {
        void video.play().catch(() => {});
      }
    };

    syncPlayback();
    motionPreference.addEventListener("change", syncPlayback);
    return () => {
      stopRendering();
      motionPreference.removeEventListener("change", syncPlayback);
    };
  }, []);

  return (
    <div
      className={styles.scene}
      role="img"
      aria-label="A yellow 3D rocket turns gently in space between a ringed blue planet and a cratered moon"
    >
      <video
        ref={videoRef}
        className={styles.video}
        src="/tech/launchpad-reference.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      />
      <canvas ref={canvasRef} className={`${styles.video} ${styles.colorCanvas}`} aria-hidden="true" />
    </div>
  );
}
