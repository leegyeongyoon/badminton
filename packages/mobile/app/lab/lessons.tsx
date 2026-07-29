import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { LessonManager, type LessonClub } from '../../components/club/LessonManager';
import { labLessonApi } from '../../services/lab';
import { adminStatsApi } from '../../services/adminStats';

// 실험실 레슨 중개 — 최고관리자용: 모든 모임의 레슨을 골라 관리.
// 본체는 LessonManager(모임 관리의 정식 화면과 공유).
export default function LabLessons() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [clubs, setClubs] = useState<LessonClub[]>([]);

  useEffect(() => {
    adminStatsApi.getClubs()
      .then((cs) => setClubs(cs.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>레슨 중개</Text>
        <View style={[styles.betaTag, { backgroundColor: colors.primaryBg }]}>
          <Text style={[styles.betaTagText, { color: colors.primary }]}>BETA</Text>
        </View>
      </View>
      <LessonManager clubs={clubs} api={labLessonApi} />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.h3 },
  betaTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  betaTagText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
});
