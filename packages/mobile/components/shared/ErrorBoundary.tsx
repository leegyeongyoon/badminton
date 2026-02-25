import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { ErrorFallback } from './ErrorFallback';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack || null });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  render() {
    if (this.state.hasError) {
      // In dev mode on web, show the component stack to help debug
      if (__DEV__ && Platform.OS === 'web' && this.state.componentStack) {
        return (
          <ScrollView style={debugStyles.container}>
            <Text style={debugStyles.title}>Error: {this.state.error?.message}</Text>
            <Text style={debugStyles.label}>Component Stack:</Text>
            <Text style={debugStyles.stack}>{this.state.componentStack}</Text>
            <Text style={debugStyles.label}>JS Stack:</Text>
            <Text style={debugStyles.stack}>{this.state.error?.stack}</Text>
          </ScrollView>
        );
      }

      return this.props.fallback || (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}

const debugStyles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#1a1a2e' },
  title: { color: '#ff6b6b', fontSize: 16, fontWeight: '700', marginBottom: 16 },
  label: { color: '#feca57', fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 4 },
  stack: { color: '#dfe6e9', fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },
});
