# T2-B CAUSTIC COLLIMATION // 光軸與焦散

**Pure-Code 3D Implicit SDF Optical Bench, 7-Band Cauchy Dispersion Caustics & Stereo Overtone Prism**

> *From Measuring Light to Sculpting Light* — Instead of discarding off-axis coma, astigmatism, chromatic dispersion, and total internal reflection as optical defects, **Caustic Collimation** turns a 3D signed-distance optical bench into a real-time audiovisual sculpture instrument.

## Mathematical & Technical Architecture

1. **5 Lipschitz-Safe 3D SDF Optical Archetypes (`src/optics/shaders.ts` & `src/optics/sdfMath.ts`)**:
   - **Biconvex Crown Singlet (`N-BK7`)**: Exact sphere-sphere-aperture intersection.
   - **Negative Meniscus Flint (`SF11`)**: Convex-concave sphere difference with rear shell cap.
   - **Even-Order Aspheric Lens (`N-BK7`)**: Conic + polynomial sag $z_{\text{sag}}(r) = \frac{c r^2}{1 + \sqrt{\max(0.01, 1 - (1+\kappa)c^2 r^2)}} + \alpha_4 r^4 + \alpha_6 r^6$.
   - **Dispersive Flint Prism (`SF11`)**: Exact 3-halfspace prism SDF exhibiting both rainbow dispersion and internal critical reflection.
   - **Cylindrical Anamorphic Lens (`N-BK7`)**: Orthogonal tangential/sagittal Sturm astigmatic focal lines.
2. **3D Vector Snell Refraction, Schlick Fresnel, $k_{\text{TIR}} < 0$ TIR & 7-Band Cauchy Dispersion**:
   - Evaluates $n(\lambda) = A + \gamma_D B / \lambda^2$ across 7 wavelengths (`420, 460, 500, 545, 590, 635, 680 nm`) for Schott `N-BK7` ($A=1.5046, B=0.00420$) and dense flint `SF11` ($A=1.7432, B=0.01342$).
   - WebGL2 Transform Feedback sphere-traces `672` stratified multi-bounce rays per step (`67,200` rays during the synchronous `100`-step boot warmup) with additive Tyndall beams, analytical Bessel Airy diffraction rings $(2 J_1(\rho)/\rho)^2$, and automatic `EXT_color_buffer_float` (`RGBA16F -> RGBA8` `gl.NEAREST`) fallback.
3. **7-Partial Stereo Additive Overtone Prism (`public/worklets/caustic-prism-processor.js`)**:
   - Maps the 7 optical wavelengths to harmonic partials $f_0 r_k$ ($f_0 = 110\text{ Hz}$, $r_k \in \{1.0, 1.5, \dots, 4.0\}$) with tilt-driven chromatic phase beating $\Delta f_k = 5.5\,\frac{n(\lambda_k)-n(\lambda_3)}{n(\lambda_3)-1}\,\Theta\;\text{Hz}$ (`0.00 Hz` crystal consonance when collimated at $\Theta = 0$).
4. **`[P]` Beer-Lambert Archival Lithograph Mode & Deterministic Plate Exporter**:
   - Renders `#F6F4EF` Alabaster Lithograph cross-sections with `#141619` Pine Soot, `#1B3B5F` Prussian Blue, `#9E6B2B` Mineral Ochre, and `#C83E2B` Cinnabar optical inks, plus `window.__renderArchivalPlate(plateId, width, height)` for deterministic `4x` monograph export (`caustic-hero`, `caustic-schematic`, `caustic-tilt-matrix`, `caustic-thumb`).

## URL Query Parameters

- `?lang=en` (default) or `?lang=zh-HK` — Interface language.
- `?seed=<u64>` (default `1468`) — Bit-exact 64-bit `Rng64` Xorshift64* seed (decimal or `0x` hex).
- `?preset=1..5` — Selects initial optical bench configuration (`1`–`5`).
- `?print=1` — Boots directly into `[P]` Archival Lithograph Mode (`dataset.printMode = "true"`).

## Local Development & Verification

```bash
npm install
npm run build   # Strict TypeScript check + relative Vite bundle (dist/)
npm test        # Build + Node unit suite + Headless Chromium WebGL2/Audio/Plate verification
```

## GitHub Pages Deployment

Included in `.github/workflows/pages.yml` (`ubuntu-24.04`, Node `24`, `vite.config.ts` `base: './'` + `.nojekyll`) for zero-configuration deployment to `https://h-void.github.io/caustic-collimation/?lang=en`.
