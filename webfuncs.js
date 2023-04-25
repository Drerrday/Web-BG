/*********
 * made by Matthias Hurrle (@atzedent)
 */

/** @type {HTMLCanvasElement} */
const canvas = window.canvas
const gl = canvas.getContext("webgl2")
const dpr = Math.max(1, window.devicePixelRatio)
/** @type {Map<string,PointerEvent>} */
const touches = new Map()

const vertexSource = `#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec2 position;

void main(void) {
    gl_Position = vec4(position, 0., 1.);
}
`
const fragmentSource = `#version 300 es
/*********
* made by Matthias Hurrle (@atzedent)
*/

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

out vec4 fragColor;

uniform vec2 resolution;
uniform float time;
uniform vec2 touch;
uniform int pointerCount;

const float TAU = radians(360.);

#define PI .5 * TAU
#define T time
#define S smoothstep

#define SURF_DIST .01
#define MAX_DIST 20.
#define MAX_STEPS 50

#define hue(v) ( .6 + .6 * cos( 6.3*(v) + vec4(0,23,21,0) ) )

struct Material {
	float dist;
	int idx;
};

Material MatMin(Material a, Material b) {
  if (a.dist < b.dist) return a;

  return b;
}

mat2 Rot(float alpha) {
	float s = sin(alpha),
	c = cos(alpha);

	return mat2(c, -s, s, c);
}

float Sphere(vec3 p, vec3 c, float s) {
	return length(p-c)-s;
}

Material GetDist(vec3 p) {
	vec3 pos = vec3(0, 2, -1);

	return MatMin(
		Material(
			Sphere(p, vec3(0), 1.5),
			1
		),
		Material(
			p.y + 1.64,
			0
		)
	);
}

vec3 GetRayDir(vec2 uv, vec3 p, vec3 l, float z) {
	vec3
	f = normalize(l-p),
	r = normalize(cross(vec3(.0, 1., .0), f)),
	u = cross(f, r),
	c = f*z,
	i = c + uv.x*r + uv.y*u,
	d = normalize(i);

	return d;
}

vec3 GetNormal(vec3 p) {
	vec2 e = vec2(.001, .0);
	Material d = GetDist(p);
	vec3 n = d.dist - vec3(
		GetDist(p-e.xyy).dist,
		GetDist(p-e.yxy).dist,
		GetDist(p-e.yyx).dist
	);

	return normalize(n);
}

Material RayMarch(vec3 ro, vec3 rd) {
	float d = .0;
	Material mat;

	for (int i = 0; i < MAX_STEPS; i++) {
		vec3 p = ro + rd * d;
		mat = GetDist(p);
		d += mat.dist;

		if (d > MAX_DIST || abs(d) < SURF_DIST) break;
	}

	return Material(d, mat.idx);
}

vec3 Render(inout vec3 ro, inout vec3 rd, inout float ref) {
	Material d = RayMarch(ro, rd);
	vec3 col = vec3(0);

	if (d.dist > MAX_DIST) return col;

	vec3 p = ro + rd * d.dist;
	vec3 lightPos = ro;

	vec3 l = normalize(lightPos);
	vec3 n = GetNormal(p);
	vec3 r = reflect(rd, n);
	vec3 rn = normalize(r);

	float fres = clamp(1.+dot(r, n), .0, 1.);
	float diffuse = smoothstep(.05, .95, dot(l, n) * .5 + .5);
	float spot = clamp(dot(rn, reflect(n, vec3(0))), .0, 1.);

	col += .25 * vec3(1.,.9,.95) * pow(diffuse, 8.);
	col += .5 * pow(spot, 16.);

	vec3 mat = vec3(1);
	vec3 tint = hue(T*.1).rgb * 10.;

	float t = 2.*T;
	float mx = max(resolution.x, resolution.y);

	// floor
	if (d.idx == 0) {

		float sdf = S(
			.0,
			2./mx,
			sin(t - 4.*length(p.xz*.5)) +
			cos(t - 4.*length(p.xy*.5))
		);
		mat = tint*sdf;
		ref = mix(.05, .125, fres);

	}
	// solid
	else if (d.idx == 1) {

		float sdf = S(
			.0,
			2./mx,
			sin(t + 12.*length(p.y + 1.7))
		);
		mat = tint*sdf;
		ref = mix(.005, .125, fres);

	}

	ro = p + n * SURF_DIST * 3.;
	rd = r;

	return col * mat;
}

void main(void) {
	vec2 uv = (
		gl_FragCoord.xy - .5 * resolution.xy
	) / min(resolution.x, resolution.y);

	vec2 m = touch.xy / resolution.xy;
	m.y *= .75;
	m.y -= .125;
	m.y = clamp(m.y, .0, .45);

	vec3 ro = vec3(0., 3., -6.);
	bool aut = pointerCount == 0;
	float autYZ = .05+sin(T*.25)*.25;
	float autXZ = T * .25;

	ro.yz *= Rot(aut ? autYZ: -m.y * PI + 1.);
	ro.xz *= Rot(aut ? autXZ: -m.x * TAU);

	vec3 rd = GetRayDir(uv, ro, vec3(.0), 1.);

	float ref = .0;
	vec3 col = Render(ro, rd, ref);

	for (int i = 0; i < 2; i++) {
		col += ref * Render(ro, rd, ref);
	}

	col = pow(col, vec3(.45));

	fragColor = vec4(col, 1.);
}
`
let time
let buffer
let program
let touch
let resolution
let pointerCount
let vertices = []
let touching = false

function resize() {
  const { innerWidth: width, innerHeight: height } = window

  canvas.width = width * dpr
  canvas.height = height * dpr

  gl.viewport(0, 0, width * dpr, height * dpr)
}

function compile(shader, source) {
  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader))
  }
}

function setup() {
  const vs = gl.createShader(gl.VERTEX_SHADER)
  const fs = gl.createShader(gl.FRAGMENT_SHADER)

  program = gl.createProgram()

  compile(vs, vertexSource)
  compile(fs, fragmentSource)

  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program))
  }

  vertices = [-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]

  buffer = gl.createBuffer()

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)

  const position = gl.getAttribLocation(program, "position")

  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  time = gl.getUniformLocation(program, "time")
  touch = gl.getUniformLocation(program, "touch")
  pointerCount = gl.getUniformLocation(program, "pointerCount")
  resolution = gl.getUniformLocation(program, "resolution")
}

function draw(now) {
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)

  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)

  gl.uniform1f(time, now * 0.001)
  gl.uniform2f(touch, ...getTouches())
  gl.uniform1i(pointerCount, touches.size)
  gl.uniform2f(resolution, canvas.width, canvas.height)
  gl.drawArrays(gl.TRIANGLES, 0, vertices.length * 0.5)
}

function getTouches() {
  if (!touches.size) {
    return [0, 0]
  }

  for (let [id, t] of touches) {
    const result = [dpr * t.clientX, dpr * (innerHeight - t.clientY)]

    return result
  }
}

function loop(now) {
  draw(now)
  requestAnimationFrame(loop)
}

function init() {
  setup()
  resize()
  loop(0)
}

document.body.onload = init
window.onresize = resize 
canvas.onpointerdown = e => {
  touching = true
  touches.set(e.pointerId, e)
}
canvas.onpointermove = e => {
  if (!touching) return
  touches.set(e.pointerId, e)
}
canvas.onpointerup = e => {
  touching = false
  touches.clear()
}
canvas.onpointerout = e => {
  touching = false
  touches.clear()
}

const tabs = document.querySelectorAll('.tab')
const tabContents = document.querySelectorAll('.tab-content')
console.log(tabs)
console.log(tabContents)

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
	console.log('Tab ', index, 'clicked!');
    tabs.forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    tabContents.forEach(c => c.classList.remove('active'))
    tabContents[index].classList.add('active')
	tabContents[index].style.display = 'block'
  })
})
