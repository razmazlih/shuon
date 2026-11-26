import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
export function Dialog({
  title,
  onClose,
  children,
  className,
  closeDisabled = false,
}: {
  title: string
  onClose?: () => void
  children: ReactNode
  className?: string
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
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={className ? 'modal ' + className : 'modal'}
      onCancel={(e) => {
        e.preventDefault()
        if (!closeDisabled) onClose?.()
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
        {onClose && (
          <button className="icon-btn" aria-label="סגירה" disabled={closeDisabled} onClick={onClose}>
            <X size={20} />
          </button>
        )}
      </div>
      {children}
    </dialog>
  )
}
