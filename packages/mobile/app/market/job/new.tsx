import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../hooks/useTheme';
import { typography, spacing } from '../../../constants/theme';
import { BackButton } from '../../../components/ui/BackButton';
import { Switch } from '../../../components/ui/Switch';
import { Ionicons } from '@expo/vector-icons';
import { coachJobApi } from '../../../services/coachJob';
import { RegionSelect } from '../../../components/market/RegionSelect';
import { uploadImage, absolutizeUploadUrl } from '../../../services/upload';
import { useClubStore } from '../../../store/clubStore';
import { showError, showSuccess } from '../../../utils/feedback';

// ─────────────────────────────────────────────────────────────
// 코치 구인 공고 작성/수정 — 누구나 가능.
// 명의: 개인 요청(기본) 또는 내가 운영진인 클럽. ?id= 있으면 수정 모드.
// ─────────────────────────────────────────────────────────────

const DAYS = [
  { day: 1, label: '월' }, { day: 2, label: '화' }, { day: 3, label: '수' },
  { day: 4, label: '목' }, { day: 5, label: '금' }, { day: 6, label: '토' }, { day: 0, label: '일' },
];
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export default function JobPostForm() {
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const clubs = useClubStore((st) => st.clubs);

  // 직접 URL 진입(새로고침) 시 스토어가 비어 클럽 명의 칩이 안 보이는 문제 방지.
  useEffect(() => {
    if ((clubs ?? []).length === 0) useClubStore.getState().fetchClubs().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 내가 운영진인 클럽만 명의 후보.
  const myClubs = useMemo(
    () => (clubs ?? []).filter((c: { role?: string; isLeader?: boolean }) => c.isLeader || c.role === 'LEADER' || c.role === 'STAFF'),
    [clubs],
  );

  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);

  const [clubId, setClubId] = useState<string | null>(null); // null = 개인 요청
  const [title, setTitle] = useState('');
  const [regionCodes, setRegionCodes] = useState<string[]>([]);
  const [region, setRegion] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [payMonthly, setPayMonthly] = useState('');
  const [paySession, setPaySession] = useState('');
  const [payNegotiable, setPayNegotiable] = useState(true);
  const [requirements, setRequirements] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!editId) return;
    coachJobApi
      .get(editId)
      .then((j) => {
        if (!j.canManage) {
          showError('수정 권한이 없어요');
          router.back();
          return;
        }
        setClubId(j.clubId);
        setTitle(j.title);
        setRegionCodes(j.regionCodes ?? []);
        setRegion(j.regionDetail ?? '');
        setDays(j.days ?? []);
        setStart(j.start ?? '');
        setEnd(j.end ?? '');
        setPayMonthly(j.payMonthly != null ? String(j.payMonthly) : '');
        setPaySession(j.paySession != null ? String(j.paySession) : '');
        setPayNegotiable(j.payNegotiable);
        setRequirements(j.requirements ?? '');
        setDescription(j.description ?? '');
        setPhotos(j.photos ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // 모집공고 사진(체육관·코트) — 업로드 인프라 재사용, 최대 5장.
  const addPhoto = async () => {
    if (uploading || photos.length >= 5) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { showError('사진 접근 권한이 필요합니다'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (result.canceled || !result.assets?.length) return;
      setUploading(true);
      const url = await uploadImage(result.assets[0].uri);
      setPhotos((prev) => [...prev, url].slice(0, 5));
    } catch {
      /* 토스트는 인터셉터 */
    } finally {
      setUploading(false);
    }
  };

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const save = async () => {
    if (!title.trim()) { showError('공고 제목을 입력해 주세요'); return; }
    if (regionCodes.length === 0) { showError('지역(시/도)을 선택해 주세요'); return; }
    if ((start && !HHMM.test(start)) || (end && !HHMM.test(end))) { showError('시간 형식은 HH:mm 이에요'); return; }
    setSaving(true);
    try {
      const input = {
        clubId,
        title: title.trim(),
        regionCodes,
        region: region.trim() || null,
        days: days.length > 0 ? days : null,
        start: start.trim() || null,
        end: end.trim() || null,
        payMonthly: payMonthly.trim() ? Number(payMonthly.replace(/[^0-9]/g, '')) : null,
        paySession: paySession.trim() ? Number(paySession.replace(/[^0-9]/g, '')) : null,
        payNegotiable,
        requirements: requirements.trim() || null,
        description: description.trim() || null,
        photos,
      };
      if (editId) {
        await coachJobApi.update(editId, input);
        showSuccess('공고를 수정했어요');
        router.back();
      } else {
        const { id } = await coachJobApi.create(input);
        showSuccess('공고를 올렸어요');
        router.replace(`/market/job/${id}` as never);
      }
    } catch {
      /* 토스트는 인터셉터 */
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>{editId ? '공고 수정' : '코치 구인 공고'}</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 120, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const, gap: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {/* 명의 선택 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>공고 명의</Text>
            <View style={styles.ownerRow}>
              <Pressable
                onPress={() => setClubId(null)}
                style={[styles.ownerChip, { backgroundColor: clubId === null ? colors.primary : colors.surface, borderColor: clubId === null ? colors.primary : colors.border }]}
              >
                <Text style={[styles.ownerChipText, { color: clubId === null ? '#fff' : colors.textSecondary }]}>개인 요청</Text>
              </Pressable>
              {myClubs.map((c: { id: string; name: string }) => {
                const on = clubId === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setClubId(c.id)}
                    style={[styles.ownerChip, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border }]}
                  >
                    <Text style={[styles.ownerChipText, { color: on ? '#fff' : colors.textSecondary }]} numberOfLines={1}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            {myClubs.length === 0 && (
              <Text style={[styles.hint, { color: colors.textLight }]}>운영 중인 모임이 있으면 모임 명의로도 올릴 수 있어요</Text>
            )}
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>제목 *</Text>
            <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholder="예: 월수 저녁 레슨 코치님을 찾습니다" placeholderTextColor={colors.textLight} maxLength={60} />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>지역 * <Text style={{ color: colors.textLight }}>(시/도 복수 선택)</Text></Text>
            <RegionSelect value={regionCodes} onChange={setRegionCodes} />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>상세 위치 <Text style={{ color: colors.textLight }}>(선택)</Text></Text>
            <TextInput style={inputStyle} value={region} onChangeText={setRegion} placeholder="예: 송파구 ○○체육관" placeholderTextColor={colors.textLight} maxLength={60} />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>희망 요일 <Text style={{ color: colors.textLight }}>(비우면 협의)</Text></Text>
            <View style={styles.dayRow}>
              {DAYS.map((d) => {
                const on = days.includes(d.day);
                return (
                  <Pressable key={d.day} onPress={() => toggleDay(d.day)} style={[styles.dayChip, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border }]}>
                    <Text style={[styles.dayChipText, { color: on ? '#fff' : colors.textSecondary }]}>{d.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>희망 시간 <Text style={{ color: colors.textLight }}>(비우면 협의)</Text></Text>
            <View style={styles.rowFields}>
              <TextInput style={[...inputStyle, styles.flex1, styles.centerText]} value={start} onChangeText={setStart} placeholder="19:00" placeholderTextColor={colors.textLight} maxLength={5} />
              <Text style={{ color: colors.textLight }}>~</Text>
              <TextInput style={[...inputStyle, styles.flex1, styles.centerText]} value={end} onChangeText={setEnd} placeholder="20:00" placeholderTextColor={colors.textLight} maxLength={5} />
            </View>
          </View>

          <View style={styles.rowFields}>
            <View style={[styles.field, styles.flex1]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>월 급여(원)</Text>
              <TextInput style={inputStyle} value={payMonthly} onChangeText={setPayMonthly} placeholder="300000" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={9} />
            </View>
            <View style={[styles.field, styles.flex1]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>회당 급여(원)</Text>
              <TextInput style={inputStyle} value={paySession} onChangeText={setPaySession} placeholder="70000" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={9} />
            </View>
          </View>

          <View style={[styles.negotiableRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.negotiableTitle, { color: colors.text }]}>급여 협의 가능</Text>
              <Text style={[styles.hint, { color: colors.textLight }]}>지원자와 채팅으로 조율할 수 있어요</Text>
            </View>
            <Switch value={payNegotiable} onValueChange={setPayNegotiable} />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>우대 · 요구 사항</Text>
            <TextInput style={[...inputStyle, styles.multilineShort]} value={requirements} onChangeText={setRequirements} placeholder={'예: 선수 출신 우대, 초·중급 지도 경험'} placeholderTextColor={colors.textLight} multiline maxLength={500} />
          </View>

          {/* 모집공고 사진 — 체육관·코트 사진이 있으면 지원율이 올라간다 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>사진 첨부 <Text style={{ color: colors.textLight }}>(체육관·코트, 최대 5장)</Text></Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {photos.map((ph, i) => (
                <View key={ph} style={styles.photoWrap}>
                  <Image source={{ uri: absolutizeUploadUrl(ph)! }} style={styles.photoThumb} />
                  <Pressable
                    onPress={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                    style={[styles.photoRemove, { backgroundColor: colors.text }]}
                    hitSlop={6}
                  >
                    <Ionicons name="close" size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {photos.length < 5 && (
                <Pressable
                  onPress={addPhoto}
                  disabled={uploading}
                  style={[styles.photoAdd, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  {uploading ? <ActivityIndicator color={colors.primary} /> : (
                    <>
                      <Ionicons name="camera-outline" size={20} color={colors.textLight} />
                      <Text style={[styles.photoAddText, { color: colors.textLight }]}>{photos.length}/5</Text>
                    </>
                  )}
                </Pressable>
              )}
            </ScrollView>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>상세 설명</Text>
            <TextInput style={[...inputStyle, styles.multiline]} value={description} onChangeText={setDescription} placeholder={'모임 소개, 수강 인원, 코트 상황, 원하는 수업 방식 등'} placeholderTextColor={colors.textLight} multiline maxLength={2000} />
          </View>
        </ScrollView>
      )}

      {!loading && (
        <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Pressable onPress={save} disabled={saving} style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary }, (pressed || saving) && { opacity: 0.85 }]}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{editId ? '수정 저장' : '공고 올리기'}</Text>}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  field: { gap: 6 },
  rowFields: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  flex1: { flex: 1 },
  centerText: { textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
  input: {
    ...typography.body2,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: Platform.OS === 'web' ? 12 : 11,
  },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  multilineShort: { minHeight: 72, textAlignVertical: 'top' },
  ownerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  ownerChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, maxWidth: 180 },
  ownerChipText: { fontSize: 13, fontWeight: '800' },
  dayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  dayChip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  dayChipText: { fontSize: 14, fontWeight: '900' },
  negotiableRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: 14, padding: spacing.lg },
  photoWrap: { position: 'relative' },
  photoThumb: { width: 84, height: 84, borderRadius: 12 },
  photoRemove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  photoAdd: { width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 3 },
  photoAddText: { fontSize: 11, fontWeight: '700' },
  negotiableTitle: { fontSize: 14.5, fontWeight: '800' },
  bottomBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  saveBtn: { paddingVertical: 15, borderRadius: 14, alignItems: 'center', maxWidth: 560, width: '100%', alignSelf: 'center' },
  saveText: { fontSize: 15.5, fontWeight: '800', color: '#fff' },
});
