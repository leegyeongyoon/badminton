import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../hooks/useTheme';
import { typography, spacing } from '../../../constants/theme';
import { BackButton } from '../../../components/ui/BackButton';
import { MoneyManager, type MoneyClub } from '../../../components/club/MoneyManager';
import { clubMoneyApi } from '../../../services/lab';
import { clubApi } from '../../../services/club';

// 모임 회비 관리(정식) — 운영진(LEADER/STAFF)이 자기 모임의
// 정산·게스트·설정을 관리. 본체는 MoneyManager(실험실과 공유),
// 서버 권한은 /clubs/:id/money/* 의 verifyClubStaff 가드가 담당.
export default function ClubMoney() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [club, setClub] = useState<MoneyClub | null>(null);

  useEffect(() => {
    if (!id) return;
    clubApi.list()
      .then(({ data }) => {
        const c = (data || []).find((x: any) => x.id === id);
        if (c) setClub({ id: c.id, name: c.name, inviteCode: c.inviteCode });
      })
      .catch(() => {});
  }, [id]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {club ? `${club.name} · 회비 관리` : '회비 관리'}
        </Text>
      </View>
      {club && <MoneyManager clubs={[club]} api={clubMoneyApi} />}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
});
