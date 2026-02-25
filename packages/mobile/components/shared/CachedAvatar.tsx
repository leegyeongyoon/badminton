/**
 * CachedAvatar - Avatar component with LRU cache tracking.
 * Uses the in-memory LRU cache to track loaded avatar URLs
 * and wraps Image with a loading placeholder.
 */
import React, { useState, useEffect } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { avatarCache } from '../../utils/cache';
import { palette } from '../../constants/theme';

interface CachedAvatarProps {
  name: string;
  avatarUrl: string;
  size?: number;
}

function CachedAvatarInner({ name, avatarUrl, size = 24 }: CachedAvatarProps) {
  const { colors } = useTheme();
  const [loaded, setLoaded] = useState(() => avatarCache.has(avatarUrl));
  const colorIndex = name.charCodeAt(0) % colors.avatarColors.length;
  const bg = colors.avatarColors[colorIndex];

  useEffect(() => {
    if (avatarCache.has(avatarUrl)) {
      setLoaded(true);
    }
  }, [avatarUrl]);

  const handleLoad = () => {
    avatarCache.set(avatarUrl, avatarUrl);
    setLoaded(true);
  };

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
        },
      ]}
    >
      {/* Placeholder initial while loading */}
      {!loaded && (
        <View style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
          <View style={styles.placeholderInner}>
            {/* Show first character as fallback */}
          </View>
        </View>
      )}
      <Image
        source={{ uri: avatarUrl }}
        style={[
          styles.image,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            opacity: loaded ? 1 : 0,
          },
        ]}
        onLoad={handleLoad}
      />
    </View>
  );
}

function arePropsEqual(prev: CachedAvatarProps, next: CachedAvatarProps): boolean {
  return prev.name === next.name && prev.avatarUrl === next.avatarUrl && prev.size === next.size;
}

export const CachedAvatar = React.memo(CachedAvatarInner, arePropsEqual);

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  placeholder: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderInner: {
    width: '100%',
    height: '100%',
  },
  image: {
    position: 'absolute',
  },
});
