import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../lib/theme';

export type IconName = 'add' | 'book' | 'history' | 'user' | 'back' | 'close' | 'chevron' | 'photo' | 'calendar' | 'lock' | 'refresh' | 'check' | 'logout' | 'family' | 'note' | 'trash' | 'switch' | 'video' | 'play' | 'pause' | 'microphone' | 'stop';
const paths: Record<IconName, string> = {
  add: 'M12 5v14M5 12h14',
  book: 'M12 5v15M12 5C8 2 3 4 3 4v15s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1Z',
  history: 'M4 6v5h5M4 11a8 8 0 1 1 1 6M12 7v5l3 2',
  user: 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21v-2a8 8 0 0 1 16 0v2',
  back: 'M14 5l-7 7 7 7M7 12h14',
  close: 'M6 6l12 12M6 18L18 6',
  chevron: 'M9 5l7 7-7 7',
  photo: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM3 16l5-5 4 4 3-3 6 6M15 7h.01',
  calendar: 'M4 5h16v16H4ZM8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 17h2',
  lock: 'M6 11h12v10H6ZM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  refresh: 'M20 4v5h-5M4 20v-5h5M20 9a8 8 0 0 0-14-3M4 15a8 8 0 0 0 14 3',
  check: 'M5 12l4 4L19 6',
  logout: 'M10 4H4v16h6M9 12h12M17 8l4 4-4 4',
  family: 'M6 7a3 3 0 1 0 6 0a3 3 0 1 0-6 0M2 20v-2a7 7 0 0 1 14 0v2M16 4a3 3 0 0 1 0 6M17 13a5 5 0 0 1 5 5v2',
  note: 'M6 3h9l4 4v14H6ZM14 3v5h5M10 12h5M10 16h5',
  trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  switch: 'M4 7h15M15 3l4 4-4 4M20 17H5M9 13l-4 4 4 4',
  video: 'M3 5h12v14H3ZM15 9l6-4v14l-6-4',
  play: 'M9 5l10 7-10 7Z',
  pause: 'M8 5v14M16 5v14',
  microphone: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0ZM6 10v1a6 6 0 0 0 12 0v-1M12 17v4M8 21h8',
  stop: 'M6 6h12v12H6Z',
};

// Code-native vectors: no font loading, bitmap assets or new dependencies.
export function StoryIcon({ name, size = 22, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
    <Path d={paths[name]} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

export function StoryIllustration() {
  return <Svg width="100%" height="100%" viewBox="0 0 340 270" accessible={false}>
    <Circle cx={170} cy={135} r={113} fill={colors.peach} />
    <Circle cx={280} cy={48} r={23} fill={colors.lavender} />
    <Circle cx={54} cy={200} r={18} fill={colors.blue} />
    <Path d="M78 91Q126 76 170 96Q216 77 263 92L267 221Q217 204 170 224Q123 205 75 222Z" fill={colors.ink} />
    <Path d="M82 81Q127 70 170 91Q213 70 259 81L259 208Q214 196 170 216Q126 196 82 208Z" fill="white" />
    <Path d="M170 92v123" stroke={colors.border} strokeWidth={2} />
    <Rect x={96} y={101} width={61} height={71} rx={7} fill={colors.lavender} />
    <Circle cx={127} cy={126} r={14} fill={colors.primarySoft} />
    <Path d="M104 159q22-30 45 0" fill={colors.lavenderInk} />
    <Path d="M100 184h43M100 192h32M185 143h53M185 153h45M185 164h50M185 180h30" stroke={colors.border} strokeWidth={4} strokeLinecap="round" />
    <Path d="M209 128l-17-16c-15-15 4-32 17-17c13-15 32 2 17 17Z" fill={colors.primary} />
    <Path d="M66 60v16M58 68h16M276 175v18M267 184h18" stroke={colors.primary} strokeWidth={3} strokeLinecap="round" />
    <Circle cx={91} cy={45} r={4} fill={colors.primary} /><Circle cx={291} cy={130} r={4} fill={colors.lavenderInk} />
  </Svg>;
}
