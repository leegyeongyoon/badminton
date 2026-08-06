import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { spacing } from '../../constants/theme';
import { BottomSheet } from '../shared/BottomSheet';
import { REGIONS } from '../../constants/regions';

// ─────────────────────────────────────────────────────────────
// FilterSheet — 코치 마켓 공용 필터 시트.
// 지역(다중)은 항상, 급수·인증·가격은 showCoachFilters 일 때만(코치 찾기).
// [초기화]/[적용] — 적용을 눌러야 onApply 로 반영(시트 안은 드래프트).
// ─────────────────────────────────────────────────────────────

const SKILLS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
export const PRICE_OPTIONS = [
  { value: null, label: '전체' },
  { value: 200000, label: '월 20만 이하' },
  { value: 300000, label: '월 30만 이하' },
  { value: 500000, label: '월 50만 이하' },
] as const;

export interface MarketFilter {
  regions: string[];
  skills: string[];
  certifiedOnly: boolean;
  maxPrice: number | null;
}

export const EMPTY_FILTER: MarketFilter = { regions: [], skills: [], certifiedOnly: false, maxPrice: null };

/** 적용된 조건 수 — 트리거 버튼 뱃지용. */
export function countFilters(f: MarketFilter, coachMode: boolean): number {
  return (
    (f.regions.length > 0 ? 1 : 0) +
    (coachMode && f.skills.length > 0 ? 1 : 0) +
    (coachMode && f.certifiedOnly ? 1 : 0) +
    (coachMode && f.maxPrice != null ? 1 : 0)
  );
}

export function FilterSheet({
  visible,
  onClose,
  value,
  onApply,
  showCoachFilters = false,
}: {
  visible: boolean;
  onClose: () => void;
  value: MarketFilter;
  onApply: (next: MarketFilter) => void;
  showCoachFilters?: boolean;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<MarketFilter>(value);

  // 열릴 때마다 현재 적용값으로 드래프트 리셋.
  useEffect(() => {
    if (visible) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const Cell = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      style={[styles.cell, {
        borderColor: on ? colors.primary : colors.border,
        backgroundColor: colors.surface,
      }]}
    >
      <Text style={[styles.cellText, { color: on ? colors.primary : colors.textSecondary, fontWeight: on ? '600' : '500' }]}>{label}</Text>
    </Pressable>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title="필터" maxHeight={80}>
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>지역</Text>
      <View style={styles.grid}>
        {REGIONS.map((r) => (
          <Cell key={r} on={draft.regions.includes(r)} label={r} onPress={() => setDraft((d) => ({ ...d, regions: toggle(d.regions, r) }))} />
        ))}
      </View>

      {showCoachFilters && (
        <>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>급수</Text>
          <View style={styles.grid}>
            {SKILLS.map((s) => (
              <Cell key={s} on={draft.skills.includes(s)} label={`${s}조`} onPress={() => setDraft((d) => ({ ...d, skills: toggle(d.skills, s) }))} />
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>월 레슨비</Text>
          <View style={styles.grid}>
            {PRICE_OPTIONS.map((p) => (
              <Cell key={p.label} on={draft.maxPrice === p.value} label={p.label} onPress={() => setDraft((d) => ({ ...d, maxPrice: p.value }))} />
            ))}
          </View>

          <Pressable
            onPress={() => setDraft((d) => ({ ...d, certifiedOnly: !d.certifiedOnly }))}
            style={[styles.certRow, { borderColor: colors.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.certTitle, { color: colors.text }]}>인증 코치만</Text>
              <Text style={[styles.certHint, { color: colors.textLight }]}>자격·경력이 확인된 코치만 봐요</Text>
            </View>
            <Ionicons
              name={draft.certifiedOnly ? 'checkbox' : 'square-outline'}
              size={22}
              color={draft.certifiedOnly ? colors.primary : colors.textLight}
            />
          </Pressable>
        </>
      )}

      <View style={styles.footer}>
        <Pressable onPress={() => setDraft(EMPTY_FILTER)} style={[styles.resetBtn, { borderColor: colors.border }]}>
          <Text style={[styles.resetText, { color: colors.textSecondary }]}>초기화</Text>
        </Pressable>
        <Pressable
          onPress={() => { onApply(draft); onClose(); }}
          style={({ pressed }) => [styles.applyBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}
        >
          <Text style={styles.applyText}>적용하기</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: 13, fontWeight: '600', marginTop: spacing.lg, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, minWidth: 52, alignItems: 'center' },
  cellText: { fontSize: 13 },
  certRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: 10, padding: spacing.lg, marginTop: spacing.lg },
  certTitle: { fontSize: 14, fontWeight: '600' },
  certHint: { fontSize: 12, marginTop: 2 },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  resetBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 10, paddingVertical: 13 },
  resetText: { fontSize: 14, fontWeight: '600' },
  applyBtn: { flex: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 13 },
  applyText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
