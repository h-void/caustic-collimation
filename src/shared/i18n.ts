import type { PresetIndex, SupportedLocale } from './pureCodeContract.ts';

export interface LocaleMessages {
  pageTitle: string;
  eyebrow: string;
  title: string;
  subtitleBilingual: string;
  githubSource: string;
  viewBench3D: string;
  viewSchematic2D: string;
  driftOff: string;
  driftGentle: string;
  printLitho: string;
  resetBench: string;
  langSwitchLabel: string;
  dispersionLabel: string;
  audioPrompt: string;
  audioActive: string;
  audioMuted: string;
  interactionHint: string;
  telemetryTilt: string;
  telemetryBeat: string;
  telemetrySelected: string;
  presetNames: Record<PresetIndex, string>;
  archetypeNames: readonly [string, string, string, string, string];
  glassNames: readonly [string, string];
}

export const LOCALES: Record<SupportedLocale, LocaleMessages> = {
  en: {
    pageTitle: 'CAUSTIC COLLIMATION — Computational Optics & Visual Music',
    eyebrow: 'WORK 02 // COMPUTATIONAL OPTICS & VISUAL MUSIC',
    title: 'CAUSTIC COLLIMATION',
    subtitleBilingual: '光軸與焦散 · Sculpting Off-Axis Aberrations & Spectral Caustics',
    githubSource: 'GitHub Source \u2197\uFE0E',
    viewBench3D: 'View: 3D Bench [V]',
    viewSchematic2D: 'View: 2D Schematic [V]',
    driftOff: 'Drift: Still [B]',
    driftGentle: 'Drift: Gentle [B]',
    printLitho: 'Archival Lithograph [P]',
    resetBench: 'Collimate / Reset [R]',
    langSwitchLabel: '粵 / 繁',
    dispersionLabel: 'Cauchy γD',
    audioPrompt: '○ Click or press any key to activate procedural sound',
    audioActive: '● Overtone Prism Active · Press [M] to Mute',
    audioMuted: '◌ Sound Muted · Press [M] to Unmute',
    interactionHint:
      'Drag lens: translate (x, z) · Shift+Drag / Right-Drag / Ring: tilt (±35°) · Keys 1–5, V, P, M, R',
    telemetryTilt: 'Net Tilt Θ',
    telemetryBeat: 'Prism Beat Δf',
    telemetrySelected: 'Active Element',
    presetNames: {
      1: '1 · Off-Axis Coma',
      2: '2 · Double Flint Prism',
      3: '3 · Anamorphic Astigmatism',
      4: '4 · Zero-Beat Collimation',
      5: '5 · Five-Element Cavity',
    },
    archetypeNames: [
      'Biconvex Singlet',
      'Negative Meniscus',
      'Even-Order Aspheric',
      'Dispersive Prism',
      'Cylindrical Anamorphic',
    ],
    glassNames: ['N-BK7 Crown', 'SF11 Dense Flint'],
  },
  'zh-HK': {
    pageTitle: '光軸與焦散 — 計算光學與視覺音樂雕塑',
    eyebrow: '作品 02 // 計算光學與視覺音樂',
    title: '光軸與焦散',
    subtitleBilingual: 'CAUSTIC COLLIMATION · 離軸像差與柯西色散雕塑',
    githubSource: 'GitHub 原始碼 \u2197\uFE0E',
    viewBench3D: '視角：三維光學台 [V]',
    viewSchematic2D: '視角：二維追迹剖面 [V]',
    driftOff: '呼吸偏轉：靜止 [B]',
    driftGentle: '呼吸偏轉：微動 [B]',
    printLitho: '典藏石版模式 [P]',
    resetBench: '重設光軸 [R]',
    langSwitchLabel: 'EN',
    dispersionLabel: '色散倍增 γD',
    audioPrompt: '○ 點擊或按任意鍵啟動程序化泛音聲場',
    audioActive: '● 泛音稜鏡運行中 · 按 [M] 靜音',
    audioMuted: '◌ 已靜音 · 按 [M] 恢復聲場',
    interactionHint:
      '左鍵拖曳：平移鏡片 (x, z) · Shift+拖曳 / 右鍵 / 光環：傾角旋轉 (±35°) · 快捷鍵 1–5, V, P, M, R',
    telemetryTilt: '總合傾角 Θ',
    telemetryBeat: '色散拍頻 Δf',
    telemetrySelected: '當前光學元件',
    presetNames: {
      1: '1 · 離軸彗差',
      2: '2 · 雙燧石稜鏡',
      3: '3 · 柱面像散',
      4: '4 · 準直零拍諧振',
      5: '5 · 五鏡全譜腔',
    },
    archetypeNames: [
      '雙凸冕牌單鏡',
      '負彎月燧石鏡',
      '偶次非球面鏡',
      '色散燧石稜鏡',
      '柱面變形透鏡',
    ],
    glassNames: ['N-BK7 冕牌玻璃', 'SF11 重燧石玻璃'],
  },
};
