export const LINE_SHADER = /* wgsl */ `
struct Uniforms {
  viewProj: mat3x3f,
  resolution: vec2f,
  _pad: vec2f,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexIn {
  @location(0) position: vec2f,
  @location(1) color: vec4f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

@vertex
fn vsMain(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  let p = u.viewProj * vec3f(input.position, 1.0);
  // NDC: x/y already in screen pixels after view matrix — convert using resolution
  let ndc = vec2f(
    (p.x / u.resolution.x) * 2.0 - 1.0,
    1.0 - (p.y / u.resolution.y) * 2.0
  );
  out.position = vec4f(ndc, 0.0, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fsMain(input: VertexOut) -> @location(0) vec4f {
  return input.color;
}
`

export const PICK_SHADER = /* wgsl */ `
struct Uniforms {
  viewProj: mat3x3f,
  resolution: vec2f,
  _pad: vec2f,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexIn {
  @location(0) position: vec2f,
  @location(1) pickId: u32,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) pickId: u32,
}

@vertex
fn vsMain(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  let p = u.viewProj * vec3f(input.position, 1.0);
  let ndc = vec2f(
    (p.x / u.resolution.x) * 2.0 - 1.0,
    1.0 - (p.y / u.resolution.y) * 2.0
  );
  out.position = vec4f(ndc, 0.0, 1.0);
  out.pickId = input.pickId;
  return out;
}

@fragment
fn fsMain(input: VertexOut) -> @location(0) u32 {
  return input.pickId;
}
`
