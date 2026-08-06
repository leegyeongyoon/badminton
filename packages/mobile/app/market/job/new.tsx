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
import { coachJobApi, type JobAttachment } from '../../../services/coachJob';
import { RegionSelect } from '../../../components/market/RegionSelect';
import { uploadImage, uploadDoc, absolutizeUploadUrl } from '../../../services/upload';
import * as DocumentPicker from 'expo-document-picker';
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
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const AUDIENCES = [
  { value: 'ADULT', label: '성인' }, { value: 'JUNIOR', label: '주니어' }, { value: 'ALL', label: '전체' },
];
const EMPLOYMENTS = [
  { value: 'FULL', label: '전임' }, { value: 'PART', label: '파트' },
];

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
  // 모집 요강 첨부(PDF·한글·워드, 최대 3개) + 원문 링크(학교·센터 게시글)
  const [attachments, setAttachments] = useState<JobAttachment[]>([]);
  const [docUploading, setDocUploading] = useState(false);
  const [externalUrl, setExternalUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  // 모집 조건 구조화 — 마감일·대상·고용 형태(전부 선택 사항)
  const [deadline, setDeadline] = useState('');
  const [targetAudience, setTargetAudience] = useState<string | null>(null);
  const [employmentType, setEmploymentType] = useState<string | null>(null);

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
        setAttachments(j.attachments ?? []);
        setExternalUrl(j.externalUrl ?? '');
        setDeadline(j.deadline ?? '');
        setTargetAudience(j.targetAudience ?? null);
        setEmploymentType(j.employmentType ?? null);
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

  const addDoc = async () => {
    if (docUploading || attachments.length >= 3) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/x-hwp', 'application/haansofthwp', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      setDocUploading(true);
      const doc = await uploadDoc(result.assets[0]);
      setAttachments((prev) => [...prev, doc].slice(0, 3));
    } catch {
      /* 토스트는 인터셉터 */
    } finally {
      setDocUploading(false);
    }
  };

  // 원문 링크에서 제목·설명 가져오기 — 빈 필드만 채운다(입력한 내용은 안 덮음).
  const scrapeFromUrl = async () => {
    const url = externalUrl.trim();
    if (!url || scraping) return;
    setScraping(true);
    try {
      const r = await coachJobApi.scrape(url);
      let filled = false;
      if (r.title && !title.trim()) { setTitle(r.title.slice(0, 60)); filled = true; }
      if (r.description && !description.trim()) { setDescription(r.description); filled = true; }
      showSuccess(filled ? '원문에서 내용을 가져왔어요 — 확인 후 다듬어 주세요' : '가져올 새 내용이 없어요 (이미 입력됨)');
    } catch {
      /* 토스트는 인터셉터 */
    } finally {
      setScraping(false);
    }
  };

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const save = async () => {
    if (!title.trim()) { showError('공고 제목을 입력해 주세요'); return; }
    if (regionCodes.length === 0) { showError('지역(시/도)을 선택해 주세요'); return; }
    if ((start && !HHMM.test(start)) || (end && !HHMM.test(end))) { showError('시간 형식은 HH:mm 이에요'); return; }
    if (deadline.trim() && !YMD.test(deadline.trim())) { showError('마감일 형식은 YYYY-MM-DD 이에요'); return; }
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
        attachments,
        externalUrl: externalUrl.trim() || null,
        deadline: deadline.trim() || null,
        targetAudience,
        employmentType,
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
                style={[styles.ownerChip, { backgroundColor: colors.surface, borderColor: clubId === null ? colors.primary : colors.border }]}
              >
                <Text style={[styles.ownerChipText, { color: clubId === null ? colors.primary : colors.textSecondary }]}>개인 요청</Text>
              </Pressable>
              {myClubs.map((c: { id: string; name: string }) => {
                const on = clubId === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setClubId(c.id)}
                    style={[styles.ownerChip, { backgroundColor: colors.surface, borderColor: on ? colors.primary : colors.border }]}
                  >
                    <Text style={[styles.ownerChipText, { color: on ? colors.primary : colors.textSecondary }]} numberOfLines={1}>{c.name}</Text>
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
                  <Pressable key={d.day} onPress={() => toggleDay(d.day)} style={[styles.dayChip, { backgroundColor: colors.surface, borderColor: on ? colors.primary : colors.border }]}>
                    <Text style={[styles.dayChipText, { color: on ? colors.primary : colors.textSecondary }]}>{d.label}</Text>
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

          {/* 모집 조건 — 마감일·대상·고용 형태 */}
          <View style={styles.rowFields}>
            <View style={[styles.field, styles.flex1]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>모집 마감일 <Text style={{ color: colors.textLight }}>(비우면 상시)</Text></Text>
              <TextInput style={inputStyle} value={deadline} onChangeText={setDeadline} placeholder="2026-09-30" placeholderTextColor={colors.textLight} maxLength={10} autoCapitalize="none" />
            </View>
          </View>

          <View style={styles.rowFields}>
            <View style={[styles.field, styles.flex1]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>모집 대상</Text>
              <View style={styles.ownerRow}>
                {AUDIENCES.map((a) => {
                  const on = targetAudience === a.value;
                  return (
                    <Pressable key={a.value} onPress={() => setTargetAudience(on ? null : a.value)} style={[styles.ownerChip, { backgroundColor: colors.surface, borderColor: on ? colors.primary : colors.border }]}>
                      <Text style={[styles.ownerChipText, { color: on ? colors.primary : colors.textSecondary }]}>{a.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={[styles.field, styles.flex1]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>고용 형태</Text>
              <View style={styles.ownerRow}>
                {EMPLOYMENTS.map((e) => {
                  const on = employmentType === e.value;
                  return (
                    <Pressable key={e.value} onPress={() => setEmploymentType(on ? null : e.value)} style={[styles.ownerChip, { backgroundColor: colors.surface, borderColor: on ? colors.primary : colors.border }]}>
                      <Text style={[styles.ownerChipText, { color: on ? colors.primary : colors.textSecondary }]}>{e.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
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

          {/* 모집 요강 첨부 — 학교·센터 채용의 요강 PDF·한글 파일 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>모집 요강 첨부 <Text style={{ color: colors.textLight }}>(PDF·한글·워드, 최대 3개)</Text></Text>
            {attachments.map((a, i) => (
              <View key={a.url} style={[styles.docRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="document-attach-outline" size={16} color={colors.primary} />
                <Text style={[styles.docName, { color: colors.text }]} numberOfLines={1}>{a.name}</Text>
                <Pressable onPress={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))} hitSlop={8}>
                  <Ionicons name="close" size={15} color={colors.danger} />
                </Pressable>
              </View>
            ))}
            {attachments.length < 3 && (
              <Pressable onPress={addDoc} disabled={docUploading} style={[styles.docAdd, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                {docUploading ? <ActivityIndicator size="small" color={colors.primary} /> : (
                  <Text style={[styles.docAddText, { color: colors.textSecondary }]}>+ 요강 파일 추가</Text>
                )}
              </Pressable>
            )}
          </View>

          {/* 원문 링크 — 학교·센터 홈페이지 게시글, 제목·내용 가져오기 */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>원문 공고 링크 <Text style={{ color: colors.textLight }}>(선택 — 학교·센터 게시글)</Text></Text>
            <View style={styles.rowFields}>
              <TextInput
                style={[...inputStyle, styles.flex1]}
                value={externalUrl}
                onChangeText={setExternalUrl}
                placeholder="https://..."
                placeholderTextColor={colors.textLight}
                autoCapitalize="none"
                keyboardType="url"
                maxLength={500}
              />
              <Pressable onPress={scrapeFromUrl} disabled={scraping || !externalUrl.trim()} style={[styles.scrapeBtn, { backgroundColor: externalUrl.trim() ? colors.primary : colors.border }]}>
                {scraping ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.scrapeBtnText}>가져오기</Text>}
              </Pressable>
            </View>
            <Text style={[styles.docHint, { color: colors.textLight }]}>* 링크를 넣고 가져오기를 누르면 게시글 제목·내용으로 빈 칸을 채워드려요</Text>
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
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: 11, marginBottom: 6 },
  docName: { flex: 1, fontSize: 13, fontWeight: '600' },
  docAdd: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  docAddText: { fontSize: 13, fontWeight: '600' },
  scrapeBtn: { paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  scrapeBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  docHint: { fontSize: 11, fontWeight: '400', marginTop: 4, lineHeight: 15 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  field: { gap: 6 },
  rowFields: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  flex1: { flex: 1 },
  centerText: { textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '600' },
  hint: { fontSize: 12, fontWeight: '400', lineHeight: 16 },
  input: {
    ...typography.body2,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: Platform.OS === 'web' ? 12 : 11,
  },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  multilineShort: { minHeight: 72, textAlignVertical: 'top' },
  ownerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  ownerChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, maxWidth: 180 },
  ownerChipText: { fontSize: 13, fontWeight: '600' },
  dayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  dayChip: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  dayChipText: { fontSize: 14, fontWeight: '600' },
  negotiableRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: 10, padding: spacing.lg },
  photoWrap: { position: 'relative' },
  photoThumb: { width: 84, height: 84, borderRadius: 12 },
  photoRemove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  photoAdd: { width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 3 },
  photoAddText: { fontSize: 11, fontWeight: '500' },
  negotiableTitle: { fontSize: 14, fontWeight: '600' },
  bottomBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  saveBtn: { paddingVertical: 15, borderRadius: 12, alignItems: 'center', maxWidth: 560, width: '100%', alignSelf: 'center' },
  saveText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
