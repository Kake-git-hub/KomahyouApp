// 日程表ポップアウト: 子ウィンドウ(window.open)の body へ React portal で描画する
// (spec-schedule-interactive-view §C-1)。中身は親と同一 React ツリーのため、盤面 state・
// ハンドラをそのまま共有できる(postMessage 不要・バージョンスキューなし)。
// ライフサイクル: 子を閉じたら onClose、親の離脱(リロード)時は子を道連れに閉じて孤児化を防ぐ。
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

// 親 document.head の <style>/<link rel=stylesheet> を子ウィンドウへ複製する。
// このアプリは素の CSS のみ(CSS-in-JS 不使用)なので、これで見た目が移送できる。
// 動的追加(開発時HMR等)にも MutationObserver で追随する。
function copyStylesIntoWindow(childWindow: Window) {
  const childDocument = childWindow.document
  const copyNode = (node: Element) => {
    if (node instanceof HTMLStyleElement) {
      const clone = childDocument.createElement('style')
      clone.textContent = node.textContent
      childDocument.head.appendChild(clone)
      return
    }
    if (node instanceof HTMLLinkElement && node.rel === 'stylesheet') {
      const clone = childDocument.createElement('link')
      clone.rel = 'stylesheet'
      clone.href = node.href
      childDocument.head.appendChild(clone)
    }
  }
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(copyNode)
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((added) => {
        if (added instanceof Element) copyNode(added)
      })
    })
  })
  observer.observe(document.head, { childList: true })
  return observer
}

export type PopoutWindowProps = {
  title: string
  onClose: () => void
  // ポップアップブロック等でウィンドウ自体を開けなかったとき(開けた後に閉じたのとは区別)。
  // 未指定なら onClose にフォールバックする。
  onOpenBlocked?: () => void
  children: ReactNode
}

export function PopoutWindow({ title, onClose, onOpenBlocked, children }: PopoutWindowProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const onOpenBlockedRef = useRef(onOpenBlocked)
  const titleRef = useRef(title)
  useEffect(() => {
    onCloseRef.current = onClose
    onOpenBlockedRef.current = onOpenBlocked
    titleRef.current = title
  })

  useEffect(() => {
    const childWindow = window.open('', '', 'width=1280,height=860,resizable=yes,scrollbars=yes')
    if (!childWindow) {
      // ポップアップブロック等で開けない場合はポップアウトを諦める(既定はビューを閉じる)。
      ;(onOpenBlockedRef.current ?? onCloseRef.current)()
      return
    }
    childWindow.document.title = titleRef.current
    const meta = childWindow.document.createElement('meta')
    meta.setAttribute('charset', 'utf-8')
    childWindow.document.head.appendChild(meta)
    childWindow.document.body.style.margin = '0'
    childWindow.document.body.className = 'schedule-popout-body'
    const observer = copyStylesIntoWindow(childWindow)
    const root = childWindow.document.createElement('div')
    root.className = 'schedule-popout-root'
    childWindow.document.body.appendChild(root)
    // 子ウィンドウ生成は副作用そのもので、createPortal の描画先はこの effect でしか得られない。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContainer(root)

    // 子ウィンドウが閉じられたことの検知は closed のポーリングが最も確実
    // (beforeunload はリロードや DevTools でも発火し誤検知するため)。
    const closeWatcher = window.setInterval(() => {
      if (childWindow.closed) {
        window.clearInterval(closeWatcher)
        onCloseRef.current()
      }
    }, 500)

    // 親のリロード/離脱時は子を閉じ、操作不能な孤児ウィンドウを残さない。
    const handleParentPageHide = () => {
      try {
        childWindow.close()
      } catch {
        // すでに閉じている場合は何もしない
      }
    }
    window.addEventListener('pagehide', handleParentPageHide)

    return () => {
      window.removeEventListener('pagehide', handleParentPageHide)
      window.clearInterval(closeWatcher)
      observer.disconnect()
      setContainer(null)
      try {
        if (!childWindow.closed) childWindow.close()
      } catch {
        // クロスウィンドウ close 失敗は無視(すでに閉じている等)
      }
    }
  }, [])

  return container ? createPortal(children, container) : null
}
