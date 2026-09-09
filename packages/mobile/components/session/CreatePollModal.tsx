import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { pollApi } from '../../services/poll';
import { showSuccess } from '../../utils/feedback';

// 정모 투표 생성 모달(운영진). 뒤풀이·다음 요일 등 빠른 프리셋 + 자유 입력.
const PRESETS = [
  { q: '오늘 뒤풀이 갈 사람? 🍺', opts: ['갈래요', '다음에'] },
  { q: '다음 정모 언제가 좋아요?', opts: ['평일 저녁', '주말 오전', '주말 오후'] },
  { q: '코트 몇 개 잡을까요?', opts: ['2개', '3개', '4개'] },
];

export function CreatePollModal({ clubSessionId, onClose }: { clubSessionId: string; onClose: () => void }) {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [anonymous, setAnonymous] = useState(false);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setQuestion(p.q);
    setOptions([...p.opts, '']);
  };
  const setOpt = (i: number, v: string) => setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  const addOpt = () => setOptions((prev) => (prev.length >= 8 ? prev : [...prev, '']));

  const submit = async () => {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || opts.length < 2 || busy) return;
    setBusy(true);
    try {
      await pollApi.create(clubSessionId, { question: question.trim(), options: opts, anonymous, multi });
      showSuccess('투표를 열었어요 — 체크인한 회원에게 알림이 갔어요');
      onClose();
    } catch {
      /* 인터셉터 토스트 */
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = question.trim().length > 0 && options.filter((o) => o.trim()).length >= 2;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>정모 투표 만들기</Text>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={colors.textLight} /></Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}>
            {/* 프리셋 */}
            <View style={styles.presets}>
              {PRESETS.map((p) => (
                <Pressable key={p.q} onPress={() => applyPreset(p)} style={[styles.preset, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.presetText, { color: colors.textSecondary }]} numberOfLines={1}>{p.q}</Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={[styles.qInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
              value={question}
              onChangeText={setQuestion}
              placeholder="질문 (예: 오늘 뒤풀이 갈 사람?)"
              placeholderTextColor={colors.textLight}
              maxLength={100}
            />

            {options.map((o, i) => (
              <View key={i} style={styles.optRow}>
                <TextInput
                  style={[styles.optInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
                  value={o}
                  onChangeText={(v) => setOpt(i, v)}
                  placeholder={`선택지 ${i + 1}`}
                  placeholderTextColor={colors.textLight}
                  maxLength={40}
                />
                {options.length > 2 && (
                  <Pressable onPress={() => setOptions((prev) => prev.filter((_, idx) => idx !== i))} hitSlop={8}>
                    <Ionicons name="remove-circle-outline" size={22} color={colors.textLight} />
                  </Pressable>
                )}
              </View>
            ))}
            {options.length < 8 && (
              <Pressable onPress={addOpt} style={styles.addOpt}>
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text style={[styles.addOptText, { color: colors.primary }]}>선택지 추가</Text>
              </Pressable>
            )}

            {/* 옵션 토글 */}
            <View style={styles.toggles}>
              <Pressable onPress={() => setAnonymous((v) => !v)} style={styles.toggle}>
                <Ionicons name={anonymous ? 'checkbox' : 'square-outline'} size={20} color={anonymous ? colors.primary : colors.textLight} />
                <Text style={[styles.toggleText, { color: colors.textSecondary }]}>익명 (명단 숨김)</Text>
              </Pressable>
              <Pressable onPress={() => setMulti((v) => !v)} style={styles.toggle}>
                <Ionicons name={multi ? 'checkbox' : 'square-outline'} size={20} color={multi ? colors.primary : colors.textLight} />
                <Text style={[styles.toggleText, { color: colors.textSecondary }]}>복수 선택</Text>
              </Pressable>
            </View>
          </ScrollView>

          <Pressable onPress={submit} disabled={!canSubmit || busy} style={[styles.cta, { backgroundColor: colors.primary, opacity: !canSubmit || busy ? 0.5 : 1 }, shadows.sm]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>투표 열기 — 체크인 회원에게 알림</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, maxHeight: '88%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { fontSize: 18, fontWeight: '800' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  preset: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, maxWidth: '100%' },
  presetText: { fontSize: 12.5, fontWeight: '600' },
  qInput: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13, fontSize: 15, fontWeight: '700' },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optInput: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14 },
  addOpt: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  addOptText: { fontSize: 13, fontWeight: '700' },
  toggles: { flexDirection: 'row', gap: spacing.lg, marginTop: 4 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleText: { fontSize: 13, fontWeight: '600' },
  cta: { borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center', marginTop: spacing.sm },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
