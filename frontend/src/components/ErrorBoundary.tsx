import { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'Unexpected error' };
  }

  componentDidCatch(error: Error) {
    console.error('Unhandled UI error:', error);
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-red-100 rounded-xl shadow-sm p-6">
            <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
            <p className="text-sm text-gray-600 mt-2">
              The UI hit an unexpected error. Please retry. If this keeps happening, refresh the page.
            </p>
            {this.state.message ? (
              <p className="text-xs text-red-700 mt-3 bg-red-50 rounded px-3 py-2">
                {this.state.message}
              </p>
            ) : null}
            <div className="mt-4 flex gap-3">
              <button onClick={this.handleRetry} className="btn-primary">
                Retry
              </button>
              <button onClick={() => window.location.reload()} className="btn-secondary">
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
