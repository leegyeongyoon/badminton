import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../hooks/useTheme';
import { typography, spacing } from '../../../constants/theme';
import { BackButton } from '../../../components/ui/BackButton';
import { LessonManager, type LessonClub } from '../../../components/club/LessonManager';
import { clubLessonApi } from '../../../services/lab';
import { clubApi } from '../../../services/club';

// 모임 레슨 관리(정식) — 운영진(LEADER/STAFF)이 레슨 개설·신청 확정.
// 본체는 LessonManager(실험실과 공유), 서버 권한은 staffGuard가 담당.
export default function ClubLessons() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [club, setClub] = useState<LessonClub | null>(null);

  useEffect(() => {
    if (!id) return;
    clubApi.list()
      .then(({ data }) => {
        const c = (data || []).find((x: any) => x.id === id);
        if (c) setClub({ id: c.id, name: c.name });
      })
      .catch(() => {});
  }, [id]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {club ? `${club.name} · 레슨` : '레슨'}
        </Text>
      </View>
      {club && <LessonManager clubs={[club]} api={clubLessonApi} />}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
});
