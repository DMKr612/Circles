import React from 'react';

type State = { hasError: boolean; message?: string };

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(err: unknown): State {
    const msg = err instanceof Error ? err.message : String(err);
    return { hasError: true, message: msg };
  }
  componentDidCatch(err: unknown, info: unknown) {
    console.error('App crashed:', err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh flow-root">
          <div className="mx-auto max-w-xl p-6 text-sm">
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
              Something went wrong.
            </div>
            <div className="rounded-md border border-black/10 bg-white p-3 text-neutral-700">
              {this.state.message || 'Unknown error'}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}