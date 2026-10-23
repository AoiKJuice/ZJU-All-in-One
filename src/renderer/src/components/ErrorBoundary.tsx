import { Component, type ReactNode } from 'react'

/** 局部出错只影响这一块：显示一行安静的提示与重试，不让整个应用白屏 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error(error)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <p className="quiet page">
        出错了
        <button onClick={() => this.setState({ error: null })}>重试</button>
      </p>
    )
  }
}
