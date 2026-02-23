import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Colors } from '../constants/colors';

// Fix default marker icon issue in leaflet + bundlers
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const activeIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [30, 48],
  iconAnchor: [15, 48],
  popupAnchor: [1, -38],
  shadowSize: [48, 48],
  className: 'active-session-marker',
});

L.Marker.prototype.options.icon = defaultIcon;

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

interface FacilityMapProps {
  facilities: FacilityItem[];
  onFacilitySelect: (facility: FacilityItem) => void;
  userLocation: UserLocation | null;
  style?: ViewStyle;
}

function MapAutoCenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], 13);
  }, [lat, lng, map]);
  return null;
}

export default function FacilityMap({
  facilities,
  onFacilitySelect,
  userLocation,
  style,
}: FacilityMapProps) {
  const facilitiesWithCoords = facilities.filter(
    (f) => f.latitude != null && f.longitude != null
  );

  const centerLat =
    userLocation?.latitude ??
    (facilitiesWithCoords.length > 0
      ? facilitiesWithCoords[0].latitude!
      : 37.5665);
  const centerLng =
    userLocation?.longitude ??
    (facilitiesWithCoords.length > 0
      ? facilitiesWithCoords[0].longitude!
      : 126.978);

  return (
    <View style={[styles.container, style]}>
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={13}
        style={{ width: '100%', height: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {facilitiesWithCoords.map((facility) => (
          <Marker
            key={facility.id}
            position={[facility.latitude!, facility.longitude!]}
            icon={facility.hasOpenSession ? activeIcon : defaultIcon}
          >
            <Popup>
              <div style={popupStyles.container}>
                <div style={popupStyles.title}>{facility.name}</div>
                <div style={popupStyles.address}>{facility.address}</div>
                {facility.courtCount != null && (
                  <div style={popupStyles.detail}>
                    {facility.courtCount}코트
                    {facility.hasOpenSession ? ' | 운영중' : ''}
                  </div>
                )}
                <button
                  style={popupStyles.button}
                  onClick={() => onFacilitySelect(facility)}
                >
                  이 체육관 선택
                </button>
              </div>
            </Popup>
          </Marker>
        ))}

        {userLocation && (
          <Marker
            position={[userLocation.latitude, userLocation.longitude]}
            icon={L.divIcon({
              className: 'user-location-marker',
              html: '<div style="width:14px;height:14px;background:#4285F4;border:3px solid white;border-radius:50%;box-shadow:0 0 6px rgba(66,133,244,0.5);"></div>',
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            })}
          />
        )}
      </MapContainer>
    </View>
  );
}

const popupStyles: Record<string, React.CSSProperties> = {
  container: {
    minWidth: 160,
    padding: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  address: {
    fontSize: 12,
    color: '#666',
    marginBottom: 6,
  },
  detail: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '500',
    marginBottom: 8,
  },
  button: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: Colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: '600',
    cursor: 'pointer',
  },
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
});
