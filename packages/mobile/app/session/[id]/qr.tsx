import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, SafeAreaView,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../hooks/useTheme';
import { Icon } from '../../../components/ui/Icon';
import api from '../../../services/api';
import { clubSessionApi } from '../../../services/clubSession';
import { typography, spacing, radius } from '../../../constants/theme';

// ─────────────────────────────────────────────────────────
// 정모 출석 QR — 운영자가 띄워두면 참가자가 폰 카메라로 스캔해 출석.
//  • GET /club-sessions/:id/qr → { payload: "<WEB_BASE_URL>/attend?session=<id>", qr: data URL }
//  • 스캔하면 웹앱 /attend 가 열려 (로그인 후) 무조건 출석되고 현황 보드로 이동.
//  • 큰 QR <Image> (data URL은 RN/웹 모두 동작) + 정모/모임 이름 + 안내문구
// ─────────────────────────────────────────────────────────

interface SessionMeta {
  clubName?: string | null;
  title?: string | null;
}

export default function SessionQrScreen() {
  const router = useRouter();
  const { id: clubSessionId } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();

  const [qr, setQr] = useState<string | null>(null);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubSessionId) return;
    setLoading(true);
    setError(null);
    try {
      // QR (필수) + 정모 메타(제목/모임명, 실패해도 무방)를 병렬로.
      const [qrRes, metaRes] = await Promise.all([
        clubSessionApi.getSessionQr(clubSessionId),
        api.get(`/club-sessions/${clubSessionId}`).catch(() => null),
      ]);
      setQr(qrRes.data?.qr ?? null);
      setMeta(metaRes?.data ?? null);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'QR을 불러오지 못했어요');
      setQr(null);
    } finally {
      setLoading(false);
    }
  }, [clubSessionId]);

  useEffect(() => { load(); }, [load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const title = meta?.title || meta?.clubName || '정모 출석';

  const Header = (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={goBack} hitSlop={10} style={styles.headerBack} accessibilityLabel="뒤로">
        <Icon name="back" size={22} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>출석 QR</Text>
      <View style={styles.headerBack} />
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {Header}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error || !qr ? (
        <View style={styles.center}>
          <Icon name="info" size={36} color={colors.textLight} />
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            {error || 'QR 정보가 없어요'}
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            onPress={load}
            activeOpacity={0.85}
          >
            <Text style={styles.retryBtnText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {title}
          </Text>

          {/* 큰 흰 카드 + 중앙 QR (data URL은 웹/네이티브 모두 렌더). */}
          <View style={[styles.qrCard, { backgroundColor: colors.surface }, shadows.lg]}>
            <Image
              source={{ uri: qr }}
              style={styles.qrImage}
              resizeMode="contain"
              accessibilityLabel="정모 출석 QR 코드"
            />
          </View>

          <Text style={[styles.caption, { color: colors.text }]}>
            이 QR을 스캔하면 출석되고 현황판이 열려요
          </Text>
          <Text style={[styles.subCaption, { color: colors.textSecondary }]}>
            참가자가 폰 카메라(또는 앱 스캐너)로 이 코드를 스캔하면 자동으로 출석되고 현황 보드로 이동합니다
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const QR_SIZE = 280;

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerBack: { padding: spacing.xs, minWidth: 30 },
  headerTitle: { ...typography.subtitle1 },

  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md,
    padding: spacing.xl,
  },
  errorText: { ...typography.subtitle2, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill,
  },
  retryBtnText: { ...typography.subtitle2, color: '#fff' },

  body: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: spacing.lg, padding: spacing.xl,
  },
  title: {
    ...typography.h1, textAlign: 'center',
  },
  qrCard: {
    padding: spacing.xl,
    borderRadius: radius.card,
    alignItems: 'center', justifyContent: 'center',
  },
  qrImage: {
    width: QR_SIZE, height: QR_SIZE,
  },
  caption: {
    ...typography.h3, textAlign: 'center',
  },
  subCaption: {
    ...typography.body2, textAlign: 'center', maxWidth: 360,
  },
});
