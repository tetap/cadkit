# Compatibility Matrix

| Capability | Chrome/Edge | Safari | Firefox |
|------------|-------------|---------|---------|
| WebGPU primary path | ✅ | version-dependent | version-dependent |
| OffscreenCanvas | ✅ | ✅ | ✅ |
| SharedArrayBuffer | needs COOP/COEP | needs COOP/COEP | needs COOP/COEP |
| DXF LINE/CIRCLE/ARC/LWPOLYLINE/TEXT | ✅ | ✅ | ✅ |
| DXF INSERT/SPLINE/HATCH | partial warning | same | same |
| SVG filter/mask/use | warning | warning | warning |
| SHX fonts | planned | planned | planned |

> CADKit is **WebGPU-only**. Environments without WebGPU fail fast at `createEditor`.
