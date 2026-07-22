import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import { getItem, setItem } from '../services/storage';
import {
  lightColors,
  darkColors,
  typography,
  spacing,
  radius,
  opacity,
  shadows,
  darkShadows,
} from '../constants/theme';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  colors: typeof lightColors;
  typography: typeof typography;
  spacing: typeof spacing;
  radius: typeof radius;
  opacity: typeof opacity;
  shadows: typeof shadows;
  setThemeMode: (mode: ThemeMode) => void;
}

const THEME_STORAGE_KEY = 'badminton_theme_mode';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  // 기본값을 라이트(화이트)로 — 크롬/OS가 다크여도 앱은 화이트로 뜬다. 다크를 원하면
  // 설정의 다크 모드 토글로 켤 수 있다(저장된 선택은 위 useEffect에서 복원).
  const [mode, setMode] = useState<ThemeMode>('light');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getItem(THEME_STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setMode(stored);
      }
      setLoaded(true);
    }).catch(() => {
      setLoaded(true);
    });
  }, []);

  const setThemeMode = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
    setItem(THEME_STORAGE_KEY, newMode).catch(() => {
      // silent — persistence failure is non-critical
    });
  }, []);

  // ⚠️ 출시용 라이트 고정: 다크 모드가 아직 일부 화면(club/[id], profile,
  // change-password, session, facility-select, notifications)에서 라이트로
  // 하드코딩돼 있어, 다크를 켜면 "라이트 화면 + 다크 조각" 불일치가 생긴다.
  // 그 화면들을 모두 테마 대응할 때까지 앱 전체를 라이트로 강제한다.
  // (darkColors/토글 로직은 그대로 보존 — 대응 완료 후 아래 한 줄만 되돌리면 됨.)
  // const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  const isDark = false;

  const value: ThemeContextValue = {
    mode,
    isDark,
    colors: isDark ? darkColors : lightColors,
    typography,
    spacing,
    radius,
    opacity,
    shadows: isDark ? darkShadows as typeof shadows : shadows,
    setThemeMode,
  };

  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used inside ThemeProvider');
  return ctx;
}
