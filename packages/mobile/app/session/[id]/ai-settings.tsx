import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../hooks/useTheme';
import { Icon } from '../../../components/ui/Icon';
import { AutoSettingsPanel } from '../../../components/session/AutoSettingsPanel';
import { gameBoardApi, type SessionPace } from '../../../services/gameBoard';
import { typography, spacing } from '../../../constants/theme';

// ─────────────────────────────────────────────────────────
// AI 편성 설정 화면 — 운영판 '🤖 AI 설정'에서 연다. 모임 단위 설정(운영진 공유) + 오늘 현황.
// ─────────────────────────────────────────────────────────
export default function AiSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const [pace, setPace] = useState<SessionPace | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () => gameBoardApi.pace(id).then(({ data }) => { if (alive) setPace(data); }).catch(() => {});
    load();
    const iv = setInterval(load, 30 * 1000); // 오늘 현황은 30초마다 갱신
    return () => { alive = false; clearInterval(iv); };
  }, [id]);

  return (
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.inner}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace(`/session/${id}/operate`))}
            hitSlop={10}
            style={styles.back}
            accessibilityLabel="운영판으로 돌아가기"
          >
            <Icon name="back" size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>🤖 AI 편성 설정</Text>
            <Text style={[styles.sub, { color: colors.textSecondary }]}>AI가 다음 게임을 어떻게 짤지 정해요</Text>
          </View>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.inner}>{id ? <AutoSettingsPanel clubSessionId={id} pace={pace} /> : null}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm },
  inner: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: spacing.md, flexDirection: 'column' },
  back: { padding: spacing.xs, position: 'absolute', left: spacing.md, top: 2, zIndex: 1 },
  title: { ...typography.subtitle1, paddingLeft: 36 },
  sub: { ...typography.caption, paddingLeft: 36, marginTop: 1 },
  body: { paddingVertical: spacing.md, paddingBottom: spacing.xl * 2 },
});
