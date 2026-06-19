/**
 * Geolocation utilities.
 * Haversine distance helpers + a graceful current-position getter that
 * degrades safely on web and when permission is denied/unavailable.
 */
import * as Location from 'expo-location';

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance between two coordinates, in kilometers.
 */
export function getDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Great-circle distance between two coordinates, in meters.
 */
export function getDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  return getDistanceKm(lat1, lon1, lat2, lon2) * 1000;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Requests foreground location permission and returns the current position.
 * Returns null when permission is denied or location is unavailable.
 *
 * On web this still works via expo-location's navigator.geolocation shim,
 * but never throws — any failure simply yields null.
 */
export async function getCurrentPosition(): Promise<Coordinates | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  } catch {
    // Permission denied, location services off, or unavailable (e.g. web) —
    // degrade gracefully.
    return null;
  }
}
