import React from 'react';
import { StyleSheet, FlatList, ScrollView, View, Platform, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { CourtConeCard } from './CourtConeCard';
import { AnimatedRefreshControl } from '../ui/AnimatedRefreshControl';
import { useStableCallback } from '../../utils/performance';
import { useTheme } from '../../hooks/useTheme';
import { spacing } from '../../constants/theme';

interface CourtGridProps {
  data: any[];
  isLoading: boolean;
  onRefresh: () => void;
  isCheckedIn: boolean;
  currentUserId?: string;
  onCourtPress: (courtId: string) => void;
  ListHeaderComponent?: React.ReactElement;
}

export function CourtGrid({
  data,
  isLoading,
  onRefresh,
  isCheckedIn,
  currentUserId,
  onCourtPress,
  ListHeaderComponent,
}: CourtGridProps) {
  const { colors } = useTheme();

  const renderItem = useStableCallback(
    ({ item, index }: { item: any; index: number }) => (
      <CourtConeCard
        court={item.court}
        turns={item.turns || []}
        maxTurns={item.maxTurns || 3}
        clubSessionInfo={item.clubSessionInfo}
        isCheckedIn={isCheckedIn}
        currentUserId={currentUserId}
        onPress={onCourtPress}
        index={index}
      />
    ),
  );

  const keyExtractor = useStableCallback((item: any) => item.court.id);

  // Web: use ScrollView with manual 2-column grid (FlatList/FlashList unreliable on web)
  if (Platform.OS === 'web') {
    const rows: any[][] = [];
    for (let i = 0; i < data.length; i += 2) {
      rows.push(data.slice(i, i + 2));
    }

    return (
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {ListHeaderComponent}
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((item, colIndex) => {
              const index = rowIndex * 2 + colIndex;
              return (
                <View key={item.court.id} style={styles.col}>
                  {renderItem({ item, index })}
                </View>
              );
            })}
            {row.length === 1 && <View style={styles.col} />}
          </View>
        ))}
      </ScrollView>
    );
  }

  // Native: use FlashList for best performance
  return (
    <FlashList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={2}
      estimatedItemSize={180}
      drawDistance={300}
      contentContainerStyle={styles.list}
      ListHeaderComponent={ListHeaderComponent}
      refreshControl={
        <AnimatedRefreshControl refreshing={isLoading} onRefresh={onRefresh} />
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  list: {
    padding: spacing.lg,
    paddingBottom: 80,
  },
  row: {
    flexDirection: 'row',
  },
  col: {
    flex: 1,
  },
});
