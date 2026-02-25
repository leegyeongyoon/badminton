import { useState, useEffect } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { getSocket } from './useSocket';

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true);
  const [isSocketConnected, setIsSocketConnected] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected ?? true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const handleConnect = () => setIsSocketConnected(true);
    const handleDisconnect = () => setIsSocketConnected(false);

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    setIsSocketConnected(socket.connected);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, []);

  return {
    isConnected,
    isSocketConnected,
    isFullyConnected: isConnected && isSocketConnected,
  };
}
