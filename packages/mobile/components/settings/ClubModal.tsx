import React, { useEffect, useMemo, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Strings } from '../../constants/strings';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { spacing } from '../../constants/theme';
import { Colors } from '../../constants/colors';
import { useFormValidation } from '../../hooks/useFormValidation';
import { compose, required, minLength } from '../../utils/validation';

interface ClubModalProps {
  mode: 'create' | 'join';
  visible: boolean;
  value: string;
  onChangeText: (text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** create 모드: 모임 유형 (정기 클럽=레슨·정기회비 풀기능 / 번개 모임=라이트) */
  clubType?: 'CLUB' | 'MEETUP';
  onChangeClubType?: (t: 'CLUB' | 'MEETUP') => void;
}

export function ClubModal({
  mode,
  visible,
  value,
  onChangeText,
  onConfirm,
  onCancel,
  clubType = 'CLUB',
  onChangeClubType,
}: ClubModalProps) {
  const isCreate = mode === 'create';

  const rules = useMemo(() => ({
    value: isCreate
      ? compose(required, minLength(2))
      : required,
  }), [isCreate]);

  const form = useFormValidation({ value: '' }, rules);

  // Keep form value in sync with external prop
  useEffect(() => {
    form.setValue('value', value);
  }, [value]);

  const handleConfirm = useCallback(() => {
    if (!form.validate()) return;
    onConfirm();
  }, [form, onConfirm]);

  // Reset form state when modal opens/closes
  useEffect(() => {
    if (!visible) {
      form.reset();
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      onClose={onCancel}
      title={isCreate ? Strings.club.create : Strings.club.join}
      actions={
        <View style={styles.actions}>
          <Button
            title={Strings.common.cancel}
            onPress={onCancel}
            variant="outline"
            size="md"
          />
          <Button
            title={Strings.common.confirm}
            onPress={handleConfirm}
            variant="primary"
            size="md"
            disabled={!value.trim()}
          />
        </View>
      }
    >
      {isCreate && onChangeClubType && (
        <View style={styles.typeWrap}>
          {([
            { key: 'CLUB' as const, title: '정기 클럽', desc: '레슨 · 정기회비 · 게스트 등 풀기능' },
            { key: 'MEETUP' as const, title: '번개 모임', desc: '가볍게 모여 치기 · 엔빵 정산' },
          ]).map((t) => {
            const active = clubType === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => onChangeClubType(t.key)}
                style={[styles.typeCard, active ? styles.typeCardActive : null]}
              >
                <Text style={[styles.typeTitle, active && styles.typeTitleActive]}>{t.title}</Text>
                <Text style={[styles.typeDesc, active && styles.typeDescActive]}>{t.desc}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <Input
        label={isCreate ? '모임 이름' : '초대 코드'}
        placeholder={isCreate ? '모임 이름을 입력하세요' : 'ABCD1234'}
        value={value}
        onChangeText={(text) => {
          onChangeText(text);
          form.setValue('value', text);
        }}
        onBlur={() => form.setTouched('value')}
        error={form.touched.value ? form.errors.value : undefined}
        icon={isCreate ? 'people' : 'link'}
        maxLength={isCreate ? undefined : 8}
        autoCapitalize={isCreate ? 'none' : 'characters'}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  typeWrap: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  typeCard: {
    flex: 1,
    borderRadius: 14,
    padding: spacing.md,
    backgroundColor: Colors.background,
    gap: 2,
  },
  typeCardActive: { backgroundColor: Colors.primary },
  typeTitle: { fontSize: 14, fontWeight: '900', color: Colors.text },
  typeTitleActive: { color: '#fff' },
  typeDesc: { fontSize: 11, color: Colors.textLight, lineHeight: 15 },
  typeDescActive: { color: 'rgba(255,255,255,0.85)' },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
});
