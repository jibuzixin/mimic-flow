import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="h-full w-full bg-red-50 flex items-center justify-center p-8">
          <div className="bg-white p-8 rounded-xl shadow-lg max-w-lg w-full">
            <h2 className="text-xl font-bold text-red-600 mb-4">渲染出错</h2>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-red-700 font-mono text-sm">
                {this.state.error?.message}
              </p>
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gray-500">错误详情</summary>
              <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-64">
                {this.state.error?.stack}
              </pre>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
