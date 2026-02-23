import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCheckinStore } from '../../store/checkinStore';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert } from '../../utils/alert';
import api from '../../services/api';
import { recruitmentApi } from '../../services/recruitment';

interface Player {
  userId: string;
  userName: string;
  status: string;
}

interface Court {
  id: string;
  name: string;
  status: string;
}

const STEPS = ['유형', '멤버', '코트'];

export default function CreateRecruitmentScreen() {
  const router = useRouter();
  const { status: checkinStatus } = useCheckinStore();
  const facilityId = checkinStatus?.facilityId;

  const [step, setStep] = useState(0);
  const [gameType, setGameType] = useState<'DOUBLES' | 'LESSON'>('DOUBLES');
  const [message, setMessage] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [targetCourtId, setTargetCourtId] = useState<string | undefined>();
  const [players, setPlayers] = useState<Player[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (facilityId) {
      loadData();
    }
  }, [facilityId]);

  const loadData = async () => {
    try {
      const [playersRes, courtsRes] = await Promise.all([
        api.get(`/facilities/${facilityId}/players`),
        api.get(`/facilities/${facilityId}/courts`),
      ]);
      setPlayers((playersRes.data || []).filter((p: Player) => p.status === 'AVAILABLE'));
      setCourts((courtsRes.data || []).filter((c: Court) => c.status !== 'MAINTENANCE'));
    } catch { /* silent */ }
  };

  const toggleMember = (userId: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else if (next.size < 3) next.add(userId);
      return next;
    });
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      await recruitmentApi.create(facilityId!, {
        gameType,
        targetCourtId,
        message: message || undefined,
        initialMemberIds: selectedMembers.size > 0 ? Array.from(selectedMembers) : undefined,
      });
      router.back();
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.message || '모집 생성 실패');
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    if (step === 0) return true; // game type always valid
    if (step === 1) return true; // members are optional
    return true;
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleCreate();
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    } else {
      router.back();
    }
  };

  if (!facilityId) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>체크인 후 사용 가능</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Step indicator */}
      <View style={styles.stepIndicator}>
        {STEPS.map((label, idx) => (
          <View key={idx} style={styles.stepItem}>
            <View style={[
              styles.stepDot,
              idx < step && styles.stepDotCompleted,
              idx === step && styles.stepDotActive,
            ]}>
              {idx < step ? (
                <Text style={styles.stepCheckmark}>✓</Text>
              ) : (
                <Text style={[styles.stepNumber, idx === step && styles.stepNumberActive]}>
                  {idx + 1}
                </Text>
              )}
            </View>
            <Text style={[
              styles.stepLabel,
              idx === step && styles.stepLabelActive,
            ]}>
              {label}
            </Text>
            {idx < STEPS.length - 1 && (
              <View style={[styles.stepLine, idx < step && styles.stepLineCompleted]} />
            )}
          </View>
        ))}
      </View>

      <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollContentInner}>
        {/* Step 0: Game type + message */}
        {step === 0 && (
          <>
            <Text style={styles.stepTitle}>게임 유형을 선택하세요</Text>
            <View style={styles.typeRow}>
              <TouchableOpacity
                style={[styles.typeCard, gameType === 'DOUBLES' && styles.typeCardActive]}
                onPress={() => setGameType('DOUBLES')}
              >
                <Text style={styles.typeIcon}>🏸</Text>
                <Text style={[styles.typeLabel, gameType === 'DOUBLES' && styles.typeLabelActive]}>
                  {Strings.court.gameType.DOUBLES}
                </Text>
                <Text style={styles.typeDesc}>4명 복식</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeCard, gameType === 'LESSON' && styles.typeCardActive]}
                onPress={() => setGameType('LESSON')}
              >
                <Text style={styles.typeIcon}>📚</Text>
                <Text style={[styles.typeLabel, gameType === 'LESSON' && styles.typeLabelActive]}>
                  {Strings.court.gameType.LESSON}
                </Text>
                <Text style={styles.typeDesc}>레슨 모드</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>메시지 (선택)</Text>
            <TextInput
              style={styles.messageInput}
              placeholder="함께 치실 분!"
              placeholderTextColor={Colors.textLight}
              value={message}
              onChangeText={setMessage}
              maxLength={100}
            />
          </>
        )}

        {/* Step 1: Member selection */}
        {step === 1 && (
          <>
            <Text style={styles.stepTitle}>초기 멤버를 선택하세요</Text>
            <Text style={styles.stepSubtitle}>
              본인을 포함하여 최대 4명 / 현재 {selectedMembers.size}명 선택 (선택사항)
            </Text>
            {players.length === 0 && (
              <Text style={styles.noPlayersText}>대기 중인 플레이어가 없습니다</Text>
            )}
            {players.map((p) => (
              <TouchableOpacity
                key={p.userId}
                style={[styles.selectRow, selectedMembers.has(p.userId) && styles.selectRowActive]}
                onPress={() => toggleMember(p.userId)}
              >
                <View style={[styles.checkbox, selectedMembers.has(p.userId) && styles.checkboxActive]}>
                  {selectedMembers.has(p.userId) && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.selectName}>{p.userName}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Step 2: Court selection */}
        {step === 2 && (
          <>
            <Text style={styles.stepTitle}>코트를 선택하세요</Text>
            <Text style={styles.stepSubtitle}>자동으로 빈 코트를 배정받을 수도 있습니다</Text>

            <TouchableOpacity
              style={[styles.courtOption, !targetCourtId && styles.courtOptionActive]}
              onPress={() => setTargetCourtId(undefined)}
            >
              <View style={[styles.courtRadio, !targetCourtId && styles.courtRadioActive]}>
                {!targetCourtId && <View style={styles.courtRadioInner} />}
              </View>
              <View>
                <Text style={[styles.courtOptionText, !targetCourtId && styles.courtOptionTextActive]}>
                  자동 배정
                </Text>
                <Text style={styles.courtOptionDesc}>빈 코트가 자동으로 배정됩니다</Text>
              </View>
            </TouchableOpacity>
            {courts.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.courtOption, targetCourtId === c.id && styles.courtOptionActive]}
                onPress={() => setTargetCourtId(c.id)}
              >
                <View style={[styles.courtRadio, targetCourtId === c.id && styles.courtRadioActive]}>
                  {targetCourtId === c.id && <View style={styles.courtRadioInner} />}
                </View>
                <Text style={[styles.courtOptionText, targetCourtId === c.id && styles.courtOptionTextActive]}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}

            {/* Summary */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>모집 요약</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>게임 유형</Text>
                <Text style={styles.summaryValue}>
                  {Strings.court.gameType[gameType as keyof typeof Strings.court.gameType]}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>초기 멤버</Text>
                <Text style={styles.summaryValue}>{selectedMembers.size}명</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>코트</Text>
                <Text style={styles.summaryValue}>
                  {targetCourtId ? courts.find((c) => c.id === targetCourtId)?.name : '자동 배정'}
                </Text>
              </View>
              {message && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>메시지</Text>
                  <Text style={styles.summaryValue}>"{message}"</Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Bottom navigation buttons */}
      <View style={styles.bottomButtons}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>
            {step === 0 ? Strings.common.cancel : '이전'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.nextButton, loading && { opacity: 0.6 }]}
          onPress={handleNext}
          disabled={!canProceed() || loading}
        >
          <Text style={styles.nextButtonText}>
            {step < STEPS.length - 1 ? '다음' : (loading ? '생성중...' : '모집 시작')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  // Step indicator
  stepIndicator: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.divider,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDotActive: {
    backgroundColor: Colors.primary,
  },
  stepDotCompleted: {
    backgroundColor: Colors.secondary,
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textLight,
  },
  stepNumberActive: {
    color: '#fff',
  },
  stepCheckmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  stepLabel: {
    fontSize: 12,
    color: Colors.textLight,
    marginLeft: 4,
    fontWeight: '500',
  },
  stepLabelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  stepLine: {
    width: 24,
    height: 2,
    backgroundColor: Colors.divider,
    marginHorizontal: 6,
  },
  stepLineCompleted: {
    backgroundColor: Colors.secondary,
  },
  // Content
  scrollContent: {
    flex: 1,
  },
  scrollContentInner: {
    padding: 16,
    paddingBottom: 40,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 6,
  },
  stepSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  // Game type cards
  typeRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  typeCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
    gap: 6,
  },
  typeCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  typeIcon: {
    fontSize: 28,
  },
  typeLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  typeLabelActive: {
    color: Colors.primary,
  },
  typeDesc: {
    fontSize: 12,
    color: Colors.textLight,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 8,
  },
  messageInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  // Member selection
  noPlayersText: {
    fontSize: 14,
    color: Colors.textLight,
    textAlign: 'center',
    paddingVertical: 20,
    fontStyle: 'italic',
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
    gap: 10,
  },
  selectRowActive: {
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  selectName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
  },
  // Court selection
  courtOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    gap: 12,
  },
  courtOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  courtRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  courtRadioActive: {
    borderColor: Colors.primary,
  },
  courtRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  courtOptionText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  courtOptionTextActive: {
    color: Colors.primary,
    fontWeight: '600',
  },
  courtOptionDesc: {
    fontSize: 12,
    color: Colors.textLight,
    marginTop: 2,
  },
  // Summary
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  // Bottom buttons
  bottomButtons: {
    flexDirection: 'row',
    padding: 16,
    gap: 10,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  backButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  nextButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
