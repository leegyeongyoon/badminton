import { useEffect, useCallback, useState } from 'react';
import { useSocketEvent, useFacilityRoom } from './useSocket';
import { useFacilityStore } from '../store/facilityStore';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import { recruitmentApi } from '../services/recruitment';
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

  // Join facility socket room
  useFacilityRoom(facilityId);

  // --- Data loaders ---

  const loadCapacity = useCallback(async () => {
    if (!facilityId) return;
    try {
      const { data } = await api.get(`/facilities/${facilityId}/capacity`);
      setCapacity(data);
    } catch { /* silent */ }
  }, [facilityId]);

  const loadRecruitments = useCallback(async () => {
    if (!facilityId) return;
    try {
      const { data } = await recruitmentApi.list(facilityId);
      setRecruitments(data);
    } catch { /* silent */ }
  }, [facilityId]);

  const loadRotation = useCallback(async () => {
    if (!facilityId) return;
    try {
      const { data } = await api.get(`/facilities/${facilityId}/rotation/current`);
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
    } catch { setRotation(null); }
  }, [facilityId]);

  const loadClubSession = useCallback(async () => {
    if (!facilityId) return;
    try {
      const { data: clubs } = await api.get('/clubs');
      for (const club of clubs) {
        try {
          const { data: session } = await clubSessionApi.getActive(club.id);
          if (session && session.facilityId === facilityId && session.status === 'ACTIVE') {
            setActiveClubSession(session);
            return;
          }
        } catch { /* no active session for this club */ }
      }
      setActiveClubSession(null);
    } catch { setActiveClubSession(null); }
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
      } catch {
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
  }, [facilityId]);

  // --- Socket event listeners (16 events) ---

  // Court & turn events -> full board refresh
  useSocketEvent('court:statusChanged', refreshBoard);
  useSocketEvent('turn:created', refreshBoard);
  useSocketEvent('turn:promoted', refreshBoard);
  useSocketEvent('turn:started', refreshBoard);
  useSocketEvent('turn:completed', refreshBoard);
  useSocketEvent('turn:cancelled', refreshBoard);

  // Player capacity events
  useSocketEvent('players:updated', loadCapacity);

  // Recruitment events
  useSocketEvent('recruitment:created', loadRecruitments);
  useSocketEvent('recruitment:playerJoined', loadRecruitments);
  useSocketEvent('recruitment:full', loadRecruitments);
  useSocketEvent('recruitment:registered', loadRecruitments);
  useSocketEvent('recruitment:cancelled', loadRecruitments);

  // Rotation events
  useSocketEvent('rotation:started', loadRotation);
  useSocketEvent('rotation:roundAdvanced', loadRotation);
  useSocketEvent('rotation:completed', loadRotation);
  useSocketEvent('rotation:cancelled', loadRotation);

  // Club session events -> full board refresh
  useSocketEvent('clubSession:started', refreshBoard);
  useSocketEvent('clubSession:courtsUpdated', refreshBoard);
  useSocketEvent('clubSession:ended', refreshBoard);

  return {
    capacity,
    recruitments,
    rotation,
    activeClubSession,
    isAdmin,
    refreshBoard,
    loadRecruitments,
  };
}
