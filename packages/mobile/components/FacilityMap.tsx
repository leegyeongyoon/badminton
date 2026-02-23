import { StyleSheet, View, Text, ViewStyle } from 'react-native';
import MapView, { Marker, Callout, Region } from 'react-native-maps';
import { Colors } from '../constants/colors';

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

export default function FacilityMap({
  facilities,
  onFacilitySelect,
  userLocation,
  style,
}: FacilityMapProps) {
  const facilitiesWithCoords = facilities.filter(
    (f) => f.latitude != null && f.longitude != null
  );

  const getInitialRegion = (): Region => {
    if (userLocation) {
      return {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    if (facilitiesWithCoords.length > 0) {
      return {
        latitude: facilitiesWithCoords[0].latitude!,
        longitude: facilitiesWithCoords[0].longitude!,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    // Default: Seoul
    return {
      latitude: 37.5665,
      longitude: 126.978,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    };
  };

  return (
    <MapView
      style={[styles.map, style]}
      initialRegion={getInitialRegion()}
      showsUserLocation={!!userLocation}
      showsMyLocationButton={!!userLocation}
    >
      {facilitiesWithCoords.map((facility) => (
        <Marker
          key={facility.id}
          coordinate={{
            latitude: facility.latitude!,
            longitude: facility.longitude!,
          }}
          pinColor={facility.hasOpenSession ? Colors.secondary : Colors.primary}
        >
          <Callout onPress={() => onFacilitySelect(facility)}>
            <View style={styles.callout}>
              <Text style={styles.calloutTitle}>{facility.name}</Text>
              <Text style={styles.calloutAddress}>{facility.address}</Text>
              {facility.courtCount != null && (
                <Text style={styles.calloutDetail}>
                  {facility.courtCount}코트
                  {facility.hasOpenSession ? ' | 운영중' : ''}
                </Text>
              )}
              <Text style={styles.calloutAction}>탭하여 선택</Text>
            </View>
          </Callout>
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  callout: {
    minWidth: 160,
    padding: 4,
  },
  calloutTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  calloutAddress: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  calloutDetail: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '500',
    marginBottom: 4,
  },
  calloutAction: {
    fontSize: 11,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: 2,
  },
});
