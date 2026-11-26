import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose?: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    const old = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = old
    }
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      className="modal"
      onCancel={(e) => {
        e.preventDefault()
        onClose?.()
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
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
        <h2 id="dialog-title">{title}</h2>
        {onClose && (
          <button className="icon-btn" aria-label="סגירה" onClick={onClose}>
            <X size={20} />
          </button>
        )}
      </div>
      {children}
    </dialog>
  )
}
