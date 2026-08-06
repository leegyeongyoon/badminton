import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { REGIONS } from '../../constants/regions';

// 시/도 복수 선택 칩 그리드 — 프로필 활동 지역·공고 지역 입력 공용.
export function RegionSelect({
  value,
  onChange,
  max = 17,
}: {
  value: string[];
  onChange: (codes: string[]) => void;
  max?: number;
}) {
  const { colors } = useTheme();

  const toggle = (code: string) => {
    if (value.includes(code)) onChange(value.filter((c) => c !== code));
    else if (value.length < max) onChange([...value, code]);
  };

  return (
    <View style={styles.wrap}>
      {REGIONS.map((code) => {
        const on = value.includes(code);
        return (
          <Pressable
            key={code}
            onPress={() => toggle(code)}
            style={[styles.chip, { backgroundColor: colors.surface, borderColor: on ? colors.primary : colors.border }]}
          >
            <Text style={[styles.chipText, { color: on ? colors.primary : colors.textSecondary }]}>{code}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '600' },
});
