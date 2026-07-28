import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { labApi, type LabProfileResponse } from '../../services/lab';
import { getSkillMeta } from '../../constants/skill';
import { alpha } from '../../utils/color';

export default function LabProfile() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<LabProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async () => {
    try {
      setErrored(false);
      setData(await labApi.getMyProfile());
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const skill = data?.skillLevel ? getSkillMeta(data.skillLevel) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>내 배드민턴 프로필</Text>
      </View>

      {loading && !data ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : errored && !data ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary }}>프로필을 불러오지 못했어요</Text>
          <Text onPress={load} style={{ color: colors.primary, marginTop: 8, fontWeight: '700' }}>다시 시도</Text>
        </View>
      ) : data ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          {/* 헤더: 이름 + 급수 */}
          <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.avatar, { backgroundColor: colors.primaryBg }]}>
              <Text style={[styles.avatarText, { color: colors.primary }]}>{data.name?.[0] ?? '?'}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{data.name}</Text>
              {skill && (
                <Text style={[styles.skill, { color: skill.color }]}>{skill.level} · {skill.description}</Text>
              )}
            </View>
          </View>

          {/* 핵심 지표 — 틴트 스탯 카드(회비 관리와 동일 톤) */}
          <View style={styles.statRow}>
            {[
              { label: '총 게임', value: data.totalGames, tint: colors.primary },
              { label: '이번 달', value: data.thisMonthGames, tint: colors.secondary },
              { label: '연속 출석', value: data.streakDays, suffix: '일', tint: colors.warning },
            ].map((s) => (
              <View key={s.label} style={[styles.statCard, { backgroundColor: alpha(s.tint, 0.1) }]}>
                <Text style={[styles.statValue, { color: s.tint }]}>{s.value}{s.suffix ?? ''}</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* 뱃지 */}
          <Text style={[styles.section, { color: colors.textSecondary }]}>성취 뱃지</Text>
          <View style={styles.badgeGrid}>
            {data.badges.map((b) => (
              <View
                key={b.key}
                style={[
                  styles.badge,
                  { backgroundColor: colors.surface, borderColor: b.earned ? colors.primary : colors.border, opacity: b.earned ? 1 : 0.45 },
                ]}
              >
                <Text style={styles.badgeEmoji}>{b.emoji}</Text>
                <Text style={[styles.badgeLabel, { color: colors.text }]} numberOfLines={1}>{b.label}</Text>
                <Text style={[styles.badgeHint, { color: colors.textLight }]} numberOfLines={1}>{b.hint}</Text>
              </View>
            ))}
          </View>

          {/* 파트너 랭킹 */}
          <Text style={[styles.section, { color: colors.textSecondary }]}>함께 많이 친 사람</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {data.partners.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textLight }]}>아직 함께 친 기록이 없어요</Text>
            ) : (
              data.partners.map((p, i) => (
                <View key={p.userId} style={[styles.row, i > 0 && { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <Text style={[styles.rank, { color: colors.textLight }]}>{i + 1}</Text>
                  <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>{p.name}</Text>
                  <Text style={[styles.rowVal, { color: colors.primary }]}>{p.games}게임</Text>
                </View>
              ))
            )}
          </View>

          {/* 모임별 */}
          {data.clubGames.length > 0 && (
            <>
              <Text style={[styles.section, { color: colors.textSecondary }]}>모임별 게임</Text>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {data.clubGames.map((c, i) => (
                  <View key={c.clubId} style={[styles.row, i > 0 && { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth }]}>
                    <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>{c.clubName}</Text>
                    <Text style={[styles.rowVal, { color: colors.textSecondary }]}>{c.games}게임</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },

  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, marginBottom: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 22, fontWeight: '800' },
  name: { ...typography.h3 },
  skill: { ...typography.caption, fontWeight: '700', marginTop: 2 },

  statRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: spacing.lg, borderRadius: radius.lg },
  statValue: { ...typography.h2 },
  statLabel: { ...typography.caption, marginTop: 2 },

  section: { ...typography.caption, fontWeight: '800', marginTop: spacing.md, marginBottom: spacing.sm },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: { width: '31%', alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1.5 },
  badgeEmoji: { fontSize: 24 },
  badgeLabel: { ...typography.caption, fontWeight: '800', marginTop: 4 },
  badgeHint: { fontSize: 9, marginTop: 1 },

  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.smd },
  rank: { width: 18, textAlign: 'center', fontWeight: '800' },
  rowName: { ...typography.body2, flex: 1, fontWeight: '600' },
  rowVal: { ...typography.body2, fontWeight: '800' },
  empty: { ...typography.body2, paddingVertical: spacing.lg, textAlign: 'center' },
});
