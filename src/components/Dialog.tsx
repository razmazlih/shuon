import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
export function Dialog({
  title,
  onClose,
  onBack,
  children,
  className,
  transitionFrom,
  closeDisabled = false,
}: {
  title: string
  onClose?: () => void
  onBack?: () => void
  children: ReactNode
  className?: string
  transitionFrom?: DOMRect
  closeDisabled?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    const previousFocus = document.activeElement
    dialog.showModal()
    const old = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = old
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true })
    }
  }, [])
  useLayoutEffect(() => {
    if (!transitionFrom) return
    const dialog = ref.current!
    if (!dialog.open) return
    dialog.querySelector<HTMLButtonElement>('.modal-header button')?.focus({ preventScroll: true })
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const next = dialog.getBoundingClientRect()
    const x = transitionFrom.left + transitionFrom.width / 2 - next.left - next.width / 2
    const y = transitionFrom.top + transitionFrom.height / 2 - next.top - next.height / 2
    const animation = dialog.animate(
      [
        { transform: `translate(${x}px, ${y}px) scale(${transitionFrom.width / next.width}, ${transitionFrom.height / next.height})` },
        { transform: 'none' },
      ],
      { duration: 220, easing: 'ease-out' },
    )
    return () => animation.cancel()
  }, [transitionFrom])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={className ? 'modal ' + className : 'modal'}
      onCancel={(e) => {
        e.preventDefault()
        if (!closeDisabled) (onBack ?? onClose)?.()
      }}
      onClick={(e) => {
        if (!closeDisabled && e.target === ref.current) {
          const rect = ref.current!.getBoundingClientRect()
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose?.()
        }
      }}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        {onBack && (
          <button type="button" className="btn secondary" disabled={closeDisabled} onClick={onBack}>
            חזרה לטופס
          </button>
        )}
        {onClose && !onBack && (
          <button className="icon-btn" aria-label="סגירה" disabled={closeDisabled} onClick={onClose}>
            <X size={20} />
          </button>
        )}
      </div>
      {children}
    </dialog>
  )
}
