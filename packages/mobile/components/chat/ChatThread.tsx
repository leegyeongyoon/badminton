import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';

// ─────────────────────────────────────────────────────────────
// 채팅 스레드(공용 뷰) — 게스트 문의/운영진 답장 양쪽에서 쓰는 말풍선 + 입력창.
// 데이터/전송/폴링은 부모가 담당하고, 이 컴포넌트는 표시와 입력만.
// mineIsStaff: 내가 운영진이면 true(오른쪽=운영진), 게스트면 false(오른쪽=게스트).
// ─────────────────────────────────────────────────────────────

export interface ChatBubble {
  id: string;
  fromStaff: boolean;
  authorName: string;
  text: string;
  createdAt: string;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = hh < 12 ? '오전' : '오후';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${ap} ${h12}:${mm}`;
}

export function ChatThread({
  messages,
  mineIsStaff,
  loading,
  sending,
  disabled,
  disabledHint,
  placeholder,
  emptyHint,
  onSend,
}: {
  messages: ChatBubble[];
  mineIsStaff: boolean;
  loading?: boolean;
  sending?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  placeholder?: string;
  emptyHint?: string;
  onSend: (text: string) => void;
}) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length]);

  const submit = () => {
    const body = text.trim();
    if (!body || sending || disabled) return;
    onSend(body);
    setText('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, maxWidth: 640, width: '100%', alignSelf: 'center' }}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <View style={styles.emptyBox}>
              <Ionicons name="chatbubbles-outline" size={30} color={colors.textLight} />
              <Text style={[styles.emptyText, { color: colors.textLight }]}>
                {emptyHint || '메시지를 보내 대화를 시작하세요'}
              </Text>
            </View>
          )}
          {messages.map((m, i) => {
            const mine = m.fromStaff === mineIsStaff;
            const prev = messages[i - 1];
            const showName = !mine && (!prev || prev.fromStaff !== m.fromStaff);
            return (
              <View key={m.id} style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
                <View style={{ maxWidth: '78%' }}>
                  {showName && <Text style={[styles.author, { color: colors.textLight }]}>{m.authorName}</Text>}
                  <View style={styles.bubbleLine}>
                    {mine && <Text style={[styles.time, { color: colors.textLight }]}>{timeLabel(m.createdAt)}</Text>}
                    <View
                      style={[
                        styles.bubble,
                        mine
                          ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 }
                          : { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
                      ]}
                    >
                      <Text style={[styles.bubbleText, { color: mine ? '#fff' : colors.text }]}>{m.text}</Text>
                    </View>
                    {!mine && <Text style={[styles.time, { color: colors.textLight }]}>{timeLabel(m.createdAt)}</Text>}
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {disabled ? (
        <View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <Text style={[styles.disabledHint, { color: colors.textLight }]}>{disabledHint || '대화가 종료되었어요'}</Text>
        </View>
      ) : (
        <View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.background }]}
            value={text}
            onChangeText={setText}
            placeholder={placeholder || '메시지 입력'}
            placeholderTextColor={colors.textLight}
            multiline
            maxLength={1000}
            onSubmitEditing={submit}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={submit}
            disabled={!text.trim() || sending}
            style={[styles.sendBtn, { backgroundColor: text.trim() && !sending ? colors.primary : colors.border }]}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyText: { ...typography.body2, textAlign: 'center' },
  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  author: { ...typography.caption, fontWeight: '700', marginBottom: 2, marginLeft: 4 },
  bubbleLine: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  bubble: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd, borderRadius: 18 },
  bubbleText: { ...typography.body2, lineHeight: 20 },
  time: { fontSize: 10, marginBottom: 2 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, maxWidth: 640, width: '100%', alignSelf: 'center' },
  input: { flex: 1, ...typography.body2, fontWeight: '600', borderRadius: 20, paddingHorizontal: spacing.lg, paddingVertical: 11, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  disabledHint: { ...typography.caption, textAlign: 'center', flex: 1, paddingVertical: spacing.sm },
});
