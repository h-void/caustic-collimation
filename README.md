# CAUSTIC COLLIMATION // 光軸與焦散

**WebGL2 3D Implicit SDF Optical Bench, 7-Band Cauchy Dispersion Caustics & Stereo Beating Overtone Prism**

[![Live Optical Bench](https://img.shields.io/badge/▶_Launch_Live_Optical_Bench-141619?style=for-the-badge)](https://h-void.github.io/caustic-collimation/?lang=en)
[![Archival Print Mode](https://img.shields.io/badge/Ray_Schematic_Print_Mode-B83A2A?style=for-the-badge)](https://h-void.github.io/caustic-collimation/?lang=en&print=1)
[![WebGL2 & Web Audio](https://img.shields.io/badge/WebGL2_%26_Web_Audio-Real--Time_Optics-1F4E79?style=for-the-badge)](#mathematical--technical-architecture)
[![License: MIT](https://img.shields.io/badge/License-MIT-4B525C?style=for-the-badge)](./LICENSE)

> *Part II of the [Perceptual Computation](#perceptual-computation-series) browser-native computational media series*  
> *From Measuring Light ([COLLIMA](https://github.com/h-void/collima)) to Sculpting Light* — Instead of discarding off-axis coma, astigmatism, chromatic dispersion, and Total Internal Reflection as optical defects, **Caustic Collimation** turns a 3D signed-distance optical bench into a real-time audiovisual sculpture instrument.

<p align="center">
  <a href="https://h-void.github.io/caustic-collimation/?lang=en">
    <img src="https://raw.githubusercontent.com/h-void/h-void/main/assets/previews/caustic-showcase.jpg" alt="CAUSTIC COLLIMATION — Live 3D SDF Optical Bench and [P] 2D Geometric Ray-Tracing Schematic" width="100%" />
  </a>
</p>

---

## Mathematical & Technical Architecture

1. **5 Lipschitz-Safe 3D SDF Optical Archetypes (`src/optics/shaders.ts` & `src/optics/sdfMath.ts`)**:
   - **Biconvex Crown Singlet (`N-BK7`)**: Exact sphere-sphere-aperture CSG intersection.
   - **Negative Meniscus Flint (`SF11`)**: Convex-concave sphere difference with rear shell cap.
   - **Even-Order Aspheric Lens (`N-BK7`)**: Conic + polynomial sag $z_{\text{sag}}(r) = \frac{c r^2}{1 + \sqrt{\max(0.01, 1 - (1+\kappa)c^2 r^2)}} + \alpha_4 r^4 + \alpha_6 r^6$.
   - **Dispersive Flint Prism (`SF11`)**: Exact 3-halfspace prism SDF exhibiting both rainbow dispersion and internal critical reflection.
   - **Cylindrical Anamorphic Lens (`N-BK7`)**: Orthogonal tangential/sagittal Sturm astigmatic focal lines.
2. **3D Vector Snell Refraction, Schlick Fresnel, $k_{\text{TIR}} < 0$ TIR & 7-Band Cauchy Dispersion**:
   - Evaluates $n(\lambda) = A + \gamma_D B / \lambda^2$ across 7 wavelengths (`420, 460, 500, 545, 590, 635, 680 nm`) for Schott `N-BK7` ($A=1.5046, B=0.00420$) and dense flint `SF11` ($A=1.7432, B=0.01342$), with an interactive artistic dispersion boost $\gamma_D \in [1.0, 6.0]$ (default `3.5×`).
   - WebGL2 Transform Feedback sphere-traces `672` stratified multi-bounce rays per step (`67,200` rays during the synchronous `100`-step boot warmup), splatting `25%` subsampled Tyndall beams and analytical Bessel Airy diffraction rings $(2 J_1(\rho)/\rho)^2$ with `4×` flux compensation (plus an artistic `2.2×` grazing Fresnel reflection highlight), and automatic `EXT_color_buffer_float` (`RGBA16F → RGBA8` sqrt-encoded accumulation) fallback.
3. **7-Partial Stereo Additive Overtone Prism (`public/worklets/caustic-prism-processor.js`)**:
   - Maps the 7 optical wavelengths to harmonic partials $f_0 r_k$ ($f_0 = 110\text{ Hz}$, $r_k \in \{1.0, 1.5, \dots, 4.0\}$) with degree-scale tilt-driven (`±35°`) chromatic phase beating $\Delta f_k = 5.5\,\frac{n(\lambda_k)-n(\lambda_3)}{n(\lambda_3)-1}\,\Theta\;\text{Hz}$ (`0.00 Hz` consonance when collimated at $\Theta = 0^\circ$).
4. **`[P]` Beer-Lambert Archival Lithograph Mode & Deterministic Plate Exporter**:
   - Renders `#F6F4EF` Alabaster Lithograph geometric ray cross-sections with `#141619` Pine Soot, `#1B3B5F` Prussian Blue, `#9E6B2B` Mineral Ochre, and `#C83E2B` Cinnabar inks, plus `window.__renderArchivalPlate(plateId, width, height)` for deterministic plate export.

---

## Interactive Controls & URL Contract

| Input / Query Parameter | Action |
| :--- | :--- |
| **LMB Drag on Lens** | Translate optical element along the bench axis and lateral plane |
| **Shift+Drag / RMB / Tilt Mode** | Induce degree-scale off-axis tilt $(\theta_x, \theta_y \in [-35^\circ, +35^\circ])$ and chromatic phase beating |
| **`1` – `5`** | Switch optical bench presets (`1` Off-Axis Coma · `2` Double Flint Prism · `3` Anamorphic Astigmatism · `4` Zero-Beat Collimation · `5` Five-Element Cavity) |
| **`V`** | Toggle between 3D Optical Bench and 2D Ray Schematic view |
| **`B`** | Toggle gentle breathing drift of the first element's tilt |
| **`R`** | Collimate / reset the current preset |
| **`P`** / `?print=1` | Toggle `[P]` 2D Geometric Ray-Tracing Lithograph mode (tap exit chip or press `P`/`Escape` to exit) |
| **`M`** / Audio Pill | Unlock 7-partial beating overtone prism on first gesture (`150 ms` ramp) |
| `?lang=en` \| `?lang=zh-HK` | Interface language (`en` default) |
| `?mode=schematic` | Boot directly into the 2D Ray Schematic view |
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
| **03** | **POLYGLOT DRIFT // 語流・字陣** | Zero-Asset HK CJK `Canvas2D` · WebGL2 `1+JFA` SDF · `O(KN)` Sliced OT · 3-Formant Audio | [Launch ↗](https://h-void.github.io/polyglot-drift/?lang=en) |
| **04** | **COLLIMA // Seeing Before the ISP** | Rust 2024 + WebAssembly · 14-Bit Synthetic `.DNG` · Pre-Demosaic WLS Tilt & HCG Noise Lab | [Launch ↗](https://h-void.github.io/collima/?lang=en) |
