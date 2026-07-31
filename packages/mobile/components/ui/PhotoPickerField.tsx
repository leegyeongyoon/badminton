import React, { useState } from 'react';
import { View, Text, Image, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../hooks/useTheme';
import { spacing } from '../../constants/theme';
import { Icon } from './Icon';
import { uploadImage, absolutizeUploadUrl } from '../../services/upload';
import { showError } from '../../utils/feedback';

interface PhotoPickerFieldProps {
  /** 현재 저장된 이미지 URL(서버 상대 경로 또는 절대 URL). 없으면 placeholder. */
  value: string | null;
  /** 업로드 완료 시 서버 상대 경로(/uploads/xxx.webp) 콜백. null = 삭제. */
  onChange: (url: string | null) => void;
  /** 미리보기 크기(px). 기본 112. */
  size?: number;
  /** true 면 원형(프로필), false 면 라운드 사각. 기본 true. */
  circle?: boolean;
  label?: string;
  disabled?: boolean;
}

/**
 * 사진 선택 → 업로드 → URL 콜백까지 한 번에 하는 공용 필드.
 * 갤러리에서 고르면 즉시 서버로 업로드하고, 성공한 상대 경로만 onChange 로 넘긴다.
 * (폼 저장 전에 이미 파일은 서버에 있으므로 폼은 URL 문자열만 다루면 된다)
 */
export function PhotoPickerField({
  value,
  onChange,
  size = 112,
  circle = true,
  label,
  disabled = false,
}: PhotoPickerFieldProps) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    if (busy || disabled) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showError('사진 접근 권한이 필요합니다');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.length) return;

      setBusy(true);
      const url = await uploadImage(result.assets[0].uri);
      onChange(url);
    } catch {
      // 업로드 실패 토스트는 api 인터셉터가 이미 띄움 — 여기선 상태만 복구.
    } finally {
      setBusy(false);
    }
  };

  const previewUrl = absolutizeUploadUrl(value);
  const borderRadius = circle ? size / 2 : 20;

  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text> : null}
      <Pressable
        onPress={pick}
        disabled={busy || disabled}
        accessibilityLabel={label || '사진 선택'}
        style={({ pressed }) => [
          styles.box,
          {
            width: size,
            height: size,
            borderRadius,
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        {previewUrl ? (
          <Image source={{ uri: previewUrl }} style={{ width: size, height: size, borderRadius }} />
        ) : (
          <View style={styles.placeholder}>
            <Icon name="camera" size={26} color={colors.textLight} />
            <Text style={[styles.placeholderText, { color: colors.textLight }]}>사진 추가</Text>
          </View>
        )}
        {busy ? (
          <View style={[styles.busyOverlay, { borderRadius }]}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
        {/* 카메라 뱃지 — 사진이 있어도 '바꿀 수 있음'이 보이게 */}
        {previewUrl && !busy ? (
          <View style={[styles.editBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
            <Icon name="camera" size={13} color="#fff" />
          </View>
        ) : null}
      </Pressable>
      {previewUrl && !disabled ? (
        <Pressable onPress={() => onChange(null)} hitSlop={8} disabled={busy}>
          <Text style={[styles.removeText, { color: colors.textSecondary }]}>사진 삭제</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm },
  label: { fontSize: 13, fontWeight: '700' },
  box: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  placeholder: { alignItems: 'center', gap: 4 },
  placeholderText: { fontSize: 12, fontWeight: '600' },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
});
