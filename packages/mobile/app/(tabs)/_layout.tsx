import { useEffect, useState, useCallback } from 'react';
import { Tabs } from 'expo-router';
import { Text, View, StyleSheet } from 'react-native';
import { useFacilityStore } from '../../store/facilityStore';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import api from '../../services/api';

function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={badgeStyles.container}>
      <Text style={badgeStyles.text}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: Colors.danger,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});

export default function TabsLayout() {
  const { selectedFacility } = useFacilityStore();
  const facilityName = selectedFacility?.name || '';
  const [unreadCount, setUnreadCount] = useState(0);

  const loadUnreadCount = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications', { params: { limit: 50 } });
      setUnreadCount(
        Array.isArray(data) ? data.filter((n: any) => !n.read).length : 0,
      );
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [loadUnreadCount]);

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
      {/* Tab 1: Board */}
      <Tabs.Screen
        name="index"
        options={{
          title: facilityName || Strings.tabs.board,
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📋</Text>,
        }}
      />
      {/* Tab 2: Activity (replaces mygame) */}
      <Tabs.Screen
        name="activity"
        options={{
          title: Strings.tabs.activity,
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏸</Text>,
        }}
      />
      {/* Tab 3: Settings (replaces more + clubs) */}
      <Tabs.Screen
        name="settings"
        options={{
          title: Strings.tabs.settings,
          tabBarIcon: ({ color }) => (
            <View>
              <Text style={{ color, fontSize: 20 }}>⚙️</Text>
              <TabBadge count={unreadCount} />
            </View>
          ),
        }}
      />
      {/* Hidden tabs - files exist but not shown in tab bar */}
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
      {/* Hide old tabs that still exist as files (will be deleted in cleanup) */}
      <Tabs.Screen
        name="mygame"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="clubs"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
