import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { Colors } from '../../constants/colors';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textLight,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
        },
        headerStyle: {
          backgroundColor: Colors.surface,
        },
        headerTitleStyle: {
          color: Colors.text,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '현황판',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📋</Text>,
        }}
      />
      <Tabs.Screen
        name="automatch"
        options={{
          title: '대기/매칭',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🔀</Text>,
        }}
      />
      <Tabs.Screen
        name="mygame"
        options={{
          title: '내 게임',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏸</Text>,
        }}
      />
      <Tabs.Screen
        name="clubs"
        options={{
          title: '모임',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>👥</Text>,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: '더보기',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>☰</Text>,
        }}
      />
      {/* Hidden tabs - still exist as files but not shown in tab bar */}
      <Tabs.Screen
        name="checkin"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '내 정보',
          href: null,
        }}
      />
    </Tabs>
  );
}
