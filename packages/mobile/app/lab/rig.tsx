/**
 * 콕고 랠리 — 리깅 모션 필름스트립 (개발 디버그).
 * 모든 스윙 클립을 프레임 단위로 얼려서 한 화면에 늘어놓는다 —
 * rAF가 멈춘 환경(가려진 창)에서도 정적 렌더라 스크린샷 QA가 가능하다.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { RigCharacter, RigClip, poseAt } from '../../game/rally/sprites/RigCharacter';

const STRIPS: { m: RigClip; label: string; times: number[] }[] = [
  { m: 'windup', label: '윈드업(대기)', times: [0, 55, 110] },
  { m: 'overhead', label: '클리어(오버헤드)', times: [0, 60, 95, 130, 220, 470] },
  { m: 'smashJump', label: '점프 스매시', times: [0, 90, 135, 180, 260, 540] },
  { m: 'under', label: '리프트(언더)', times: [0, 70, 120, 170, 260, 380] },
  { m: 'netPush', label: '헤어핀 푸시', times: [0, 80, 135, 190, 280, 370] },
  { m: 'drive', label: '드라이브', times: [0, 70, 110, 150, 240, 360] },
  { m: 'backOverhead', label: '백 오버헤드', times: [0, 70, 110, 150, 240, 490] },
  { m: 'backDrive', label: '백 드라이브', times: [0, 70, 110, 150, 240, 360] },
  { m: 'backUnder', label: '백 언더', times: [0, 70, 120, 170, 260, 380] },
  { m: 'backNet', label: '백 네트', times: [0, 80, 135, 190, 280, 370] },
  { m: 'round', label: '라운드 더 헤드', times: [0, 80, 120, 160, 250, 490] },
  { m: 'lunge', label: '런지', times: [0, 130, 260, 390, 590] },
];

export default function RigFilmstrip() {
  const zeroPose = useSharedValue(0);
  const zeroRun = useSharedValue(0);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#DFF0E6' }} contentContainerStyle={{ padding: 12 }}>
      {STRIPS.map((row) => (
        <View key={row.m} style={s.row}>
          <Text style={s.label}>{row.label}</Text>
          <View style={s.cells}>
            {row.times.map((t) => (
              <View key={t} style={s.cell}>
                <RigCharacter variant="male" poseMode={zeroPose} runFrame={zeroRun} freeze={poseAt(row.m, t)} />
                <Text style={s.t}>{t}ms</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { marginBottom: 10 },
  label: { fontSize: 13, fontWeight: '700', color: '#1F3B4D', marginBottom: 2 },
  cells: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: { alignItems: 'center', backgroundColor: '#EDF7F0', borderRadius: 8, padding: 3 },
  t: { fontSize: 9, color: '#6B8296' },
});
