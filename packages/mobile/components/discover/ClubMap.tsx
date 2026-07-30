import { useEffect, useMemo, useState } from 'react';
import { View, Platform } from 'react-native';

// ─────────────────────────────────────────────────────────────
// 모임 지도(공용) — 카카오맵 우선, JS키 미설정/로드 실패 시 Leaflet(OSM) 폴백.
// 네이티브=WebView, 웹=iframe. 핀 탭 → onSelectClub(clubId).
// 시트/카드 UI는 부모(discover)가 그린다 — 이 컴포넌트는 지도만.
// ─────────────────────────────────────────────────────────────

const KAKAO_MAP_KEY = process.env.EXPO_PUBLIC_KAKAO_MAP_KEY || '';

export interface MapPin {
  clubId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  hasLessons: boolean;
}

function buildMapHtml(pins: MapPin[], center: { lat: number; lng: number } | null): string {
  const withCoords = pins.filter((p) => p.lat != null && p.lng != null);
  const markers = JSON.stringify(withCoords.map((p) => ({ id: p.clubId, lat: p.lat, lng: p.lng, name: p.name, lesson: p.hasLessons })));
  const centerJs = center
    ? `{lat:${center.lat},lng:${center.lng}}`
    : withCoords.length
      ? `{lat:${withCoords[0].lat},lng:${withCoords[0].lng}}`
      : '{lat:37.5665,lng:126.978}';
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%}
.pin{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer}
.pin span{transform:rotate(45deg);font-size:15px}
.pin-club{background:#0D9488}.pin-lesson{background:#7C3AED}
.me{width:16px;height:16px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 5px rgba(37,99,235,.25)}</style>
</head><body><div id="map"></div><script>
var KAKAO_KEY=${JSON.stringify(KAKAO_MAP_KEY)};
var MARKERS=${markers};
var CENTER=${centerJs};
var HAS_ME=${center ? 'true' : 'false'};
var ready=false;
function post(m){try{if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));else if(window.parent)window.parent.postMessage(JSON.stringify(m),'*');}catch(e){}}
function pinHtml(lesson){return '<div class="pin '+(lesson?'pin-lesson':'pin-club')+'"><span>'+(lesson?'\\uD83C\\uDF93':'\\uD83C\\uDFF8')+'</span></div>';}

// ── 카카오맵 ──
function initKakao(){
  ready=true;
  var map=new kakao.maps.Map(document.getElementById('map'),{center:new kakao.maps.LatLng(CENTER.lat,CENTER.lng),level:6});
  var bounds=new kakao.maps.LatLngBounds();
  MARKERS.forEach(function(m){
    var pos=new kakao.maps.LatLng(m.lat,m.lng);
    var el=document.createElement('div');
    el.innerHTML=pinHtml(m.lesson);
    el.onclick=function(){post({type:'club',id:m.id});};
    new kakao.maps.CustomOverlay({position:pos,content:el,yAnchor:1,zIndex:2}).setMap(map);
    bounds.extend(pos);
  });
  if(HAS_ME){
    var me=new kakao.maps.LatLng(CENTER.lat,CENTER.lng);
    new kakao.maps.CustomOverlay({position:me,content:'<div class="me"></div>',zIndex:1}).setMap(map);
    bounds.extend(me);
  }
  if(MARKERS.length>0)map.setBounds(bounds,60,60,60,60);
  post({type:'provider',name:'kakao'});
}

// ── Leaflet 폴백 ──
function initLeaflet(){
  if(ready)return; ready=true;
  var css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(css);
  var js=document.createElement('script');js.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  js.onload=function(){
    var map=L.map('map').setView([CENTER.lat,CENTER.lng],12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap',maxZoom:19}).addTo(map);
    var group=[];
    MARKERS.forEach(function(m){
      var icon=L.divIcon({className:'',html:pinHtml(m.lesson),iconSize:[34,44],iconAnchor:[17,40]});
      L.marker([m.lat,m.lng],{icon:icon}).addTo(map).on('click',function(){post({type:'club',id:m.id});});
      group.push(L.latLng(m.lat,m.lng));
    });
    if(HAS_ME){
      L.marker([CENTER.lat,CENTER.lng],{icon:L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(map);
      group.push(L.latLng(CENTER.lat,CENTER.lng));
    }
    if(group.length>1)map.fitBounds(L.latLngBounds(group).pad(0.25));
    post({type:'provider',name:'leaflet'});
  };
  document.head.appendChild(js);
}

if(KAKAO_KEY){
  var s=document.createElement('script');
  s.src='https://dapi.kakao.com/v2/maps/sdk.js?appkey='+KAKAO_KEY+'&autoload=false';
  s.onload=function(){try{kakao.maps.load(initKakao);}catch(e){initLeaflet();}};
  s.onerror=initLeaflet;
  document.head.appendChild(s);
  setTimeout(function(){if(!ready)initLeaflet();},4000);
}else{
  initLeaflet();
}
</script></body></html>`;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { kakao: any }
}

/** 웹 전용: 부모 문서에 카카오 SDK를 직접 로드해 렌더(referer=현재 도메인).
 *  실패/타임아웃이면 false 콜백 → 부모가 Leaflet iframe 폴백. */
function useKakaoWebMap(
  enabled: boolean,
  pins: MapPin[],
  myLoc: { lat: number; lng: number } | null,
  onSelectClub: (clubId: string) => void,
  onFail: () => void,
) {
  const containerRef = { current: null as HTMLDivElement | null };
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || !KAKAO_MAP_KEY) { if (enabled) onFail(); return; }
    let dead = false;
    const fail = () => { if (!dead) { dead = true; onFail(); } };
    const timer = setTimeout(fail, 4000);

    const init = () => {
      try {
        const w = window as Window;
        w.kakao.maps.load(() => {
          if (dead) return;
          clearTimeout(timer);
          const el = document.getElementById('club-kakao-map');
          if (!el) return fail();
          const withCoords = pins.filter((p) => p.lat != null && p.lng != null);
          const center = myLoc ?? (withCoords[0] ? { lat: withCoords[0].lat!, lng: withCoords[0].lng! } : { lat: 37.5665, lng: 126.978 });
          const map = new w.kakao.maps.Map(el, { center: new w.kakao.maps.LatLng(center.lat, center.lng), level: 6 });
          const bounds = new w.kakao.maps.LatLngBounds();
          withCoords.forEach((m) => {
            const pos = new w.kakao.maps.LatLng(m.lat, m.lng);
            const div = document.createElement('div');
            div.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;background:${m.hasLessons ? '#7C3AED' : '#0D9488'}"><span style="transform:rotate(45deg);font-size:15px">${m.hasLessons ? '🎓' : '🏸'}</span></div>`;
            div.onclick = () => onSelectClub(m.clubId);
            new w.kakao.maps.CustomOverlay({ position: pos, content: div, yAnchor: 1, zIndex: 2 }).setMap(map);
            bounds.extend(pos);
          });
          if (myLoc) {
            const me = new w.kakao.maps.LatLng(myLoc.lat, myLoc.lng);
            new w.kakao.maps.CustomOverlay({ position: me, content: '<div style="width:16px;height:16px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 5px rgba(37,99,235,.25)"></div>', zIndex: 1 }).setMap(map);
            bounds.extend(me);
          }
          if (withCoords.length > 0) map.setBounds(bounds, 60, 60, 60, 60);
        });
      } catch {
        fail();
      }
    };

    const w = window as Window;
    if (w.kakao?.maps) { init(); return () => { dead = true; clearTimeout(timer); }; }
    const existing = document.getElementById('kakao-maps-sdk') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', init);
      existing.addEventListener('error', fail);
    } else {
      const sc = document.createElement('script');
      sc.id = 'kakao-maps-sdk';
      sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_MAP_KEY}&autoload=false`;
      sc.onload = init;
      sc.onerror = fail;
      document.head.appendChild(sc);
    }
    return () => { dead = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pins, myLoc]);
  return containerRef;
}

export function ClubMap({
  pins,
  myLoc,
  onSelectClub,
}: {
  pins: MapPin[];
  myLoc: { lat: number; lng: number } | null;
  onSelectClub: (clubId: string) => void;
}) {
  const [webFallback, setWebFallback] = useState(false);
  const html = useMemo(() => buildMapHtml(pins, myLoc), [pins, myLoc]);
  useKakaoWebMap(Platform.OS === 'web' && !webFallback, pins, myLoc, onSelectClub, () => setWebFallback(true));

  const onMessage = (raw: string) => {
    try {
      const msg = JSON.parse(raw);
      if (msg?.type === 'club' && msg.id) onSelectClub(msg.id);
    } catch {
      /* noop */
    }
  };

  // 웹: iframe postMessage 수신
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = (e: MessageEvent) => { if (typeof e.data === 'string') onMessage(e.data); };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelectClub]);

  if (Platform.OS === 'web') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const React = require('react');
    return (
      <View style={{ flex: 1 }}>
        {webFallback
          ? React.createElement('iframe', {
              srcDoc: html,
              style: { border: 'none', width: '100%', height: '100%' },
              sandbox: 'allow-scripts allow-same-origin',
            })
          : React.createElement('div', {
              id: 'club-kakao-map',
              style: { width: '100%', height: '100%' },
            })}
      </View>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebView } = require('react-native-webview');
  return (
    <WebView
      source={{ html, baseUrl: 'https://badmintoncourt.store' }}
      style={{ flex: 1 }}
      onMessage={(e: { nativeEvent: { data: string } }) => onMessage(e.nativeEvent.data)}
      javaScriptEnabled
      domStorageEnabled
      originWhitelist={['*']}
    />
  );
}
