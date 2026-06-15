import React from 'react';

interface State {
  error: Error | null;
}

/**
 * 최상위 에러 바운더리.
 * 장시간 떠 있는 트레이/팝오버 앱이라, 렌더 throw 하나로 전체 화면이 백지가 되면
 * 사용자는 앱을 종료/재실행하는 것 외엔 복구할 방법이 없다.
 * 여기서 잡아 안내 + '다시 시도'(재마운트) 버튼을 제공한다.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[renderer] uncaught render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={wrap}>
          <h3 style={{ margin: '0 0 8px' }}>화면 오류가 발생했습니다</h3>
          <p style={{ opacity: 0.7, fontSize: 13, margin: '0 0 12px' }}>
            아래 '다시 시도'를 누르거나 트레이에서 창을 다시 열어보세요.
          </p>
          <pre style={pre}>{String(this.state.error?.message || this.state.error)}</pre>
          <button className="btn-primary" onClick={() => this.setState({ error: null })}>
            다시 시도
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const wrap: React.CSSProperties = {
  padding: 20,
  color: '#e6e8ec',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const pre: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 12,
  opacity: 0.8,
  background: '#1c2028',
  border: '1px solid #3a4150',
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
  maxHeight: 240,
  overflow: 'auto',
};
