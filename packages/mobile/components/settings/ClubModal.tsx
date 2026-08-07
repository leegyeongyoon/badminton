import React, { useEffect, useMemo, useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { Strings } from '../../constants/strings';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { spacing } from '../../constants/theme';
import { Colors } from '../../constants/colors';
import { useFormValidation } from '../../hooks/useFormValidation';
import { compose, required, minLength } from '../../utils/validation';
import { facilityApi, type PlaceSearchResult } from '../../services/facility';
import { showAlert } from '../../utils/alert';

interface ClubModalProps {
  mode: 'create' | 'join';
  visible: boolean;
  value: string;
  onChangeText: (text: string) => void;
  /** create: 선택한 홈 시설 id 를 넘긴다(위치 필수). join: 인자 없음. */
  onConfirm: (homeFacilityId?: string) => void;
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

  // 위치(홈 시설) — create 모드 필수. 카카오 검색으로 장소를 골라 저장 시 시설을 만들어 연결.
  // (ui/Modal 은 RN Modal 이라 AddFacilityModal 을 겹치면 iOS 먹통 → 검색을 인라인으로 둔다.)
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [picked, setPicked] = useState<PlaceSearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Keep form value in sync with external prop
  useEffect(() => {
    form.setValue('value', value);
  }, [value]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearched(true);
    try {
      const { data } = await facilityApi.searchPlaces(q);
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleConfirm = useCallback(async () => {
    if (!form.validate()) return;
    if (!isCreate) {
      onConfirm();
      return;
    }
    if (!picked) {
      showAlert('위치 필요', '모임 위치를 검색해서 선택해 주세요');
      return;
    }
    setSubmitting(true);
    try {
      // 고른 장소를 시설로 만들어 홈 시설로 연결(좌표 포함).
      const { data } = await facilityApi.create({
        name: picked.name,
        address: picked.address || undefined,
        latitude: picked.latitude,
        longitude: picked.longitude,
      });
      onConfirm(data.id);
    } catch (err: any) {
      showAlert('오류', err?.response?.data?.error || '위치 설정에 실패했어요');
      setSubmitting(false);
    }
  }, [form, isCreate, picked, onConfirm]);

  // Reset form + 위치 상태 when modal opens/closes
  useEffect(() => {
    if (!visible) {
      form.reset();
      setQuery('');
      setResults([]);
      setSearching(false);
      setSearched(false);
      setPicked(null);
      setSubmitting(false);
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
            loading={submitting}
            disabled={!value.trim() || (isCreate && !picked) || submitting}
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
      {isCreate && (
        <View style={styles.locWrap}>
          <Text style={styles.locLabel}>
            모임 위치 <Text style={styles.req}>*</Text>
          </Text>
          {picked ? (
            <View style={styles.pickedRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickedName} numberOfLines={1}>{picked.name}</Text>
                {!!picked.address && (
                  <Text style={styles.pickedAddr} numberOfLines={1}>{picked.address}</Text>
                )}
              </View>
              <Pressable onPress={() => setPicked(null)} hitSlop={8} accessibilityLabel="위치 변경">
                <Text style={styles.changeLink}>변경</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="체육관·장소 검색 (예: 행복배드민턴)"
                  placeholderTextColor={Colors.textLight}
                  onSubmitEditing={handleSearch}
                  returnKeyType="search"
                  maxLength={40}
                  accessibilityLabel="장소 검색어"
                />
                <Pressable
                  style={styles.searchBtn}
                  onPress={handleSearch}
                  disabled={searching || !query.trim()}
                  accessibilityLabel="장소 검색"
                >
                  {searching ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.searchBtnText}>검색</Text>
                  )}
                </Pressable>
              </View>
              {results.length > 0 && (
                <View style={styles.results}>
                  {results.map((r, i) => (
                    <Pressable
                      key={`${r.name}-${i}`}
                      style={[styles.resultItem, i > 0 && styles.resultBorderTop]}
                      onPress={() => { setPicked(r); setResults([]); setSearched(false); }}
                      accessibilityLabel={`${r.name} 선택`}
                    >
                      <Text style={styles.resultName} numberOfLines={1}>{r.name}</Text>
                      {!!r.address && (
                        <Text style={styles.resultAddr} numberOfLines={1}>{r.address}</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              )}
              {searched && !searching && results.length === 0 && (
                <Text style={styles.locHint}>검색 결과가 없어요. 다른 이름으로 검색해 보세요.</Text>
              )}
            </>
          )}
        </View>
      )}
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
  locWrap: { marginTop: spacing.md },
  locLabel: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  req: { color: Colors.danger },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  searchBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  results: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    backgroundColor: Colors.background,
    overflow: 'hidden',
  },
  resultItem: { paddingHorizontal: 12, paddingVertical: 10 },
  resultBorderTop: { borderTopWidth: 1, borderTopColor: Colors.border },
  resultName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  resultAddr: { fontSize: 12, color: Colors.textLight, marginTop: 2 },
  locHint: { fontSize: 12, color: Colors.textLight, marginTop: 8 },
  pickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    padding: 12,
    backgroundColor: Colors.primary + '10',
  },
  pickedName: { fontSize: 15, fontWeight: '800', color: Colors.text },
  pickedAddr: { fontSize: 12, color: Colors.textLight, marginTop: 2 },
  changeLink: { fontSize: 14, fontWeight: '700', color: Colors.primary },
});
