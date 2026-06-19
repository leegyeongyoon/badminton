import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, SafeAreaView,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../hooks/useTheme';
import { Icon } from '../../../components/ui/Icon';
import { clubSessionApi, SessionSummary } from '../../../services/clubSession';
import { typography, spacing, radius, palette } from '../../../constants/theme';

// ─────────────────────────────────────────────────────────
// 정모 종료 요약 리포트 — read-only recap.
// Works for an ACTIVE or ENDED session (the backend serves both).
//  • 정모 시간 (시작 ~ 종료)
//  • 출석 (회원 N · 게스트 N · 합계)
//  • 총 게임수
//  • 1인당 게임수 (정렬된 리스트)
//  • 게스트비 정산 (총액 / 납부 / 미납)
// ─────────────────────────────────────────────────────────

// "오후 7:30" 형태로 시간만 (날짜는 헤더에 한 번만 표시).
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

// "2026년 6월 19일 (목)" 형태.
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });
}

// 경과 시간 ("2시간 15분") — 종료 전이면 현재까지로 계산.
function fmtDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '';
  const mins = Math.round((end - start) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

const won = (n: number) => `${(n ?? 0).toLocaleString('ko-KR')}원`;

export default function SummaryScreen() {
  const router = useRouter();
  const { id: clubSessionId } = useLocalSearchParams<{ id: string }>();
  const { colors, shadows } = useTheme();

  const [data, setData] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubSessionId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await clubSessionApi.getSummary(clubSessionId);
      setData(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || '요약을 불러오지 못했어요');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clubSessionId]);

  useEffect(() => { load(); }, [load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const Header = (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={goBack} hitSlop={10} style={styles.headerBack}>
        <Icon name="back" size={22} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>정모 요약</Text>
      <View style={styles.headerBack} />
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {Header}
        <ActivityIndicator style={{ marginTop: 120 }} color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {Header}
        <View style={styles.errorWrap}>
          <Icon name="info" size={36} color={colors.textLight} />
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error || '요약 정보가 없어요'}</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            onPress={load}
            activeOpacity={0.85}
          >
            <Text style={styles.retryBtnText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const { session, attendance, games, guestFees } = data;
  const isEnded = session.status === 'ENDED' || !!session.endedAt;
  const duration = fmtDuration(session.startedAt, session.endedAt);
  // 1인당 게임수 — perPlayer만 게임 한 사람을 포함하므로, 게임 수 desc로 정렬.
  const perPlayer = [...(games.perPlayer || [])].sort((a, b) => b.count - a.count);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {Header}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Title / status ─── */}
        <View style={styles.titleBlock}>
          <Text style={[styles.dateText, { color: colors.textSecondary }]}>{fmtDate(session.startedAt)}</Text>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {session.title || '정모 기록'}
            </Text>
            <View style={[
              styles.statusBadge,
              { backgroundColor: isEnded ? colors.surfaceSecondary : colors.primaryBg },
            ]}>
              <View style={[styles.statusDot, { backgroundColor: isEnded ? colors.textLight : colors.primary }]} />
              <Text style={[styles.statusText, { color: isEnded ? colors.textSecondary : colors.primary }]}>
                {isEnded ? '종료됨' : '진행 중'}
              </Text>
            </View>
          </View>
        </View>

        {/* ─── 정모 시간 ─── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
          <View style={styles.cardHeader}>
            <Icon name="calendar" size={16} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>정모 시간</Text>
          </View>
          <View style={styles.timeRow}>
            <View style={styles.timeCol}>
              <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>시작</Text>
              <Text style={[styles.timeValue, { color: colors.text }]}>{fmtTime(session.startedAt)}</Text>
            </View>
            <Icon name="chevronRight" size={18} color={colors.textLight} />
            <View style={styles.timeCol}>
              <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>종료</Text>
              <Text style={[styles.timeValue, { color: colors.text }]}>
                {session.endedAt ? fmtTime(session.endedAt) : '진행 중'}
              </Text>
            </View>
            {!!duration && (
              <View style={[styles.durationPill, { backgroundColor: colors.primaryBg }]}>
                <Text style={[styles.durationText, { color: colors.primary }]}>{duration}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ─── 출석 ─── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
          <View style={styles.cardHeader}>
            <Icon name="people" size={16} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>출석</Text>
          </View>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <Text style={[styles.statValue, { color: colors.text }]}>{attendance.memberCount}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>회원</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.divider }]} />
            <View style={styles.statCell}>
              <Text style={[styles.statValue, { color: colors.text }]}>{attendance.guestCount}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>게스트</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.divider }]} />
            <View style={styles.statCell}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{attendance.total}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>합계</Text>
            </View>
          </View>
        </View>

        {/* ─── 게임 ─── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
          <View style={styles.cardHeader}>
            <Icon name="stats" size={16} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>게임</Text>
            <View style={{ flex: 1 }} />
            <Text style={[styles.gamesTotal, { color: colors.text }]}>
              총 <Text style={{ color: colors.primary }}>{games.total}</Text>게임
            </Text>
          </View>
          {perPlayer.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textLight }]}>아직 진행된 게임이 없어요</Text>
          ) : (
            <View style={styles.perPlayerList}>
              <Text style={[styles.perPlayerHead, { color: colors.textSecondary }]}>1인당 게임수</Text>
              {perPlayer.map((p, i) => (
                <View key={p.userId} style={[styles.perPlayerRow, { borderBottomColor: colors.divider }]}>
                  <Text style={[styles.perPlayerRank, { color: colors.textLight }]}>{i + 1}</Text>
                  <Text style={[styles.perPlayerName, { color: colors.text }]} numberOfLines={1}>{p.name}</Text>
                  <View style={{ flex: 1 }} />
                  <View style={[styles.perPlayerCount, { backgroundColor: colors.surfaceSecondary }]}>
                    <Text style={[styles.perPlayerCountText, { color: colors.text }]}>{p.count}게임</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ─── 게스트비 정산 ─── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
          <View style={styles.cardHeader}>
            <Icon name="stats" size={16} color={colors.warning} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>게스트비 정산</Text>
            <View style={{ flex: 1 }} />
            <Text style={[styles.feeGuestCount, { color: colors.textSecondary }]}>게스트 {guestFees.guestCount}명</Text>
          </View>
          <View style={styles.feeRow}>
            <View style={styles.feeCell}>
              <Text style={[styles.feeLabel, { color: colors.textSecondary }]}>총액</Text>
              <Text style={[styles.feeValue, { color: colors.text }]}>{won(guestFees.totalFee)}</Text>
            </View>
            <View style={styles.feeCell}>
              <Text style={[styles.feeLabel, { color: colors.textSecondary }]}>납부</Text>
              <Text style={[styles.feeValue, { color: colors.secondary }]}>{won(guestFees.paidFee)}</Text>
            </View>
            <View style={styles.feeCell}>
              <Text style={[styles.feeLabel, { color: colors.textSecondary }]}>미납</Text>
              <Text style={[styles.feeValue, { color: guestFees.unpaidFee > 0 ? colors.danger : colors.text }]}>
                {won(guestFees.unpaidFee)}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.doneBtn, { backgroundColor: colors.primary }]}
          onPress={goBack}
          activeOpacity={0.85}
        >
          <Text style={styles.doneBtnText}>확인</Text>
        </TouchableOpacity>
        <View style={{ height: spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerBack: { padding: spacing.xs, minWidth: 30 },
  headerTitle: { ...typography.subtitle1 },

  content: { padding: spacing.lg, gap: spacing.md },

  titleBlock: { gap: spacing.xs },
  dateText: { ...typography.caption, fontWeight: '700' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.h2, flexShrink: 1 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '800' },

  card: { borderRadius: radius.card, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardTitle: { ...typography.subtitle1 },

  // 정모 시간
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  timeCol: { gap: 2 },
  timeLabel: { fontSize: 11, fontWeight: '700' },
  timeValue: { ...typography.subtitle1 },
  durationPill: {
    marginLeft: 'auto', paddingHorizontal: spacing.md, paddingVertical: 5,
    borderRadius: radius.pill,
  },
  durationText: { fontSize: 13, fontWeight: '800' },

  // 출석 stats
  statRow: { flexDirection: 'row', alignItems: 'center' },
  statCell: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { ...typography.h2 },
  statLabel: { ...typography.caption, fontWeight: '700' },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: spacing.xs },

  // 게임
  gamesTotal: { ...typography.subtitle2 },
  perPlayerList: { gap: 0 },
  perPlayerHead: { ...typography.overline, marginBottom: spacing.xs },
  perPlayerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  perPlayerRank: { fontSize: 12, fontWeight: '800', width: 18, textAlign: 'center' },
  perPlayerName: { ...typography.subtitle2, flexShrink: 1 },
  perPlayerCount: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  perPlayerCountText: { fontSize: 12, fontWeight: '800' },
  empty: { ...typography.body2, textAlign: 'center', paddingVertical: spacing.lg },

  // 게스트비
  feeGuestCount: { ...typography.caption, fontWeight: '700' },
  feeRow: { flexDirection: 'row', gap: spacing.sm },
  feeCell: {
    flex: 1, alignItems: 'center', gap: 4,
  },
  feeLabel: { fontSize: 11, fontWeight: '700' },
  feeValue: { ...typography.subtitle1 },

  doneBtn: {
    marginTop: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', minHeight: 48,
  },
  doneBtnText: { color: palette.white, ...typography.button },

  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  errorText: { ...typography.body2, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.xxl, paddingVertical: spacing.md, borderRadius: radius.lg },
  retryBtnText: { color: palette.white, ...typography.button },
});
