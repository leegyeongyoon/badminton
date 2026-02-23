import React, { useCallback } from 'react';
import { FlatList, StyleSheet, RefreshControl } from 'react-native';
import { CourtCard } from './CourtCard';

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
  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <CourtCard
        court={item.court}
        turns={item.turns || []}
        maxTurns={item.maxTurns || 3}
        clubSessionInfo={item.clubSessionInfo}
        isCheckedIn={isCheckedIn}
        currentUserId={currentUserId}
        onPress={onCourtPress}
      />
    ),
    [isCheckedIn, currentUserId, onCourtPress],
  );

  const keyExtractor = useCallback((item: any) => item.court.id, []);

  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={2}
      contentContainerStyle={styles.list}
      columnWrapperStyle={styles.row}
      ListHeaderComponent={ListHeaderComponent}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={onRefresh} />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 8,
  },
  row: {
    justifyContent: 'space-between',
  },
});
