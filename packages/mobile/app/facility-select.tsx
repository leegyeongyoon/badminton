import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useFacilityStore } from '../store/facilityStore';
import KakaoMap from '../components/KakaoMap';
import { Colors } from '../constants/colors';
import { createShadow } from '../constants/theme';
import { Strings } from '../constants/strings';

type ViewMode = 'list' | 'map';

interface FacilityItem {
  id: string;
  name: string;
  address: string;
  courtCount?: number;
  hasOpenSession?: boolean;
  checkedInCount?: number;
  latitude?: number;
  longitude?: number;
}

interface UserLocation {
  latitude: number;
  longitude: number;
}

function getDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function FacilitySelectScreen() {
  const router = useRouter();
  const { facilities, fetchFacilities, selectFacility, isLoading } =
    useFacilityStore();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);

  useEffect(() => {
    fetchFacilities();
    requestLocation();
  }, []);

  const requestLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
    } catch {
      // Location unavailable - continue without it
    }
  };

  const handleSelect = useCallback(
    async (facility: FacilityItem) => {
      await selectFacility(facility);
      router.replace('/(tabs)');
    },
    [selectFacility, router]
  );

  const filteredFacilities = (facilities as FacilityItem[]).filter((f) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      f.name.toLowerCase().includes(q) || f.address.toLowerCase().includes(q)
    );
  });

  const sortedFacilities = [...filteredFacilities].sort((a, b) => {
    if (!userLocation) return 0;
    const distA =
      a.latitude != null && a.longitude != null
        ? getDistanceKm(
            userLocation.latitude,
            userLocation.longitude,
            a.latitude,
            a.longitude
          )
        : Infinity;
    const distB =
      b.latitude != null && b.longitude != null
        ? getDistanceKm(
            userLocation.latitude,
            userLocation.longitude,
            b.latitude,
            b.longitude
          )
        : Infinity;
    return distA - distB;
  });

  const formatDistance = (facility: FacilityItem): string | null => {
    if (
      !userLocation ||
      facility.latitude == null ||
      facility.longitude == null
    )
      return null;
    const dist = getDistanceKm(
      userLocation.latitude,
      userLocation.longitude,
      facility.latitude,
      facility.longitude
    );
    if (dist < 1) return `${Math.round(dist * 1000)}m`;
    return `${dist.toFixed(1)}km`;
  };

  const renderFacilityItem = ({ item }: { item: FacilityItem }) => {
    const distance = formatDistance(item);
    return (
      <TouchableOpacity
        style={styles.facilityCard}
        onPress={() => handleSelect(item)}
        activeOpacity={0.7}
      >
        <View style={styles.facilityCardContent}>
          <View style={styles.facilityInfo}>
            <Text style={styles.facilityName}>{item.name}</Text>
            <Text style={styles.facilityAddress}>{item.address}</Text>
            <View style={styles.facilityMeta}>
              {item.courtCount != null && (
                <Text style={styles.facilityMetaText}>
                  {item.courtCount}코트
                </Text>
              )}
              {item.hasOpenSession && (
                <View style={styles.sessionBadge}>
                  <Text style={styles.sessionBadgeText}>운영중</Text>
                </View>
              )}
            </View>
          </View>
          {distance && (
            <View style={styles.distanceBadge}>
              <Text style={styles.distanceText}>{distance}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{Strings.facility.select}</Text>
        <Text style={styles.headerSubtitle}>
          {Strings.facility.selectDescription}
        </Text>
      </View>

      {/* View mode toggle */}
      <View style={styles.toggleContainer}>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            viewMode === 'list' && styles.toggleButtonActive,
          ]}
          onPress={() => setViewMode('list')}
        >
          <Text
            style={[
              styles.toggleText,
              viewMode === 'list' && styles.toggleTextActive,
            ]}
          >
            {Strings.facility.listView}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            viewMode === 'map' && styles.toggleButtonActive,
          ]}
          onPress={() => setViewMode('map')}
        >
          <Text
            style={[
              styles.toggleText,
              viewMode === 'map' && styles.toggleTextActive,
            ]}
          >
            {Strings.facility.mapView}
          </Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'list' ? (
        <>
          {/* Search bar */}
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder={Strings.facility.searchPlaceholder}
              placeholderTextColor={Colors.textLight}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {/* Facility list */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : (
            <FlatList
              data={sortedFacilities}
              renderItem={renderFacilityItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    {Strings.facility.noFacilities}
                  </Text>
                </View>
              }
            />
          )}
        </>
      ) : (
        <KakaoMap
          facilities={facilities as FacilityItem[]}
          onFacilitySelect={handleSelect}
          userLocation={userLocation}
          style={styles.mapContainer}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.surface,
    paddingTop: Platform.OS === 'ios' ? 60 : 48,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  toggleContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: Colors.divider,
    borderRadius: 10,
    padding: 3,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleButtonActive: {
    backgroundColor: Colors.surface,
    ...createShadow(1, 2, 0.1, 2),
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textLight,
  },
  toggleTextActive: {
    color: Colors.primary,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  listContent: {
    padding: 16,
    paddingTop: 4,
  },
  facilityCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    ...createShadow(1, 4, 0.06, 2),
  },
  facilityCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  facilityInfo: {
    flex: 1,
  },
  facilityName: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  facilityAddress: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  facilityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  facilityMetaText: {
    fontSize: 13,
    color: Colors.textLight,
    fontWeight: '500',
  },
  sessionBadge: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sessionBadgeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  distanceBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 12,
  },
  distanceText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    paddingTop: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  mapContainer: {
    flex: 1,
    margin: 16,
    borderRadius: 14,
    overflow: 'hidden',
  },
});
