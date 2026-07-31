import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { paymentApi, cardBrandLabel, type PaymentMethod } from '../../services/payment';
import { showSuccess, showError } from '../../utils/feedback';

// ─────────────────────────────────────────────────────────────
// 결제 수단 관리 — 카드 등록(빌링키 발급), 목록, 기본 카드, 삭제.
// 카드번호는 서버·DB 어디에도 저장되지 않고 빌링키만 남는다(실 PG 원칙 동일).
// ─────────────────────────────────────────────────────────────

const confirmAsk = (title: string, message: string, onOk: () => void) => {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (window.confirm(`${title}\n${message}`)) onOk();
  } else {
    Alert.alert(title, message, [
      { text: '취소', style: 'cancel' },
      { text: '확인', style: 'destructive', onPress: onOk },
    ]);
  }
};

export default function PaymentMethods() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [birthOrBiz, setBirthOrBiz] = useState('');

  const load = useCallback(async () => {
    try {
      setCards(await paymentApi.cards());
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const register = async () => {
    if (saving) return;
    if (cardNumber.replace(/[\s-]/g, '').length < 15) { showError('카드번호를 확인해 주세요'); return; }
    setSaving(true);
    try {
      await paymentApi.registerCard({ cardNumber: cardNumber.trim(), expiry: expiry.trim(), birthOrBiz: birthOrBiz.trim() });
      showSuccess('카드가 등록됐어요');
      setShowForm(false);
      setCardNumber(''); setExpiry(''); setBirthOrBiz('');
      await load();
    } catch {
      /* 토스트는 인터셉터 */
    } finally {
      setSaving(false);
    }
  };

  const remove = (c: PaymentMethod) =>
    confirmAsk('카드 삭제', `${cardBrandLabel(c.cardBrand)} ****${c.cardLast4} 카드를 삭제할까요?`, async () => {
      try {
        await paymentApi.deleteCard(c.id);
        showSuccess('삭제했어요');
        await load();
      } catch { /* noop */ }
    });

  const makeDefault = async (c: PaymentMethod) => {
    try {
      await paymentApi.setDefaultCard(c.id);
      showSuccess('기본 카드로 설정했어요');
      await load();
    } catch { /* noop */ }
  };

  const inputStyle = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>결제 수단</Text>
        <Pressable onPress={() => setShowForm((v) => !v)} hitSlop={8}>
          <Text style={[styles.addLink, { color: colors.primary }]}>{showForm ? '닫기' : '+ 카드 등록'}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const, gap: spacing.md }}
          keyboardShouldPersistTaps="handled"
        >
          {showForm && (
            <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
              <Text style={[styles.formTitle, { color: colors.text }]}>카드 등록</Text>
              <TextInput
                style={inputStyle}
                value={cardNumber}
                onChangeText={setCardNumber}
                placeholder="카드번호 (숫자 16자리)"
                placeholderTextColor={colors.textLight}
                keyboardType="number-pad"
                maxLength={19}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput
                  style={[...inputStyle, { flex: 1, textAlign: 'center' }]}
                  value={expiry}
                  onChangeText={setExpiry}
                  placeholder="유효기간 MM/YY"
                  placeholderTextColor={colors.textLight}
                  maxLength={5}
                />
                <TextInput
                  style={[...inputStyle, { flex: 1, textAlign: 'center' }]}
                  value={birthOrBiz}
                  onChangeText={setBirthOrBiz}
                  placeholder="생년월일 6자리"
                  placeholderTextColor={colors.textLight}
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
              <Pressable onPress={register} disabled={saving} style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary }, (pressed || saving) && { opacity: 0.85 }]}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>등록하기</Text>}
              </Pressable>
              <Text style={[styles.hint, { color: colors.textLight }]}>
                테스트 환경 — 실제 청구는 발생하지 않아요. 카드번호는 저장되지 않고 결제용 빌링키만 발급돼요.
              </Text>
            </View>
          )}

          {cards.length === 0 && !showForm ? (
            <View style={styles.emptyBox}>
              <Ionicons name="card-outline" size={34} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>등록된 카드가 없어요</Text>
              <Text style={[styles.emptyHint, { color: colors.textLight }]}>카드를 등록하면 레슨비가 자동으로 결제돼요</Text>
              <Pressable onPress={() => setShowForm(true)} style={[styles.emptyBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.emptyBtnText}>+ 카드 등록</Text>
              </Pressable>
            </View>
          ) : (
            cards.map((c) => (
              <View key={c.id} style={[styles.cardRow, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
                <View style={[styles.cardIcon, { backgroundColor: colors.primary + '10' }]}>
                  <Ionicons name="card" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.cardName, { color: colors.text }]}>
                      {cardBrandLabel(c.cardBrand)} ****{c.cardLast4}
                    </Text>
                    {c.isDefault && (
                      <View style={[styles.defaultBadge, { backgroundColor: colors.primary + '14' }]}>
                        <Text style={[styles.defaultText, { color: colors.primary }]}>기본</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.cardMeta, { color: colors.textLight }]}>유효기간 {c.cardExpiry}</Text>
                </View>
                {!c.isDefault && (
                  <Pressable onPress={() => makeDefault(c)} hitSlop={6}>
                    <Text style={[styles.actionLink, { color: colors.textSecondary }]}>기본으로</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => remove(c)} hitSlop={6}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  addLink: { fontSize: 14, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  formCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.sm },
  formTitle: { fontSize: 15.5, fontWeight: '800' },
  input: {
    ...typography.body2, fontWeight: '600', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: spacing.lg, paddingVertical: Platform.OS === 'web' ? 12 : 11,
  },
  saveBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  saveText: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
  hint: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption },
  emptyBtn: { marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  cardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 15, fontWeight: '800' },
  defaultBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  defaultText: { fontSize: 10.5, fontWeight: '800' },
  cardMeta: { fontSize: 12, fontWeight: '600', marginTop: 3 },
  actionLink: { fontSize: 12.5, fontWeight: '700', textDecorationLine: 'underline' },
});
