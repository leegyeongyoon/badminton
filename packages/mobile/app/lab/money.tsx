import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { MoneyManager, type MoneyClub } from '../../components/club/MoneyManager';
import { labMoneyApi } from '../../services/lab';
import { adminStatsApi } from '../../services/adminStats';

// 실험실 회비 관리 — 최고관리자용: 모든 모임을 골라 보는 전체-클럽 뷰.
// 본체는 MoneyManager(모임 관리의 정식 화면과 공유).
export default function LabMoney() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [clubs, setClubs] = useState<MoneyClub[]>([]);

  useEffect(() => {
    adminStatsApi.getClubs()
      .then((cs) => setClubs(cs.map((c) => ({ id: c.id, name: c.name, inviteCode: c.inviteCode }))))
      .catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>회비 관리</Text>
        <View style={[styles.betaTag, { backgroundColor: colors.primaryBg }]}>
          <Text style={[styles.betaTagText, { color: colors.primary }]}>BETA</Text>
        </View>
      </View>
      <MoneyManager clubs={clubs} api={labMoneyApi} />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.h3 },
  betaTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  betaTagText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
});
