import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { Switch } from '../../components/ui/Switch';
import { PhotoPickerField } from '../../components/ui/PhotoPickerField';
import { RegionSelect } from '../../components/market/RegionSelect';
import { coachApi } from '../../services/coach';
import { showError, showSuccess } from '../../utils/feedback';

// ─────────────────────────────────────────────────────────────
// 내 코치 프로필 — 코치가 직접 등록·관리(숨고식). 등록 즉시 '코치 찾기'에 노출.
// ─────────────────────────────────────────────────────────────

export default function CoachEdit() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isNew, setIsNew] = useState(true);
  const [certified, setCertified] = useState(false);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [intro, setIntro] = useState('');
  const [career, setCareer] = useState('');
  const [regions, setRegions] = useState('');
  const [regionCodes, setRegionCodes] = useState<string[]>([]);
  const [pricePerMonth, setPricePerMonth] = useState('');
  const [pricePerSession, setPricePerSession] = useState('');
  const [availableTimes, setAvailableTimes] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    coachApi
      .me()
      .then((p) => {
        if (p) {
          setIsNew(false);
          setCertified(p.certified);
          setPhotoUrl(p.photoUrl);
          setDisplayName(p.displayName);
          setIntro(p.intro ?? '');
          setCareer(p.career ?? '');
          setRegions(p.regions ?? '');
          setRegionCodes(p.regionCodes ?? []);
          setPricePerMonth(p.pricePerMonth != null ? String(p.pricePerMonth) : '');
          setPricePerSession(p.pricePerSession != null ? String(p.pricePerSession) : '');
          setAvailableTimes(p.availableTimes ?? '');
          setActive(p.active);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!displayName.trim()) {
      showError('코치 이름을 입력해 주세요');
      return;
    }
    setSaving(true);
    try {
      await coachApi.upsertMe({
        displayName: displayName.trim(),
        photoUrl,
        intro: intro.trim() || null,
        career: career.trim() || null,
        regions: regions.trim() || null,
        regionCodes,
        pricePerMonth: pricePerMonth.trim() ? Number(pricePerMonth.replace(/[^0-9]/g, '')) : null,
        pricePerSession: pricePerSession.trim() ? Number(pricePerSession.replace(/[^0-9]/g, '')) : null,
        availableTimes: availableTimes.trim() || null,
        active,
      });
      showSuccess(isNew ? '코치 프로필이 등록됐어요' : '코치 프로필을 저장했어요');
      router.back();
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
        <Text style={[styles.title, { color: colors.text }]}>{isNew ? '코치로 활동하기' : '내 코치 프로필'}</Text>
        {certified && (
          <View style={[styles.certBadge, { backgroundColor: colors.primary + '18' }]}>
            <Text style={[styles.certText, { color: colors.primary }]}>인증 코치</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 120, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const, gap: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {isNew && (
            <Text style={[styles.introHint, { color: colors.textSecondary }]}>
              프로필을 등록하면 '코치 찾기'에 바로 노출되고, 모임 운영진이 채팅으로 레슨을 문의해요
            </Text>
          )}

          <View style={{ alignItems: 'center' }}>
            <PhotoPickerField value={photoUrl} onChange={setPhotoUrl} size={120} label="프로필 사진" />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>이름 *</Text>
            <TextInput style={inputStyle} value={displayName} onChangeText={setDisplayName} placeholder="레슨에서 쓸 이름" placeholderTextColor={colors.textLight} maxLength={30} />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>한 줄 소개</Text>
            <TextInput style={inputStyle} value={intro} onChangeText={setIntro} placeholder="전 실업팀 선수 출신, 15년 경력" placeholderTextColor={colors.textLight} maxLength={200} />
          </View>

          {/* 경력은 원티드식 이력서(구조화 엔트리)에서 관리 — 여기선 진입 링크만. */}
          <Pressable
            onPress={() => {
              if (isNew) {
                showError('프로필을 먼저 등록하면 이력서를 작성할 수 있어요');
                return;
              }
              router.push('/coach/resume' as never);
            }}
            style={({ pressed }) => [styles.resumeLink, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.85 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.resumeLinkTitle, { color: colors.text }]}>이력서 관리</Text>
              <Text style={[styles.resumeLinkHint, { color: colors.textLight }]}>
                {isNew
                  ? '프로필 등록 후 선수·지도 경력, 자격증을 채울 수 있어요'
                  : '선수·지도 경력, 학력, 자격증, 수상을 관리해요 — 공고 지원 시 그대로 노출'}
              </Text>
            </View>
            <Text style={[styles.resumeLinkGo, { color: colors.primary }]}>{isNew ? '' : '열기'}</Text>
          </Pressable>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>활동 지역 <Text style={{ color: colors.textLight }}>(시/도 복수 선택 — 공고·검색 필터 기준)</Text></Text>
            <RegionSelect value={regionCodes} onChange={setRegionCodes} />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>상세 활동 지역 <Text style={{ color: colors.textLight }}>(선택)</Text></Text>
            <TextInput style={inputStyle} value={regions} onChangeText={setRegions} placeholder="송파구, 하남 미사 등" placeholderTextColor={colors.textLight} maxLength={200} />
          </View>

          <View style={styles.rowFields}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>월 레슨비(원)</Text>
              <TextInput style={inputStyle} value={pricePerMonth} onChangeText={setPricePerMonth} placeholder="200000" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={9} />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>회당 레슨비(원)</Text>
              <TextInput style={inputStyle} value={pricePerSession} onChangeText={setPricePerSession} placeholder="50000" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={9} />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>레슨 가능 시간</Text>
            <TextInput
              style={[...inputStyle, styles.multilineShort]}
              value={availableTimes}
              onChangeText={setAvailableTimes}
              placeholder={'평일 저녁 7시 이후\n주말 오전'}
              placeholderTextColor={colors.textLight}
              multiline
              maxLength={500}
            />
          </View>

          {!isNew && (
            <View style={[styles.activeRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.activeTitle, { color: colors.text }]}>프로필 공개</Text>
                <Text style={[styles.activeHint, { color: colors.textLight }]}>끄면 '코치 찾기'에서 숨겨져요</Text>
              </View>
              <Switch value={active} onValueChange={setActive} />
            </View>
          )}
        </ScrollView>
      )}

      {!loading && (
        <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary }, (pressed || saving) && { opacity: 0.85 }]}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.saveText}>{isNew ? '코치 프로필 등록' : '저장'}</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  certBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  certText: { fontSize: 11, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  introHint: { ...typography.body2, lineHeight: 20, textAlign: 'center' },
  field: { gap: 6 },
  rowFields: { flexDirection: 'row', gap: spacing.md },
  label: { fontSize: 13, fontWeight: '700' },
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
  resumeLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: 14, padding: spacing.lg },
  resumeLinkTitle: { fontSize: 15, fontWeight: '800' },
  resumeLinkHint: { fontSize: 12, fontWeight: '600', marginTop: 3, lineHeight: 17 },
  resumeLinkGo: { fontSize: 13.5, fontWeight: '800' },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: 14, padding: spacing.lg },
  activeTitle: { fontSize: 15, fontWeight: '800' },
  activeHint: { fontSize: 12, marginTop: 2 },
  bottomBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  saveBtn: { paddingVertical: 15, borderRadius: 14, alignItems: 'center', maxWidth: 560, width: '100%', alignSelf: 'center' },
  saveText: { fontSize: 15.5, fontWeight: '800', color: '#fff' },
});
