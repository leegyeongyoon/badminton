import { useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '../constants/colors';

const KAKAO_MAP_APP_KEY = process.env.EXPO_PUBLIC_KAKAO_MAP_KEY || '';

interface FacilityItem {
  id: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  courtCount?: number;
  hasOpenSession?: boolean;
}

interface UserLocation {
  latitude: number;
  longitude: number;
}

interface KakaoMapProps {
  facilities: FacilityItem[];
  onFacilitySelect: (facility: FacilityItem) => void;
  userLocation: UserLocation | null;
  style?: ViewStyle;
}

declare global {
  interface Window {
    kakao: any;
  }
}

export default function KakaoMap({
  facilities,
  onFacilitySelect,
  userLocation,
  style,
}: KakaoMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const facilitiesRef = useRef(facilities);
  const onSelectRef = useRef(onFacilitySelect);
  facilitiesRef.current = facilities;
  onSelectRef.current = onFacilitySelect;

  const facilitiesWithCoords = facilities.filter(
    (f) => f.latitude != null && f.longitude != null,
  );

  const centerLat = userLocation?.latitude
    ?? (facilitiesWithCoords.length > 0 ? facilitiesWithCoords[0].latitude! : 37.5665);
  const centerLng = userLocation?.longitude
    ?? (facilitiesWithCoords.length > 0 ? facilitiesWithCoords[0].longitude! : 126.978);

  useEffect(() => {
    // Load Kakao Maps SDK
    if (typeof window !== 'undefined' && !document.getElementById('kakao-maps-sdk')) {
      const script = document.createElement('script');
      script.id = 'kakao-maps-sdk';
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_MAP_APP_KEY}&autoload=false`;
      script.async = true;
      script.onload = () => initMap();
      document.head.appendChild(script);
    } else if (typeof window !== 'undefined' && window.kakao?.maps) {
      initMap();
    }
  }, []);

  useEffect(() => {
    if (mapInstanceRef.current && window.kakao?.maps) {
      updateMarkers();
    }
  }, [facilities, userLocation]);

  const initMap = () => {
    if (!mapRef.current || !window.kakao?.maps) return;

    window.kakao.maps.load(() => {
      const container = mapRef.current;
      const options = {
        center: new window.kakao.maps.LatLng(centerLat, centerLng),
        level: 5,
      };
      mapInstanceRef.current = new window.kakao.maps.Map(container, options);
      updateMarkers();
    });
  };

  const updateMarkers = () => {
    const map = mapInstanceRef.current;
    if (!map || !window.kakao?.maps) return;

    const currentFacilities = facilitiesRef.current.filter(
      (f) => f.latitude != null && f.longitude != null,
    );

    // User location
    if (userLocation) {
      const userPos = new window.kakao.maps.LatLng(userLocation.latitude, userLocation.longitude);
      const userContent = document.createElement('div');
      userContent.innerHTML = '<div style="width:14px;height:14px;background:#4285F4;border:3px solid white;border-radius:50%;box-shadow:0 0 6px rgba(66,133,244,0.5);"></div>';
      new window.kakao.maps.CustomOverlay({
        position: userPos,
        content: userContent,
        map,
        zIndex: 1,
      });
    }

    // Facility markers
    currentFacilities.forEach((f) => {
      const pos = new window.kakao.maps.LatLng(f.latitude!, f.longitude!);
      const marker = new window.kakao.maps.Marker({ position: pos, map });

      const detail = [
        f.courtCount != null ? `${f.courtCount}코트` : '',
        f.hasOpenSession ? '운영중' : '',
      ].filter(Boolean).join(' | ');

      const contentHtml = `
        <div style="padding:8px 12px;font-family:-apple-system,sans-serif;min-width:150px;">
          <div style="font-size:14px;font-weight:700;color:#1E293B;margin-bottom:4px;">${f.name}</div>
          <div style="font-size:12px;color:#64748B;margin-bottom:6px;">${f.address}</div>
          ${detail ? `<div style="font-size:12px;color:${Colors.primary};font-weight:500;margin-bottom:8px;">${detail}</div>` : ''}
          <button id="select-${f.id}" style="display:block;width:100%;padding:8px;background:${Colors.primary};color:white;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">이 체육관 선택</button>
        </div>`;

      const infowindow = new window.kakao.maps.InfoWindow({ content: contentHtml });

      window.kakao.maps.event.addListener(marker, 'click', () => {
        infowindow.open(map, marker);
        // Bind click handler after DOM render
        setTimeout(() => {
          const btn = document.getElementById(`select-${f.id}`);
          if (btn) {
            btn.onclick = () => onSelectRef.current(f);
          }
        }, 50);
      });
    });
  };

  return (
    <View style={[styles.container, style]}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
});
