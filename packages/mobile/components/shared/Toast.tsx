import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { Colors } from '../../constants/colors';
import { toastEmitter } from '../../utils/feedback';

interface ToastMessage {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

const TOAST_DURATION = 2500;

function ToastItem({ toast, onDone }: { toast: ToastMessage; onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -20, duration: 300, useNativeDriver: true }),
      ]).start(() => onDone());
    }, TOAST_DURATION);

    return () => clearTimeout(timer);
  }, []);

  const bgColor = toast.type === 'success'
    ? Colors.secondary
    : toast.type === 'error'
      ? Colors.danger
      : Colors.primary;

  return (
    <Animated.View style={[styles.toast, { backgroundColor: bgColor, opacity, transform: [{ translateY }] }]}>
      <Text style={styles.toastText}>{toast.message}</Text>
    </Animated.View>
  );
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const idRef = useRef(0);

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const unsub = toastEmitter.subscribe(addToast);
    return unsub;
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDone={() => removeToast(t.id)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: 'center',
  },
  toast: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    maxWidth: 340,
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
