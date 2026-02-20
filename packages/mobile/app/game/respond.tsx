import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { gameApi } from '../../services/game';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';

export default function GameRespondScreen() {
  const { gameId, courtName } = useLocalSearchParams<{
    gameId: string;
    courtName: string;
  }>();
  const [responding, setResponding] = useState(false);

  const handleRespond = async (accept: boolean) => {
    if (!gameId) return;
    setResponding(true);
    try {
      await gameApi.respond(gameId, accept);
      Alert.alert(
        accept ? '수락 완료' : '거절 완료',
        accept ? '게임 호출을 수락했습니다' : '게임 호출을 거절했습니다',
        [{ text: Strings.common.confirm, onPress: () => router.back() }],
      );
    } catch (err: any) {
      Alert.alert('오류', err.response?.data?.error || '응답에 실패했습니다');
    } finally {
      setResponding(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: '게임 호출' }} />
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.icon}>🏸</Text>
          <Text style={styles.title}>게임 호출!</Text>
          <Text style={styles.court}>{courtName || '코트'}</Text>
          <Text style={styles.description}>게임에 참여하시겠습니까?</Text>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.declineButton]}
              onPress={() => handleRespond(false)}
              disabled={responding}
            >
              <Text style={styles.declineText}>{Strings.game.decline}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.acceptButton]}
              onPress={() => handleRespond(true)}
              disabled={responding}
            >
              <Text style={styles.acceptText}>{Strings.game.accept}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  icon: {
    fontSize: 56,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 8,
  },
  court: {
    fontSize: 18,
    color: Colors.primary,
    fontWeight: '600',
    marginBottom: 8,
  },
  description: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginBottom: 32,
  },
  actions: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
  },
  button: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  declineButton: {
    backgroundColor: Colors.divider,
  },
  acceptButton: {
    backgroundColor: Colors.primary,
  },
  declineText: {
    color: Colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
  },
  acceptText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
