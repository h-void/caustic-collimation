import type { PresetIndex, SupportedLocale } from './benchConfig.ts';

export interface LocaleMessages {
  pageTitle: string;
  eyebrow: string;
  title: string;
  subtitleBilingual: string;
  githubSource: string;
  viewBench3D: string;
  viewSchematic2D: string;
  viewDisabledInPrint: string;
  dragMove: string;
  dragTilt: string;
  driftOff: string;
  driftGentle: string;
  printLitho: string;
  exitPrint: string;
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
  telemetryToggleLabel: string;
  presetNames: Record<PresetIndex, string>;
  presetShortNames: Record<PresetIndex, string>;
  archetypeNames: readonly [string, string, string, string, string];
  archetypeShortNames: readonly [string, string, string, string, string];
  glassNames: readonly [string, string];
  glassShortNames: readonly [string, string];
}

export const LOCALES: Record<SupportedLocale, LocaleMessages> = {
  en: {
    pageTitle: 'Caustic Collimation — Interactive Optical Bench',
    eyebrow: 'OPTICAL BENCH · 420–680 NM',
    title: 'Caustic Collimation',
    subtitleBilingual: '光軸與焦散 · Interactive Glass Dispersion & Overtone Bench',
    githubSource: 'GitHub Source \u2197\uFE0E',
    viewBench3D: 'View: 3D Bench [V]',
    viewSchematic2D: 'View: 2D Schematic [V]',
    viewDisabledInPrint: '2D only in ray diagram mode',
    dragMove: 'Drag: Move',
    dragTilt: 'Drag: Tilt (±35°)',
    driftOff: 'Drift: Still [B]',
    driftGentle: 'Drift: Gentle [B]',
    printLitho: 'Ray Diagram [P]',
    exitPrint: '× Back to Bench [P]',
    resetBench: 'Collimate / Reset [R]',
    langSwitchLabel: '繁中',
    dispersionLabel: 'Cauchy γD',
    audioPrompt: '○ Click or press any key for sound',
    audioActive: '● Overtone Synth · [M] Mute',
    audioMuted: '◌ Sound Muted · [M] Unmute',
    interactionHint:
      'Drag: move · Shift / RMB: tilt (±35°) · [1–5] [V] [B] [P] [M] [R]',
    telemetryTilt: 'Net Tilt Θ',
    telemetryBeat: 'Beat Δf',
    telemetrySelected: 'Element',
    telemetryToggleLabel: 'Telemetry',
    presetNames: {
      1: '1 · Off-Axis Coma',
      2: '2 · Double Flint Prism',
      3: '3 · Anamorphic Astigmatism',
      4: '4 · Zero-Beat Collimation',
      5: '5 · Five-Element Cavity',
    },
    presetShortNames: {
      1: 'Off-Axis Coma',
      2: 'Double Flint Prism',
      3: 'Anamorphic Astigmatism',
      4: 'Zero-Beat Collimation',
      5: 'Five-Element Cavity',
    },
    archetypeNames: [
      'Biconvex Singlet',
      'Negative Meniscus',
      'Even-Order Aspheric',
      'Dispersive Prism',
      'Cylindrical Anamorphic',
    ],
    archetypeShortNames: ['Biconvex', 'Meniscus', 'Aspheric', 'Prism', 'Cylindrical'],
    glassNames: ['N-BK7 Crown', 'SF11 Dense Flint'],
    glassShortNames: ['N-BK7', 'SF11'],
  },
  'zh-HK': {
    pageTitle: '光軸與焦散 — 互動光學台',
    eyebrow: '光學實驗台 · 420–680 NM',
    title: '光軸與焦散',
    subtitleBilingual: 'Caustic Collimation · 互動透鏡色散與泛音光學台',
    githubSource: 'GitHub 原始碼 \u2197\uFE0E',
    viewBench3D: '視角：三維光學台 [V]',
    viewSchematic2D: '視角：二維追跡剖面 [V]',
    viewDisabledInPrint: '光路圖模式僅支援二維剖面',
    dragMove: '拖曳：平移',
    dragTilt: '拖曳：傾角 (±35°)',
    driftOff: '呼吸偏轉：靜止 [B]',
    driftGentle: '呼吸偏轉：微動 [B]',
    printLitho: '2D 光路圖 [P]',
    exitPrint: '× 返回光學台 [P]',
    resetBench: '重設光軸 [R]',
    langSwitchLabel: 'EN',
    dispersionLabel: '色散倍增 γD',
    audioPrompt: '○ 點擊或按任意鍵開啟聲音',
    audioActive: '● 泛音合成 · [M] 靜音',
    audioMuted: '◌ 已靜音 · [M] 恢復',
    interactionHint:
      '拖曳：平移 · Shift / 右鍵：傾角 (±35°) · [1–5] [V] [B] [P] [M] [R]',
    telemetryTilt: '總合傾角 Θ',
    telemetryBeat: '拍頻 Δf',
    telemetrySelected: '當前元件',
    telemetryToggleLabel: '遙測',
    presetNames: {
      1: '1 · 離軸彗差',
      2: '2 · 雙燧石稜鏡',
      3: '3 · 柱面像散',
      4: '4 · 準直零拍諧振',
      5: '5 · 五鏡全譜腔',
    },
    presetShortNames: {
      1: '離軸彗差',
      2: '雙燧石稜鏡',
      3: '柱面像散',
      4: '準直零拍諧振',
      5: '五鏡全譜腔',
    },
    archetypeNames: [
      '雙凸冕牌單鏡',
      '負彎月燧石鏡',
      '偶次非球面鏡',
      '色散燧石稜鏡',
      '柱面變形透鏡',
    ],
    archetypeShortNames: ['雙凸單鏡', '負彎月鏡', '偶次非球面', '色散稜鏡', '柱面透鏡'],
    glassNames: ['N-BK7 冕牌玻璃', 'SF11 重燧石玻璃'],
    glassShortNames: ['N-BK7', 'SF11'],
  },
};
