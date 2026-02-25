import React, { useEffect, useMemo, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Strings } from '../../constants/strings';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { spacing } from '../../constants/theme';
import { useFormValidation } from '../../hooks/useFormValidation';
import { compose, required, minLength } from '../../utils/validation';

interface ClubModalProps {
  mode: 'create' | 'join';
  visible: boolean;
  value: string;
  onChangeText: (text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ClubModal({
  mode,
  visible,
  value,
  onChangeText,
  onConfirm,
  onCancel,
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
      <Input
        label={isCreate ? '클럽 이름' : '초대 코드'}
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
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
});
