import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Icon } from '../ui/Icon';
import { typography, spacing, radius } from '../../constants/theme';

// ─────────────────────────────────────────────────────────
// 앱 설치 유도 배너 (WEB 전용).
//  • QR 스캔 등으로 모바일 웹에 들어온 사용자에게 "앱 설치하면 실시간 알림을
//    받을 수 있어요" 를 안내하고 스토어로 보낸다.
//  • 네이티브 앱 안에서는 렌더 안 함(Platform.OS === 'web' 게이트). 데스크톱 웹,
//    이미 닫은 사용자에게도 안 뜬다.
//  • 안드로이드 앱이 아직 스토어에 없으므로 지금은 iOS(App Store)만 노출.
//    Play 출시되면 ANDROID_AVAILABLE 를 true 로.
// ─────────────────────────────────────────────────────────

const APP_STORE_URL = 'https://apps.apple.com/app/id6788656869';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.gylee.badminton';
const ANDROID_AVAILABLE = false; // Android 스토어 출시 후 true

// 세션 동안만 숨김: 닫으면 이번 방문 중엔 안 뜨고, 다음에 다시 오면(새 세션·탭)
// 재노출한다. 출시 초반 설치 유도가 목적이라 영구/장기 숨김 대신 세션 단위로 재넛지.
const DISMISS_KEY = 'kokgo_install_banner_dismissed_session';

export function AppInstallBanner() {
  const { colors, shadows } = useTheme();
  const [visible, setVisible] = useState(false);
  const [store, setStore] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return;

    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    const isAndroid = /Android/.test(ua);
    if (!isIOS && !isAndroid) return; // 모바일 웹만
    if (isAndroid && !ANDROID_AVAILABLE) return; // Play 출시 전엔 안드로이드 제외

    // 이번 세션에 닫았으면 스킵 (다음 방문·새 탭에선 다시 노출)
    try {
      if (window.sessionStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      /* sessionStorage 접근 불가 시 그냥 노출 */
    }

    setStore(isIOS ? APP_STORE_URL : PLAY_STORE_URL);
    setVisible(true);
  }, []);

  if (!visible || !store) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  const install = () => {
    try {
      window.open(store, '_blank');
    } catch {
      window.location.href = store;
    }
  };

  return (
    <View style={[styles.wrap, { pointerEvents: 'box-none' as const }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.lg]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
          <Icon name="notification" size={22} color={colors.primary} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.text }]}>콕고 앱으로 더 편하게</Text>
          <Text style={[styles.desc, { color: colors.textSecondary }]}>
            앱을 설치하면 내 차례·게임 배정을 실시간 팝업 알림으로 받아요
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={install}
              style={({ pressed }) => [styles.installBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
            >
              <Text style={styles.installText}>앱 설치하기</Text>
            </Pressable>
            <Pressable onPress={dismiss} style={styles.dismissBtn} accessibilityRole="button">
              <Text style={[styles.dismissText, { color: colors.textSecondary }]}>오늘은 웹으로 볼래요</Text>
            </Pressable>
          </View>
        </View>
        <Pressable onPress={dismiss} hitSlop={8} style={styles.closeBtn} accessibilityLabel="닫기">
          <Icon name="close" size={18} color={colors.textLight} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'fixed' as any, // web 전용
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    padding: spacing.md,
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    width: '100%',
    maxWidth: 440,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: spacing.xs },
  title: { ...typography.subtitle1 },
  desc: { ...typography.body2, lineHeight: 19 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  installBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.smd,
    borderRadius: radius.pill,
  },
  installText: { ...typography.button, color: '#fff' },
  dismissBtn: { paddingVertical: spacing.xs },
  dismissText: { ...typography.body2, fontWeight: '600' },
  closeBtn: { padding: spacing.xs },
});
