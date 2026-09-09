import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useSocketEvent } from '../../hooks/useSocket';
import { typography, spacing, radius } from '../../constants/theme';
import { pollApi, type Poll } from '../../services/poll';

// ─────────────────────────────────────────────────────────────
// 정모 투표 카드 — 현황판/내현황에 얹는다. 참여자는 탭 한 번으로 투표,
// 운영진(canManage)은 마감·삭제 + 명단 확인. 소켓 신호에 refetch.
// ─────────────────────────────────────────────────────────────

export function SessionPolls({ clubSessionId, canManage }: { clubSessionId: string; canManage?: boolean }) {
  const { colors, shadows } = useTheme();
  const [polls, setPolls] = useState<Poll[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // pollId 진행중
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setPolls(await pollApi.list(clubSessionId));
    } catch {
      /* noop */
    } finally {
      loadedRef.current = true;
    }
  }, [clubSessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // 실시간: 이 정모 투표 변경 신호 오면 디바운스 refetch.
  const debTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChange = useCallback(
    (d: { clubSessionId: string }) => {
      if (d.clubSessionId !== clubSessionId) return;
      if (debTimer.current) clearTimeout(debTimer.current);
      debTimer.current = setTimeout(load, 500);
    },
    [clubSessionId, load],
  );
  useSocketEvent('poll:created', onChange);
  useSocketEvent('poll:updated', onChange);
  useSocketEvent('poll:closed', onChange);

  const vote = async (poll: Poll, optionIndex: number) => {
    if (poll.status !== 'OPEN' || busy) return;
    setBusy(poll.id);
    // 낙관적: 즉시 반영 후 서버 응답으로 교체
    try {
      const updated = await pollApi.vote(poll.id, optionIndex);
      setPolls((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      await load();
    } finally {
      setBusy(null);
    }
  };

  const close = async (poll: Poll) => {
    setBusy(poll.id);
    try {
      const updated = await pollApi.close(poll.id);
      setPolls((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      /* noop */
    } finally {
      setBusy(null);
    }
  };

  const remove = async (poll: Poll) => {
    setBusy(poll.id);
    try {
      await pollApi.remove(poll.id);
      setPolls((prev) => prev.filter((p) => p.id !== poll.id));
    } catch {
      /* noop */
    } finally {
      setBusy(null);
    }
  };

  if (polls.length === 0) return null;

  return (
    <View style={{ gap: spacing.sm }}>
      {polls.map((poll) => {
        const total = poll.totalVoters;
        const closed = poll.status === 'CLOSED';
        return (
          <View key={poll.id} style={[styles.card, shadows.sm, { backgroundColor: colors.surface, borderColor: closed ? colors.border : colors.primary }]}>
            <View style={styles.head}>
              <Ionicons name="bar-chart" size={16} color={closed ? colors.textLight : colors.primary} />
              <Text style={[styles.q, { color: colors.text }]} numberOfLines={2}>{poll.question}</Text>
              {closed && <Text style={[styles.closedTag, { color: colors.textLight }]}>마감</Text>}
            </View>

            {poll.options.map((opt) => {
              const picked = poll.myVotes.includes(opt.index);
              const pct = total > 0 ? Math.round((opt.count / total) * 100) : 0;
              const showResult = closed || poll.myVotes.length > 0; // 투표 후/마감 시 결과 표시
              return (
                <Pressable
                  key={opt.index}
                  onPress={() => vote(poll, opt.index)}
                  disabled={closed || busy === poll.id}
                  style={[styles.opt, { borderColor: picked ? colors.primary : colors.border }]}
                >
                  {/* 결과 바 배경 */}
                  {showResult && (
                    <View style={[styles.bar, { width: `${pct}%`, backgroundColor: picked ? colors.primaryBg : colors.surfaceSecondary }]} />
                  )}
                  <View style={styles.optRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                      {picked && <Ionicons name="checkmark-circle" size={16} color={colors.primary} />}
                      <Text style={[styles.optText, { color: colors.text, fontWeight: picked ? '800' : '600' }]} numberOfLines={1}>
                        {opt.text}
                      </Text>
                    </View>
                    {showResult && (
                      <Text style={[styles.optCount, { color: picked ? colors.primary : colors.textSecondary }]}>
                        {opt.count}명 · {pct}%
                      </Text>
                    )}
                  </View>
                  {/* 운영진: 익명 아니면 명단 */}
                  {canManage && opt.voters && opt.voters.length > 0 && (
                    <Text style={[styles.voters, { color: colors.textLight }]} numberOfLines={2}>
                      {opt.voters.map((v) => v.name).join(', ')}
                    </Text>
                  )}
                </Pressable>
              );
            })}

            <View style={styles.footer}>
              <Text style={[styles.meta, { color: colors.textLight }]}>
                {total}명 참여{poll.anonymous ? ' · 익명' : ''}{poll.multi ? ' · 복수선택' : ''}
                {!closed && poll.myVotes.length === 0 ? ' · 탭해서 투표' : ''}
              </Text>
              {canManage && (
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  {!closed && (
                    <Pressable onPress={() => close(poll)} hitSlop={6} disabled={busy === poll.id}>
                      <Text style={[styles.action, { color: colors.primary }]}>마감</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => remove(poll)} hitSlop={6} disabled={busy === poll.id}>
                    <Text style={[styles.action, { color: colors.textLight }]}>삭제</Text>
                  </Pressable>
                </View>
              )}
              {busy === poll.id && <ActivityIndicator size="small" color={colors.primary} />}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  q: { flex: 1, fontSize: 15, fontWeight: '800' },
  closedTag: { fontSize: 11, fontWeight: '700' },
  opt: { borderWidth: 1.5, borderRadius: radius.md, overflow: 'hidden', marginTop: 6 },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  optRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 11 },
  optText: { fontSize: 14 },
  optCount: { fontSize: 12.5, fontWeight: '700' },
  voters: { fontSize: 11, paddingHorizontal: spacing.md, paddingBottom: 8, marginTop: -2 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  meta: { ...typography.caption },
  action: { fontSize: 12.5, fontWeight: '800' },
});
