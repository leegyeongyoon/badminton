import { useRef, useCallback } from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { Colors } from '../constants/colors';

const KAKAO_MAP_APP_KEY = Constants.expoConfig?.extra?.EXPO_PUBLIC_KAKAO_MAP_KEY
  || process.env.EXPO_PUBLIC_KAKAO_MAP_KEY
  || '';

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

export default function KakaoMap({
  facilities,
  onFacilitySelect,
  userLocation,
  style,
}: KakaoMapProps) {
  const webViewRef = useRef<WebView>(null);
  const facilitiesWithCoords = facilities.filter(
    (f) => f.latitude != null && f.longitude != null,
  );

  const centerLat = userLocation?.latitude
    ?? (facilitiesWithCoords.length > 0 ? facilitiesWithCoords[0].latitude! : 37.5665);
  const centerLng = userLocation?.longitude
    ?? (facilitiesWithCoords.length > 0 ? facilitiesWithCoords[0].longitude! : 126.978);

  const markersJson = JSON.stringify(facilitiesWithCoords.map((f) => ({
    id: f.id,
    name: f.name,
    address: f.address,
    lat: f.latitude,
    lng: f.longitude,
    courtCount: f.courtCount,
    hasOpenSession: f.hasOpenSession,
  })));

  const userLocationJson = userLocation
    ? JSON.stringify({ lat: userLocation.latitude, lng: userLocation.longitude })
    : 'null';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <style>
    * { margin: 0; padding: 0; }
    html, body, #map { width: 100%; height: 100%; }
    .info-window {
      padding: 8px 12px;
      font-family: -apple-system, sans-serif;
      min-width: 150px;
    }
    .info-title {
      font-size: 14px;
      font-weight: 700;
      color: #1E293B;
      margin-bottom: 4px;
    }
    .info-address {
      font-size: 12px;
      color: #64748B;
      margin-bottom: 6px;
    }
    .info-detail {
      font-size: 12px;
      color: ${Colors.primary};
      font-weight: 500;
      margin-bottom: 8px;
    }
    .info-btn {
      display: block;
      width: 100%;
      padding: 8px;
      background: ${Colors.primary};
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_MAP_APP_KEY}&autoload=false"></script>
  <script>
    kakao.maps.load(function() {
      var container = document.getElementById('map');
      var options = {
        center: new kakao.maps.LatLng(${centerLat}, ${centerLng}),
        level: 5
      };
      var map = new kakao.maps.Map(container, options);

      var markers = ${markersJson};
      var userLoc = ${userLocationJson};

      // User location marker
      if (userLoc) {
        var userPos = new kakao.maps.LatLng(userLoc.lat, userLoc.lng);
        var userContent = '<div style="width:14px;height:14px;background:#4285F4;border:3px solid white;border-radius:50%;box-shadow:0 0 6px rgba(66,133,244,0.5);"></div>';
        var userOverlay = new kakao.maps.CustomOverlay({
          position: userPos,
          content: userContent,
          zIndex: 1
        });
        userOverlay.setMap(map);
      }

      // Facility markers
      markers.forEach(function(m) {
        var pos = new kakao.maps.LatLng(m.lat, m.lng);
        var marker = new kakao.maps.Marker({ position: pos, map: map });

        var detail = (m.courtCount != null ? m.courtCount + '코트' : '');
        if (m.hasOpenSession) detail += (detail ? ' | ' : '') + '운영중';

        var content = '<div class="info-window">'
          + '<div class="info-title">' + m.name + '</div>'
          + '<div class="info-address">' + m.address + '</div>'
          + (detail ? '<div class="info-detail">' + detail + '</div>' : '')
          + '<button class="info-btn" onclick="selectFacility(\\'' + m.id + '\\')">이 체육관 선택</button>'
          + '</div>';

        var infowindow = new kakao.maps.InfoWindow({ content: content });

        kakao.maps.event.addListener(marker, 'click', function() {
          infowindow.open(map, marker);
        });
      });

      window.selectFacility = function(id) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'select', facilityId: id }));
      };
    });
  </script>
</body>
</html>`;

  const handleMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'select') {
        const facility = facilities.find((f) => f.id === data.facilityId);
        if (facility) {
          onFacilitySelect(facility);
        }
      }
    } catch { /* silent */ }
  }, [facilities, onFacilitySelect]);

  return (
    <WebView
      ref={webViewRef}
      style={[styles.map, style]}
      originWhitelist={['*']}
      source={{ html }}
      onMessage={handleMessage}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
    />
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
