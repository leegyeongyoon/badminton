import { useEffect, useCallback, useState, useRef } from 'react';
import { useSocketEvent, useFacilityRoom, getSocket } from './useSocket';
import { useFacilityStore } from '../store/facilityStore';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import { clubSessionApi } from '../services/clubSession';

export interface Capacity {
  totalCheckedIn: number;
  availableCount: number;
  inTurnCount: number;
  restingCount: number;
  totalCourts: number;
  activeCourts: number;
  totalTurnSlots: number;
  usedTurnSlots: number;
}

export interface Recruitment {
  id: string;
  createdById: string;
  createdByName: string;
  gameType: string;
  playersRequired: number;
  status: string;
  message: string | null;
  members: { userId: string; userName: string }[];
  expiresAt: string;
}

export interface RotationInfo {
  id: string;
  status: string;
  currentRound: number;
  totalRounds: number;
}

export function useBoardData(facilityId: string | undefined) {
  const { fetchBoard } = useFacilityStore();
  const { user } = useAuthStore();

  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [recruitments, setRecruitments] = useState<Recruitment[]>([]);
  const [rotation, setRotation] = useState<RotationInfo | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeClubSession, setActiveClubSession] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  // Join facility socket room
  useFacilityRoom(facilityId);

  // --- Data loaders ---

  const loadCapacity = useCallback(async () => {
    if (!facilityId) return;
    try {
      const { data } = await api.get(`/facilities/${facilityId}/capacity`, { _silent: true } as any);
      setCapacity(data);
      setErrors(prev => prev.capacity ? { ...prev, capacity: false } : prev);
    } catch (e) {
      console.warn('loadCapacity failed:', e);
      setErrors(prev => ({ ...prev, capacity: true }));
    }
  }, [facilityId]);

  const loadRecruitments = useCallback(async () => {
    if (!facilityId) return;
    try {
      const { data } = await api.get(`/facilities/${facilityId}/recruitments`, { _silent: true } as any);
      setRecruitments(data);
      setErrors(prev => prev.recruitments ? { ...prev, recruitments: false } : prev);
    } catch (e) {
      console.warn('loadRecruitments failed:', e);
      setErrors(prev => ({ ...prev, recruitments: true }));
    }
  }, [facilityId]);

  const loadRotation = useCallback(async () => {
    if (!facilityId) return;
    try {
      const { data } = await api.get(`/facilities/${facilityId}/rotation/current`, { _silent: true } as any);
      if (data && data.status === 'ACTIVE') {
        setRotation({
          id: data.id,
          status: data.status,
          currentRound: data.currentRound,
          totalRounds: data.totalRounds,
        });
      } else {
        setRotation(null);
      }
      setErrors(prev => prev.rotation ? { ...prev, rotation: false } : prev);
    } catch (e) {
      console.warn('loadRotation failed:', e);
      setRotation(null);
      setErrors(prev => ({ ...prev, rotation: true }));
    }
  }, [facilityId]);

  const loadClubSession = useCallback(async () => {
    if (!facilityId) return;
    try {
      const { data: clubs } = await api.get('/clubs', { _silent: true } as any);
      for (const club of clubs) {
        try {
          const { data: session } = await clubSessionApi.getActive(club.id);
          if (session && session.facilityId === facilityId && session.status === 'ACTIVE') {
            setActiveClubSession(session);
            return;
          }
        } catch (e) {
          console.warn(`loadClubSession: no active session for club ${club.id}:`, e);
        }
      }
      setActiveClubSession(null);
    } catch (e) {
      console.warn('loadClubSession failed:', e);
      setActiveClubSession(null);
      setErrors(prev => ({ ...prev, clubSession: true }));
    }
  }, [facilityId]);

  const checkAdminStatus = useCallback(async () => {
    if (!user) return;
    if (user.role === 'FACILITY_ADMIN') {
      setIsAdmin(true);
      return;
    }
    if (facilityId) {
      try {
        const { data } = await api.get('/users/me/admin-facilities');
        setIsAdmin(Array.isArray(data) && data.some((f: any) => f.id === facilityId));
      } catch (e) {
        console.warn('checkAdminStatus failed:', e);
        setIsAdmin(false);
      }
    }
  }, [user, facilityId]);

  const refreshBoard = useCallback(() => {
    if (facilityId) {
      fetchBoard(facilityId);
      loadCapacity();
      loadRecruitments();
      loadRotation();
      loadClubSession();
    }
  }, [facilityId, fetchBoard, loadCapacity, loadRecruitments, loadRotation, loadClubSession]);

  // --- Debounced versions for socket events ---

  const refreshTimerRef = useRef<NodeJS.Timeout>(undefined);
  const recruitmentTimerRef = useRef<NodeJS.Timeout>(undefined);
  const rotationTimerRef = useRef<NodeJS.Timeout>(undefined);

  const debouncedRefreshBoard = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => refreshBoard(), 200);
  }, [refreshBoard]);

  const debouncedLoadRecruitments = useCallback(() => {
    if (recruitmentTimerRef.current) clearTimeout(recruitmentTimerRef.current);
    recruitmentTimerRef.current = setTimeout(() => loadRecruitments(), 200);
  }, [loadRecruitments]);

  const debouncedLoadRotation = useCallback(() => {
    if (rotationTimerRef.current) clearTimeout(rotationTimerRef.current);
    rotationTimerRef.current = setTimeout(() => loadRotation(), 200);
  }, [loadRotation]);

  // --- Initial load ---

  useEffect(() => {
    if (facilityId) {
      fetchBoard(facilityId);
      loadCapacity();
      loadRecruitments();
      loadRotation();
      loadClubSession();
    }
    checkAdminStatus();
    return () => {
      clearTimeout(refreshTimerRef.current);
      clearTimeout(recruitmentTimerRef.current);
      clearTimeout(rotationTimerRef.current);
    };
  }, [facilityId]);

  // --- Reconnect: refresh board after room rejoin ---
  useEffect(() => {
    const socket = getSocket();
    const handleReconnect = () => {
      // Delay to allow room rejoin to complete
      setTimeout(() => refreshBoard(), 300);
    };
    socket.on('connect', handleReconnect);
    return () => {
      socket.off('connect', handleReconnect);
    };
  }, [refreshBoard]);

  // --- Socket event listeners (16 events, debounced) ---

  // Court & turn events -> debounced full board refresh
  useSocketEvent('court:statusChanged', debouncedRefreshBoard);
  useSocketEvent('turn:created', debouncedRefreshBoard);
  useSocketEvent('turn:promoted', debouncedRefreshBoard);
  useSocketEvent('turn:started', debouncedRefreshBoard);
  useSocketEvent('turn:completed', debouncedRefreshBoard);
  useSocketEvent('turn:cancelled', debouncedRefreshBoard);

  // Player capacity events
  useSocketEvent('players:updated', loadCapacity);

  // Recruitment events -> debounced
  useSocketEvent('recruitment:created', debouncedLoadRecruitments);
  useSocketEvent('recruitment:playerJoined', debouncedLoadRecruitments);
  useSocketEvent('recruitment:full', debouncedLoadRecruitments);
  useSocketEvent('recruitment:registered', debouncedLoadRecruitments);
  useSocketEvent('recruitment:cancelled', debouncedLoadRecruitments);

  // Rotation events -> debounced
  useSocketEvent('rotation:started', debouncedLoadRotation);
  useSocketEvent('rotation:roundAdvanced', debouncedLoadRotation);
  useSocketEvent('rotation:completed', debouncedLoadRotation);
  useSocketEvent('rotation:cancelled', debouncedLoadRotation);

  // Club session events -> debounced full board refresh
  useSocketEvent('clubSession:started', debouncedRefreshBoard);
  useSocketEvent('clubSession:courtsUpdated', debouncedRefreshBoard);
  useSocketEvent('clubSession:ended', debouncedRefreshBoard);

  // Game board events -> debounced full board refresh
  useSocketEvent('gameBoard:entryAdded', debouncedRefreshBoard);
  useSocketEvent('gameBoard:entryPushed', debouncedRefreshBoard);

  return {
    capacity,
    recruitments,
    rotation,
    activeClubSession,
    isAdmin,
    errors,
    refreshBoard,
    loadRecruitments,
  };
}
