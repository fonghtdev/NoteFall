export interface GlassNote {
  x: number; y: number; w: number; h: number // CSS px, top-left origin
  color: [number, number, number]            // 0..255
  hot: number                                // 0..1: how lit it is (strike flash, then a steady glow while it sounds)
}

const VERT = `#version 300 es
in vec2 a_pos;
uniform vec4 u_quad; // x, y, w, h in device px (top-left origin)
uniform vec2 u_res;
void main() {
  vec2 px = u_quad.xy + a_pos * u_quad.zw;
  gl_Position = vec4(px.x / u_res.x * 2. - 1., 1. - px.y / u_res.y * 2., 0., 1.);
}`

const BACKDROP = `#version 300 es
precision highp float;
uniform sampler2D u_bg; uniform vec2 u_res;
out vec4 o;
void main() { o = vec4(texture(u_bg, vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_res).rgb, 1.); }`

// Liquid glass, the restrained way: the note is almost clear. Only a narrow band along the edge bends the backdrop (a lens
// that lives at the rim), the whole thing is frosted a touch, and the edge is drawn by light, not by paint: a hairline that
// is brightest where the key light hits (top left) and fades round the shape, a soft inner glow in the hand's colour, and on
// the far side a little of that colour gathering where the light leaves the glass. A soft shadow sits underneath.
const GLASS = `#version 300 es
precision highp float;
uniform sampler2D u_bg; uniform vec2 u_res;
uniform vec2 u_center, u_half; uniform float u_radius;
uniform vec3 u_color; uniform float u_hot, u_dpr;
out vec4 o;

float sd(vec2 p) {
  vec2 q = abs(p) - u_half + u_radius;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - u_radius;
}
vec3 bg(vec2 px) { return texture(u_bg, clamp(px / u_res, 0., 1.)).rgb; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  float u = u_dpr;
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 p = px - u_center;
  float d = sd(p);

  float amb0 = 0.04 + 0.2 * u_hot;                          // faint spill of the glass's colour
  if (d > 0.) {
    float amb = amb0 * exp(-d / (16. * u));
    float shade = 0.36 * exp(-max(sd(p - vec2(0., 7.) * u), 0.) / (13. * u)); // soft shadow underneath
    o = vec4(u_color * amb, amb + shade * (1. - amb));
    return;
  }

  float B = min(13. * u, min(u_half.x, u_half.y));          // width of the lens band at the rim
  float t = clamp(-d / B, 0., 1.);
  vec2 g = vec2(sd(p + vec2(1., 0.)) - sd(p - vec2(1., 0.)), sd(p + vec2(0., 1.)) - sd(p - vec2(0., 1.)));
  vec2 n2 = normalize(g + 1e-5);                            // pointing out of the shape

  // --- the backdrop seen through the glass: bent only near the rim, a hint of colour fringing, lightly frosted
  float lens = pow(1. - t, 2.2);
  vec2 bend = n2 * B * 1.25 * lens;
  float r = 3. * u;
  vec3 base = vec3(0.);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 2.39996;
    vec2 j = vec2(cos(a), sin(a)) * sqrt((float(i) + 0.5) / 8.) * r;
    base += vec3(bg(px + bend * 1.045 + j).r, bg(px + bend + j).g, bg(px + bend * 0.955 + j).b);
  }
  base /= 8.;
  float luma = dot(base, vec3(0.299, 0.587, 0.114));
  base = mix(vec3(luma), base, 1.1) * 1.05 + 0.012;         // glass lifts and enriches what is behind it

  float vy = (p.y + u_half.y) / (2. * u_half.y);
  float cx = p.x / u_half.x;                                // -1 left edge .. 1 right edge
  vec3 col = base * (1.06 - 0.16 * smoothstep(0., 1., t) * (1. - vy)) + u_color * (0.06 + 0.05 * vy);  // clear body, slightly deeper toward the middle

  // --- depth: the glass is thick, so it reads as a rounded bar, not a flat pane
  float ax = abs(cx);
  col *= 1. - 0.22 * pow(ax, 2.2);                          // edges fall off into shade (thickness)
  col += u_color * 0.10 * exp(-pow((cx - 0.12) / 0.38, 2.)); // a core of coloured light running down the middle
  col += vec3(1.) * 0.05 * exp(-pow((cx + 0.35) / 0.22, 2.)); // broad soft sheen, off-centre
  float inner = exp(-(-d) / (7. * u)) * smoothstep(-0.2, 1., cx);
  col *= 1. - 0.18 * inner;                                 // inner shadow on the side away from the light
  float ph = sin(p.y / (38. * u) + 1.3) * 0.5 + 0.5;       // slow ripple of light along long notes
  col += vec3(1.) * 0.035 * ph * (1. - ax) * smoothstep(0.1, 0.5, u_half.y / u_half.x * 0.2);

  // --- the edge, drawn by light
  float line = exp(-(-d) / (0.8 * u));                      // hairline right at the edge
  float band = exp(-(-d) / (4. * u));                       // soft band just inside it
  float key = pow(max(dot(n2, normalize(vec2(-0.55, -0.83))), 0.), 1.6);   // 1 where the key light hits (top left)
  col += vec3(1.) * (line * (0.14 + 0.78 * key) + band * 0.08 * key);
  col += u_color * band * 0.10;                             // the rim carries a trace of the glass's colour all round

  // light that passes through the glass gathers along the bottom: a soft caustic, no hard shape
  float cau = exp(-(u_half.y - p.y) / (12. * u)) * (1. - pow(abs(cx), 3.));
  col += (u_color * 0.5 + 0.1) * cau * 0.5;

  // a long, thin window reflection down the left side, fading out at both ends
  float sx = exp(-pow((p.x + u_half.x - 5. * u) / (1.3 * u), 2.));
  float sy = smoothstep(0.0, 0.18, vy) * (1. - smoothstep(0.55, 0.95, vy));
  float sx2 = exp(-pow((p.x - u_half.x + 4. * u) / (1. * u), 2.));
  col += vec3(1.) * sx2 * sy * 0.10 * step(u_half.x * 2., u_half.y * 2. * 1.4);
  col += vec3(1.) * sx * sy * 0.30 * step(u_half.x * 2., u_half.y * 2. * 1.4);

  col += u_color * u_hot * (0.18 + 0.22 * (1. - t)) + vec3(1.) * u_hot * line * 0.22;   // lit from inside while it sounds

  col += (hash(gl_FragCoord.xy) - 0.5) / 255.;              // dither: no banding in the gradients
  float a = clamp(-d / u + 0.5, 0., 1.);                    // 1px anti-aliased edge
  o = vec4(col, 1.) * a + vec4(u_color * amb0, amb0) * (1. - a);
}`

function compile(gl: WebGL2RenderingContext, frag: string): WebGLProgram {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
    return s
  }
  const p = gl.createProgram()!
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error')
  return p
}

/** WebGL2 layer: draws a backdrop canvas, then every note as a glass lens over it. Throws if WebGL2 is missing. */
export class GlassRenderer {
  private gl: WebGL2RenderingContext
  private backdrop: WebGLProgram
  private glass: WebGLProgram
  private tex: WebGLTexture

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl
    this.backdrop = compile(gl, BACKDROP)
    this.glass = compile(gl, GLASS)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    for (const p of [this.backdrop, this.glass]) {
      const loc = gl.getAttribLocation(p, 'a_pos')
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    }
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // premultiplied alpha
  }

  render(backdrop: HTMLCanvasElement, notes: GlassNote[], dpr: number) {
    const { gl, canvas } = this
    const W = canvas.width, H = canvas.height
    gl.viewport(0, 0, W, H)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, backdrop)

    const use = (p: WebGLProgram) => {
      gl.useProgram(p)
      gl.uniform2f(gl.getUniformLocation(p, 'u_res'), W, H)
    }
    const u = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n)

    use(this.backdrop)
    gl.uniform4f(u(this.backdrop, 'u_quad'), 0, 0, W, H)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // ponytail: one draw call per note (tens per frame); instance them if a dense score ever gets slow
    const p = this.glass
    use(p)
    gl.uniform1f(u(p, 'u_dpr'), dpr)
    const margin = 36 * dpr // room for the outer glow
    for (const n of notes) {
      const x = n.x * dpr, y = n.y * dpr, w = n.w * dpr, h = n.h * dpr
      gl.uniform4f(u(p, 'u_quad'), x - margin, y - margin, w + 2 * margin, h + 2 * margin)
      gl.uniform2f(u(p, 'u_center'), x + w / 2, y + h / 2)
      gl.uniform2f(u(p, 'u_half'), w / 2, h / 2)
      gl.uniform1f(u(p, 'u_radius'), Math.min(10 * dpr, w / 2 - 0.5, h / 2 - 0.5)) // a measured corner, like a glass key, not a pill
      gl.uniform3f(u(p, 'u_color'), n.color[0] / 255, n.color[1] / 255, n.color[2] / 255)
      gl.uniform1f(u(p, 'u_hot'), n.hot)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
  }
}
