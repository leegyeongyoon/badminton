/**
 * 콕고 랠리 — 타격 사운드 (expo-audio, Kenney CC0).
 * 게임 진입(유저 제스처 이후)에 initSfx()로 로드 — 웹 오토플레이 정책 안전.
 * 실기기는 expo-audio 네이티브 모듈이 포함된 다음 빌드부터 소리가 난다(웹은 즉시).
 */
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

const SRC = {
  hit: require('../../assets/game/audio/hit.m4a'), // 일반 타구
  smash: require('../../assets/game/audio/smash.m4a'), // 스매시
  smashBig: require('../../assets/game/audio/smash_big.m4a'), // 뜬공 응징 스매시
  net: require('../../assets/game/audio/net.m4a'), // 네트에 꽂힘
  score: require('../../assets/game/audio/score.m4a'), // 내 득점
  lose: require('../../assets/game/audio/lose.m4a'), // 실점
} as const;
export type SfxKey = keyof typeof SRC;

const VOL: Record<SfxKey, number> = { hit: 0.5, smash: 0.75, smashBig: 0.9, net: 0.55, score: 0.65, lose: 0.5 };

let players: Partial<Record<SfxKey, AudioPlayer>> = {};
let ready = false;
let muted = true; // 기본 꺼짐 — 게임 상단 토글로 켠다

export function setSfxMuted(m: boolean): void {
  muted = m;
}
export function isSfxMuted(): boolean {
  return muted;
}

export function initSfx(): void {
  if (ready) return;
  ready = true;
  try {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    for (const k of Object.keys(SRC) as SfxKey[]) {
      const p = createAudioPlayer(SRC[k]);
      p.volume = VOL[k];
      players[k] = p;
    }
  } catch {
    players = {}; // 오디오 불가 환경 — 조용히 무음
  }
}

export function playSfx(k: SfxKey): void {
  if (muted) return;
  const p = players[k];
  if (!p) return;
  try {
    p.seekTo(0);
    p.play();
  } catch {}
}
