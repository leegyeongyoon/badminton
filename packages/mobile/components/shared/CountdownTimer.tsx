import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';

interface CountdownTimerProps {
  timeLimitAt: string;
  mode?: 'badge' | 'bar' | 'large';
}

function useCountdown(timeLimitAt: string) {
  const [remaining, setRemaining] = useState('');
  const [color, setColor] = useState(Colors.timerSafe);
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    const totalMs = 30 * 60 * 1000;
    const update = () => {
      const diff = new Date(timeLimitAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining(Strings.timer.expired);
        setColor(Colors.timerDanger);
        setProgress(0);
        return;
      }
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      setProgress(Math.min(diff / totalMs, 1));
      if (minutes < 2) setColor(Colors.timerDanger);
      else if (minutes < 5) setColor(Colors.timerWarning);
      else setColor(Colors.timerSafe);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timeLimitAt]);

  return { remaining, color, progress };
}

export function CountdownTimer({ timeLimitAt, mode = 'large' }: CountdownTimerProps) {
  const { remaining, color, progress } = useCountdown(timeLimitAt);

  if (mode === 'badge') {
    return <Text style={[styles.badgeText, { color }]}>{remaining}</Text>;
  }

  if (mode === 'bar') {
    return (
      <View style={styles.barContainer}>
        <View style={styles.barBg}>
          <View style={[styles.barFill, { width: `${progress * 100}%`, backgroundColor: color }]} />
        </View>
      </View>
    );
  }

  // large mode
  return (
    <View style={[styles.largeContainer, { borderColor: color + '30' }]}>
      <Text style={[styles.largeLabel, { color }]}>{Strings.timer.remaining}</Text>
      <Text style={[styles.largeValue, { color }]}>{remaining}</Text>
      <View style={styles.largeBarBg}>
        <View style={[styles.barFill, { width: `${progress * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// Also export the hook for custom usage
export { useCountdown };

const styles = StyleSheet.create({
  // Badge mode
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  // Bar mode
  barContainer: {
    marginTop: 6,
  },
  barBg: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.divider,
    overflow: 'hidden',
  },
  barFill: {
    height: 3,
    borderRadius: 2,
  },
  // Large mode
  largeContainer: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  largeLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  largeValue: {
    fontSize: 36,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginBottom: 10,
  },
  largeBarBg: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.divider,
    overflow: 'hidden',
  },
});
