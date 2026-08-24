import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Platform } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { useAuthStore } from '../../store/authStore';
import { useClubStore } from '../../store/clubStore';
import { typography, spacing } from '../../constants/theme';

// ─────────────────────────────────────────────────────────────
// 하드 앱 게이트 (폰 브라우저 전용).
//  • 폰 모바일 웹(iPhone / Android 폰)에서는 웹 사용을 막고 앱으로 보낸다.
//  • 태블릿(iPad·Android 태블릿)과 PC는 통과 — 운영자가 태블릿/PC로
//    운영판(게임 짜기)을 쓰는 흐름을 깨지 않는다.
//    (iPadOS는 데스크톱 UA, Android 태블릿은 UA에 'Mobile' 토큰이 없음)
//  • 공개 유입 페이지(게스트 신청·문의·모임 찾기·지도·약관)는 예외 —
//    비회원 유치가 목적이라 웹 그대로 연다.
//  • "앱으로 열기"는 커스텀 스킴(badminton://)으로 시도 후 미설치로
//    판단되면(1.6s 내 전환 없음) 스토어로 폴백.
// ─────────────────────────────────────────────────────────────

const APP_STORE_URL = 'https://apps.apple.com/app/id6788656869';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.gylee.badminton';

// 웹을 계속 열어둘 경로(prefix) — 공개 유입/법적 페이지 + 로그인(운영자 우회 진입로).
const EXEMPT_PREFIXES = ['/guest-apply', '/guest-chat', '/discover', '/map', '/privacy', '/delete-account', '/login'];

function isPhoneWeb(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIPhone = /iPhone|iPod/.test(ua); // iPad는 데스크톱 UA라 자연 제외
  const isAndroidPhone = /Android/.test(ua) && /Mobile/.test(ua); // 태블릿엔 Mobile 토큰 없음
  return isIPhone || isAndroidPhone;
}

// 스토어 앱이 열리지 않는 장애 때 true로 — 폰 웹 하드 게이트를 즉시 해제하는
// 킬스위치 (1.0.5 시작 크래시 때 사용, 1.0.6 라이브 확인 후 원복).
const OUTAGE_BYPASS = false;

export function AppGate() {
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [phone, setPhone] = useState(false);
  const { user, isAuthenticated } = useAuthStore();
  const clubs = useClubStore((st) => st.clubs);

  useEffect(() => { setPhone(isPhoneWeb()); }, []);

  if (OUTAGE_BYPASS) return null;
  if (!phone) return null;
  if (EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}?`) || pathname.startsWith(`${p}/`))) return null;

  // 운영자 이상은 폰 브라우저(폴드 등)에서도 통과 — 운영판을 웹으로 쓸 수 있게.
  // 전역 role(CLUB_LEADER/SUPER_ADMIN) 또는 어느 모임이든 LEADER/STAFF면 해제.
  const role = (user as { role?: string } | null)?.role;
  const isOperator =
    isAuthenticated &&
    (role === 'CLUB_LEADER' || role === 'SUPER_ADMIN' ||
      (clubs ?? []).some((c: { role?: string }) => c.role === 'LEADER' || c.role === 'STAFF'));
  if (isOperator) return null;

  const isAndroid = /Android/.test(navigator.userAgent || '');
  const storeUrl = isAndroid ? PLAY_STORE_URL : APP_STORE_URL;

  const openApp = () => {
    // 설치돼 있으면 스킴으로 앱이 열리며 브라우저가 백그라운드로 간다.
    // 전환이 없으면(미설치) 스토어로 폴백.
    const before = Date.now();
    try { window.location.href = `badminton://${pathname.replace(/^\//, '')}`; } catch { /* noop */ }
    setTimeout(() => {
      if (Date.now() - before < 2100 && !document.hidden) {
        window.location.href = storeUrl;
      }
    }, 1600);
  };

  const install = () => {
    try { window.open(storeUrl, '_blank'); } catch { window.location.href = storeUrl; }
  };

  return (
    <View style={[styles.overlay, { backgroundColor: colors.background }]}>
      <View style={styles.body}>
        {/* eslint-disable-next-line @typescript-eslint/no-var-requires */}
        <Image source={require('../../assets/icon.png')} style={styles.icon} />
        <Text style={[styles.title, { color: colors.text }]}>콕고는 앱에서 이용할 수 있어요</Text>
        <Text style={[styles.desc, { color: colors.textSecondary }]}>
          내 차례 알림, QR 체크인, 게임 현황까지{'\n'}앱에서 실시간으로 받아보세요
        </Text>
        <Pressable onPress={openApp} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}>
          <Text style={styles.primaryText}>앱으로 열기</Text>
        </Pressable>
        <Pressable onPress={install} style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.border }, pressed && { opacity: 0.7 }]}>
          <Text style={[styles.ghostText, { color: colors.text }]}>
            {isAndroid ? 'Google Play에서 설치' : 'App Store에서 설치'}
          </Text>
        </Pressable>
        <Pressable onPress={() => router.push('/login' as never)} hitSlop={6} style={{ marginTop: spacing.lg }}>
          <Text style={[styles.hint, { color: colors.textSecondary, textDecorationLine: 'underline' }]}>
            운영자이신가요? 로그인하면 웹으로 계속 쓸 수 있어요
          </Text>
        </Pressable>
        <Text style={[styles.hint, { color: colors.textLight, marginTop: spacing.sm }]}>
          태블릿·PC 브라우저는 로그인 없이도 그대로 이용돼요
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'fixed' as never, // web 전용
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 99999,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  body: { alignItems: 'center', maxWidth: 340, width: '100%' },
  icon: { width: 88, height: 88, borderRadius: 22, marginBottom: spacing.lg },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' },
  desc: { ...typography.body2, textAlign: 'center', lineHeight: 21, marginTop: spacing.sm, marginBottom: spacing.xl },
  primaryBtn: { width: '100%', paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  primaryText: { fontSize: 15.5, fontWeight: '700', color: '#fff' },
  ghostBtn: { width: '100%', paddingVertical: 14, borderRadius: 14, alignItems: 'center', borderWidth: 1, marginTop: spacing.sm },
  ghostText: { fontSize: 14.5, fontWeight: '700' },
  hint: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
});
