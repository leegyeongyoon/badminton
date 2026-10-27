import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { useSocketEvent } from '../../hooks/useSocket';
import { useAuthStore } from '../../store/authStore';
import { gameBoardApi, type FeedbackRating, type FeedbackReason, type PendingFeedback } from '../../services/gameBoard';
import { showSuccess } from '../../utils/feedback';
import { spacing, radius, typography } from '../../constants/theme';

// ─────────────────────────────────────────────────────────────
// 회원 경기 후 반응 — 정모 판이 끝나면(서버 'game:feedbackAsk') 화면 아래에 "방금 경기 어땠어요?".
// 😊/🙂는 한 번 누르면 끝, 😣는 이유 하나 더(급수가 안 맞음·같은 사람·오래 기다림). AI 학습 현황과
// 설정 추천에 쓰인다. 앱을 다시 열었을 때도 40분 안의 끝난 판이면 한 번 물어본다. ✕로 넘기면 그 판은 다시 안 물음.
// ─────────────────────────────────────────────────────────────

const REASONS: { v: FeedbackReason | null; label: string }[] = [
  { v: 'TOO_HARD', label: '상대가 너무 셌어요' },
  { v: 'TOO_EASY', label: '너무 쉬웠어요' },
  { v: 'REPEAT', label: '같은 사람과 또 쳤어요' },
  { v: 'WAIT', label: '너무 오래 기다렸어요' },
  { v: null, label: '그냥 아쉬웠어요' },
];

export function GameFeedbackPrompt() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [pending, setPending] = useState<PendingFeedback | null>(null);
  const [askReason, setAskReason] = useState(false);
  const [skipped] = useState(() => new Set<string>());

  const check = useCallback(
    (turnId?: string) => {
      if (!isAuthenticated) return;
      gameBoardApi
        .pendingFeedback(turnId)
        .then(({ data }) => {
          const p = data?.pending;
          if (p && !skipped.has(p.turnId)) {
            setPending(p);
            setAskReason(false);
          }
        })
        .catch(() => {});
    },
    [isAuthenticated, skipped],
  );

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
    return () => sub.remove();
  }, [check]);
  useSocketEvent<{ turnId: string }>('game:feedbackAsk', (d) => { if (d?.turnId) check(d.turnId); });

  const send = (rating: FeedbackRating, reason?: FeedbackReason | null) => {
    if (!pending) return;
    const turnId = pending.turnId;
    skipped.add(turnId);
    setPending(null);
    gameBoardApi
      .submitFeedback(turnId, rating, reason ?? undefined)
      .then(() => showSuccess('고마워요! 다음 게임 짤 때 참고할게요'))
      .catch(() => {});
  };

  if (!pending) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + spacing.md }]}>
      <View style={[styles.card, shadows?.lg, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.head}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.title, { color: colors.text }]}>
              {askReason ? '어떤 점이 아쉬웠어요?' : `방금 ${pending.courtName ? `${pending.courtName} ` : ''}경기 어땠어요?`}
            </Text>
            {!askReason && pending.others.length > 0 && (
              <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>{`함께 친 사람: ${pending.others.join(' · ')}`}</Text>
            )}
          </View>
          <Pressable
            onPress={() => { skipped.add(pending.turnId); setPending(null); }}
            hitSlop={10}
            accessibilityLabel="경기 반응 남기지 않기"
          >
            <Text style={[styles.close, { color: colors.textLight }]}>✕</Text>
          </Pressable>
        </View>
        {!askReason ? (
          <View style={styles.row}>
            {([
              ['GOOD', '😊', '좋았어요'],
              ['OK', '🙂', '괜찮았어요'],
              ['BAD', '😣', '아쉬웠어요'],
            ] as const).map(([v, emoji, label]) => (
              <Pressable
                key={v}
                onPress={() => (v === 'BAD' ? setAskReason(true) : send(v))}
                style={[styles.big, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={`경기 반응 ${label}`}
              >
                <Text style={styles.emoji}>{emoji}</Text>
                <Text style={[styles.bigLabel, { color: colors.text }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.reasons}>
            {REASONS.map((r) => (
              <Pressable
                key={r.label}
                onPress={() => send('BAD', r.v)}
                style={[styles.reason, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={`아쉬운 이유 ${r.label}`}
              >
                <Text style={[styles.reasonText, { color: colors.text }]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: spacing.md, zIndex: 50 },
  card: { width: '100%', maxWidth: 480, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { fontSize: 15, fontWeight: '800' },
  sub: { ...typography.caption, marginTop: 2 },
  close: { fontSize: 16, paddingHorizontal: 4 },
  row: { flexDirection: 'row', gap: spacing.sm },
  big: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', gap: 2 },
  emoji: { fontSize: 24 },
  bigLabel: { ...typography.caption, fontWeight: '700' },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reason: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 8 },
  reasonText: { ...typography.caption, fontWeight: '700' },
});
