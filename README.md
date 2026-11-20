# CAUSTIC COLLIMATION // 光軸與焦散

**WebGL2 3D Implicit SDF Optical Bench, 7-Band Cauchy Dispersion Caustics & Stereo Beating Overtone Prism**

[![Live Optical Bench](https://img.shields.io/badge/▶_Launch_Live_Optical_Bench-141619?style=for-the-badge)](https://h-void.github.io/caustic-collimation/?lang=en)
[![Archival Print Mode](https://img.shields.io/badge/Ray_Schematic_Print_Mode-B83A2A?style=for-the-badge)](https://h-void.github.io/caustic-collimation/?lang=en&print=1)
[![Pure Code](https://img.shields.io/badge/Pure_Code-Zero_External_Assets-1F4E79?style=for-the-badge)](#mathematical--technical-architecture)
[![License: MIT](https://img.shields.io/badge/License-MIT-4B525C?style=for-the-badge)](./LICENSE)

> **Solo Self-Initiated Work** · *Part II of the [Perceptual Computation](#perceptual-computation-series) pure-code media series*  
> *From Measuring Light ([COLLIMA](https://github.com/h-void/collima)) to Sculpting Light* — Instead of discarding off-axis coma, astigmatism, chromatic dispersion, and Total Internal Reflection as optical defects, **Caustic Collimation** turns a 3D signed-distance optical bench into a real-time audiovisual sculpture instrument.

---

## Mathematical & Technical Architecture

1. **5 Lipschitz-Safe 3D SDF Optical Archetypes (`src/optics/shaders.ts` & `src/optics/sdfMath.ts`)**:
   - **Biconvex Crown Singlet (`N-BK7`)**: Exact sphere-sphere-aperture CSG intersection.
   - **Negative Meniscus Flint (`SF11`)**: Convex-concave sphere difference with rear shell cap.
   - **Even-Order Aspheric Lens (`N-BK7`)**: Conic + polynomial sag $z_{\text{sag}}(r) = \frac{c r^2}{1 + \sqrt{\max(0.01, 1 - (1+\kappa)c^2 r^2)}} + \alpha_4 r^4 + \alpha_6 r^6$.
   - **Dispersive Flint Prism (`SF11`)**: Exact 3-halfspace prism SDF exhibiting both rainbow dispersion and internal critical reflection.
   - **Cylindrical Anamorphic Lens (`N-BK7`)**: Orthogonal tangential/sagittal Sturm astigmatic focal lines.
2. **3D Vector Snell Refraction, Schlick Fresnel, $k_{\text{TIR}} < 0$ TIR & 7-Band Cauchy Dispersion**:
   - Evaluates $n(\lambda) = A + \gamma_D B / \lambda^2$ across 7 wavelengths (`420, 460, 500, 545, 590, 635, 680 nm`) for Schott `N-BK7` ($A=1.5046, B=0.00420$) and dense flint `SF11` ($A=1.7432, B=0.01342$).
   - WebGL2 Transform Feedback sphere-traces `672` stratified multi-bounce rays per step (`67,200` rays during the synchronous `100`-step boot warmup) with additive Tyndall beams, analytical Bessel Airy diffraction rings $(2 J_1(\rho)/\rho)^2$, and automatic `EXT_color_buffer_float` (`RGBA16F → RGBA8` `gl.NEAREST`) fallback.
3. **7-Partial Stereo Additive Overtone Prism (`public/worklets/caustic-prism-processor.js`)**:
   - Maps the 7 optical wavelengths to harmonic partials $f_0 r_k$ ($f_0 = 110\text{ Hz}$, $r_k \in \{1.0, 1.5, \dots, 4.0\}$) with tilt-driven chromatic phase beating $\Delta f_k = 5.5\,\frac{n(\lambda_k)-n(\lambda_3)}{n(\lambda_3)-1}\,\Theta\;\text{Hz}$ (`0.00 Hz` crystal consonance when collimated at $\Theta = 0$).
4. **`[P]` Beer-Lambert Archival Lithograph Mode & Deterministic Plate Exporter**:
   - Renders `#F6F4EF` Alabaster Lithograph geometric ray cross-sections with `#141619` Pine Soot, `#1B3B5F` Prussian Blue, `#9E6B2B` Mineral Ochre, and `#C83E2B` Cinnabar inks, plus `window.__renderArchivalPlate(plateId, width, height)` for deterministic monograph export (`caustic-hero`, `caustic-schematic`, `caustic-tilt-matrix`, `caustic-thumb`).

---

## Interactive Controls & URL Contract

| Input / Query Parameter | Action |
| :--- | :--- |
| **LMB Drag on Lens** | Translate optical element along the bench axis and lateral plane |
| **Wheel / Tilt Control** | Induce off-axis tilt $(\theta_x, \theta_y)$ and chromatic phase beating |
| **`1` – `5`** | Switch optical bench presets (`1` Off-Axis Coma · `2` Double Flint Prism · `3` Anamorphic Astigmatism · `4` Collimated Quartet · `5` Grazing TIR Cavity) |
| **`P`** / `?print=1` | Toggle `[P]` 2D Geometric Ray-Tracing Lithograph mode (`Escape` exits) |
| **`M`** / Audio Pill | Unlock 7-partial beating overtone prism on first gesture (`150 ms` ramp) |
| `?lang=en` \| `?lang=zh-HK` | Interface language (`en` default) |
| `?seed=<u64>` | Bit-exact 64-bit `Rng64` Xorshift64* seed (default `1468`) |
| `?preset=<1..5>` | Boot into preset `1..5` |

---

## Local Build & Development

```bash
npm ci
npm run dev      # Local Vite dev server (http://127.0.0.1:4111)
npm run build    # Strict TypeScript check + relative-base Vite production bundle -> dist/
npm run preview  # Serve production dist/ locally
```

---

## Perceptual Computation Series

| Work | Title | Medium & Algorithms | Live Interactive Work |
| :---: | :--- | :--- | :--- |
| **01** | **MORPHOS // 菌脈・聲場** | WebGL2 Gray-Scott PDE · 262k GPU *Physarum* · Async PBO `AudioWorklet` · `[V]` 3D Gallery | [Launch ↗](https://h-void.github.io/morphos/?lang=en) |
| **02** | **CAUSTIC COLLIMATION // 光軸與焦散** *(this repo)* | WebGL2 3D Implicit SDF Optical Bench · Snell/TIR · 7-Band Cauchy · Beating Overtone Prism | [Launch ↗](https://h-void.github.io/caustic-collimation/?lang=en) |
| **03** | **POLYGLOT DRIFT // 語流・字陣** | Zero-Asset HK CJK `Canvas2D` · WebGL2 `1+JFA` SDF · `O(KN log N)` Sliced OT · 3-Formant Audio | [Launch ↗](https://h-void.github.io/polyglot-drift/?lang=en) |
| **04** | **COLLIMA // Seeing Before the ISP** | Rust 2024 + WebAssembly · 14-Bit Synthetic `.DNG` · Pre-Demosaic WLS Tilt & HCG Noise Lab | [Launch ↗](https://h-void.github.io/collima/?lang=en) |
