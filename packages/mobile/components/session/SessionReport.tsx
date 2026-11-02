import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { clubSessionApi, type SessionReport as Report } from '../../services/clubSession';

// ─────────────────────────────────────────────────────────────
// 오늘 정모 리포트(운영진) — 기록에서 계산한 숫자 + AI가 정리한 2~3줄.
// 챙길 사람(오래 기다림·0판·판수 적음)을 먼저 보여 준다. 진행 중에도 열 수 있다.
// ─────────────────────────────────────────────────────────────

const REASON_KO: Record<string, string> = {
  TOO_HARD: '상대가 너무 셈',
  TOO_EASY: '너무 쉬움',
  UNBALANCED: '팀 실력 차이',
  REPEAT: '같은 사람과 또',
  WAIT: '오래 기다림',
};

export function SessionReport({ clubSessionId, onClose }: { clubSessionId: string; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    clubSessionApi
      .report(clubSessionId)
      .then(({ data }) => setR(data))
      .catch((e: any) => setErr(e?.response?.data?.error || '리포트를 불러오지 못했어요'));
  }, [clubSessionId]);

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <View style={[styles.stat, { backgroundColor: colors.surfaceSecondary }]}>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
  const Section = ({ title, items }: { title: string; items: string[] }) =>
    items.length ? (
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.cardBody, { color: colors.textSecondary }]}>{items.join(' · ')}</Text>
      </View>
    ) : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>📝 오늘 정모 리포트</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="리포트 닫기">
              <Ionicons name="close" size={22} color={colors.textLight} />
            </Pressable>
          </View>
          {err ? (
            <Text style={[styles.empty, { color: colors.textLight }]}>{err}</Text>
          ) : !r ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : (
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.lg }}>
              {r.summary && r.summary.length > 0 && (
                <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
                  <Text style={[styles.cardTitle, { color: colors.primary }]}>🤖 AI 요약</Text>
                  {r.summary.map((l, i) => (
                    <Text key={i} style={[styles.summaryLine, { color: colors.text }]}>{l}</Text>
                  ))}
                </View>
              )}
              <View style={styles.stats}>
                <Stat label={r.ended ? '정모 시간' : '진행'} value={`${Math.floor(r.minutes / 60)}시간 ${r.minutes % 60}분`} />
                <Stat label="판 수" value={`${r.games}판`} />
                <Stat label="1인 판수 (최소·중간·최대)" value={`${r.gamesPerPerson.min}·${r.gamesPerPerson.median}·${r.gamesPerPerson.max}`} />
                <Stat label="혼복 비율" value={r.mixedPct == null ? '-' : `${r.mixedPct}%`} />
              </View>
              <Section title="⏳ 25분 넘게 기다린 사람" items={r.longWaits.map((w) => `${w.name} ${w.minutes}분`)} />
              <Section title="🙋 30분 넘게 있었는데 0판" items={r.noGames.map((w) => `${w.name} (${w.stayedMin}분 있음)`)} />
              <Section title="📉 있던 시간에 비해 판수가 적은 사람" items={r.fewGames.map((w) => `${w.name} ${w.games}판 (시간당 ${w.perHour})`)} />
              {r.longWaits.length + r.noGames.length + r.fewGames.length === 0 && (
                <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Text style={[styles.cardBody, { color: colors.textSecondary }]}>오래 기다리거나 못 친 사람 없이 고르게 돌았어요</Text>
                </View>
              )}
              <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>그 밖에</Text>
                <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
                  {[
                    r.avgGameMin != null ? `판당 ${r.avgGameMin}분` : null,
                    `같은 4명 다시 ${r.sameFourRepeats}판`,
                    r.ai.games ? `AI 판 ${r.ai.games} (그대로 ${r.ai.kept} · 고침 ${r.ai.edited} · 지움 ${r.ai.deleted})` : null,
                    r.ai.commands ? `말로 시킨 명령 ${r.ai.commands}번 (실행 ${r.ai.commandsOk})` : null,
                    r.resultsRecorded ? `승패 기록 ${r.resultsRecorded}판` : null,
                    r.feedback.total
                      ? `회원 반응 ${r.feedback.total} (좋았어요 ${r.feedback.good} · 보통 ${r.feedback.ok} · 아쉬웠어요 ${r.feedback.bad}${
                          Object.keys(r.feedback.reasons).length
                            ? ` — ${Object.entries(r.feedback.reasons).map(([k, v]) => `${REASON_KO[k] ?? k} ${v}`).join(', ')}`
                            : ''
                        })`
                      : null,
                  ]
                    .filter(Boolean)
                    .join('\n')}
                </Text>
              </View>
              <Text style={[styles.hint, { color: colors.textLight }]}>숫자는 오늘 기록에서 계산했어요 · 요약은 그 숫자만 보고 AI가 썼어요</Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, maxHeight: '86%', width: '100%', maxWidth: 720, alignSelf: 'center' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { fontSize: 18, fontWeight: '800' },
  empty: { ...typography.body2, textAlign: 'center', paddingVertical: spacing.xxl },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: { flexGrow: 1, flexBasis: '45%', borderRadius: radius.lg, padding: spacing.md, gap: 2 },
  statValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: '800' },
  cardBody: { fontSize: 13.5, lineHeight: 20 },
  summaryLine: { fontSize: 14, lineHeight: 21 },
  hint: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm },
});
