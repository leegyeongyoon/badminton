import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing, radius } from '../constants/theme';
import { BackButton } from '../components/ui/BackButton';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

// ─────────────────────────────────────────────────────────────
// 내 주변 지도 — 공개 모임(+레슨 코치)을 실제 지도 핀으로.
// 렌더는 전 플랫폼 동일하게 Leaflet(OSM): 네이티브=WebView, 웹=iframe.
// 핀 탭 → 하단 카드(모임·코치 정보 + 게스트 신청/문의 진입).
// ─────────────────────────────────────────────────────────────

interface MapClub {
  clubId: string;
  name: string;
  region: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  memberCount: number;
  guestFee: number | null;
  scheduleSummary: string | null;
  applyOpen: boolean;
  clubType: string;
  hasLessons: boolean;
  coaches: { coachName: string; coachIntro: string | null; fee: number | null; days: number[]; start: string; end: string }[];
}

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function buildLeafletHtml(clubs: MapClub[], center: { lat: number; lng: number } | null): string {
  const pins = clubs.filter((c) => c.lat != null && c.lng != null);
  const markers = JSON.stringify(pins.map((c) => ({
    id: c.clubId,
    lat: c.lat,
    lng: c.lng,
    name: c.name,
    lesson: c.hasLessons,
  })));
  const centerJs = center ? `[${center.lat}, ${center.lng}]` : pins.length ? `[${pins[0].lat}, ${pins[0].lng}]` : '[37.5665, 126.978]';
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%}
.pin{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.pin span{transform:rotate(45deg);font-size:15px}
.pin-club{background:#0D9488}.pin-lesson{background:#7C3AED}
.me{width:16px;height:16px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 5px rgba(37,99,235,.25)}</style>
</head><body><div id="map"></div><script>
var map=L.map('map',{zoomControl:true}).setView(${centerJs},12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap',maxZoom:19}).addTo(map);
function post(m){try{if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));else if(window.parent)window.parent.postMessage(JSON.stringify(m),'*');}catch(e){}}
var ms=${markers};var group=[];
ms.forEach(function(c){
  var icon=L.divIcon({className:'',html:'<div class="pin '+(c.lesson?'pin-lesson':'pin-club')+'"><span>'+(c.lesson?'🎓':'🏸')+'</span></div>',iconSize:[34,44],iconAnchor:[17,40]});
  var mk=L.marker([c.lat,c.lng],{icon:icon}).addTo(map);
  mk.on('click',function(){post({type:'club',id:c.id});});
  group.push(mk.getLatLng());
});
${center ? `L.marker([${center.lat},${center.lng}],{icon:L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(map);group.push(L.latLng(${center.lat},${center.lng}));` : ''}
if(group.length>1){map.fitBounds(L.latLngBounds(group).pad(0.25));}
</script></body></html>`;
}

export default function MapScreen() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuthStore();
  const [clubs, setClubs] = useState<MapClub[] | null>(null);
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [selected, setSelected] = useState<MapClub | null>(null);
  const clubsRef = useRef<MapClub[]>([]);

  useEffect(() => {
    const path = isAuthenticated ? '/clubs/discover' : '/clubs/discover-public';
    api.get(path, { _silent: true } as any)
      .then(({ data }) => { clubsRef.current = data || []; setClubs(data || []); })
      .catch(() => setClubs([]));
  }, [isAuthenticated]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setMyLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { timeout: 5000 },
      );
    } else if (Platform.OS !== 'web') {
      import('expo-location')
        .then(async (Location) => {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') return;
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setMyLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        })
        .catch(() => {});
    }
  }, []);

  const html = useMemo(() => (clubs ? buildLeafletHtml(clubs, myLoc) : null), [clubs, myLoc]);

  const onMapMessage = (raw: string) => {
    try {
      const msg = JSON.parse(raw);
      if (msg?.type === 'club' && msg.id) {
        const c = clubsRef.current.find((x) => x.clubId === msg.id);
        if (c) setSelected(c);
      }
    } catch {
      /* noop */
    }
  };

  // 웹: iframe postMessage 수신
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = (e: MessageEvent) => { if (typeof e.data === 'string') onMapMessage(e.data); };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const pinned = (clubs ?? []).filter((c) => c.lat != null && c.lng != null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: colors.text }]}>내 주변 지도</Text>
          <Text style={[styles.sub, { color: colors.textLight }]}>🏸 모임 · 🎓 레슨 — 핀을 눌러보세요</Text>
        </View>
      </View>

      {!html ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : pinned.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="map-outline" size={36} color={colors.textLight} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>위치가 등록된 공개 모임이 아직 없어요</Text>
        </View>
      ) : Platform.OS === 'web' ? (
        // 웹: iframe (Leaflet). RN Web의 View는 div라 dangerously… 대신 createElement로 iframe.
        <View style={{ flex: 1 }}>
          {(() => {
            const React = require('react');
            return React.createElement('iframe', {
              srcDoc: html,
              style: { border: 'none', width: '100%', height: '100%' },
              sandbox: 'allow-scripts allow-same-origin',
            });
          })()}
        </View>
      ) : (
        (() => {
          const { WebView } = require('react-native-webview');
          return (
            <WebView
              source={{ html }}
              style={{ flex: 1 }}
              onMessage={(e: { nativeEvent: { data: string } }) => onMapMessage(e.nativeEvent.data)}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
            />
          );
        })()
      )}

      {/* 선택된 모임 하단 카드 */}
      {selected && (
        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }, shadows.xl]}>
          <View style={styles.sheetHead}>
            <View style={[styles.sheetAvatar, { backgroundColor: colors.primary + '18' }]}>
              <Text style={[styles.sheetAvatarText, { color: colors.primary }]}>{selected.name[0]}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>{selected.name}</Text>
                <View style={[styles.sheetBadge, { backgroundColor: selected.clubType === 'MEETUP' ? colors.warning + '18' : colors.primaryBg }]}>
                  <Text style={[styles.sheetBadgeText, { color: selected.clubType === 'MEETUP' ? colors.warning : colors.primary }]}>
                    {selected.clubType === 'MEETUP' ? '번개' : '클럽'}
                  </Text>
                </View>
              </View>
              <Text style={[styles.sheetMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                {[selected.region, `멤버 ${selected.memberCount}명`, selected.scheduleSummary].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Pressable onPress={() => setSelected(null)} hitSlop={10}>
              <Ionicons name="close" size={20} color={colors.textLight} />
            </Pressable>
          </View>

          {/* 코치(레슨) 정보 */}
          {selected.coaches.length > 0 && (
            <View style={[styles.sheetCoaches, { backgroundColor: colors.info + '0D' }]}>
              {selected.coaches.map((co, i) => (
                <View key={i} style={styles.sheetCoachRow}>
                  <View style={[styles.coachDot, { backgroundColor: colors.info }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.coachName, { color: colors.text }]} numberOfLines={1}>
                      {co.coachName} 코치{co.fee != null ? ` · 월 ${co.fee.toLocaleString()}원` : ''}
                    </Text>
                    <Text style={[styles.coachMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {co.days.map((d) => DAY_KO[d]).join('·')} {co.start}~{co.end}{co.coachIntro ? ` · ${co.coachIntro}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={styles.sheetActions}>
            <Pressable
              onPress={() => router.push(`/guest-apply?clubId=${selected.clubId}` as never)}
              style={[styles.sheetBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.sheetBtnText}>게스트 신청</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push(`/guest-chat?clubId=${selected.clubId}` as never)}
              style={[styles.sheetBtn, { backgroundColor: colors.background }]}
            >
              <Text style={[styles.sheetBtnText, { color: colors.primary }]}>문의하기</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.h3 },
  sub: { ...typography.caption, marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyText: { ...typography.body2 },
  sheet: {
    position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md,
    borderRadius: 24, padding: spacing.lg,
    maxWidth: 560, alignSelf: 'center', width: 'auto',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sheetAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sheetAvatarText: { fontSize: 18, fontWeight: '900' },
  sheetTitle: { ...typography.subtitle1, flexShrink: 1 },
  sheetBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  sheetBadgeText: { fontSize: 10, fontWeight: '900' },
  sheetMeta: { ...typography.caption, marginTop: 2 },
  sheetCoaches: { borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md, gap: spacing.sm },
  sheetCoachRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  coachDot: { width: 8, height: 8, borderRadius: 4 },
  coachName: { ...typography.body2, fontWeight: '800' },
  coachMeta: { ...typography.caption, marginTop: 1 },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  sheetBtn: { flex: 1, paddingVertical: 13, borderRadius: 14, alignItems: 'center' },
  sheetBtnText: { ...typography.button, fontSize: 14, fontWeight: '900', color: '#fff' },
});
