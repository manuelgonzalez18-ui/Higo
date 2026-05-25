import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import './Modal.css';

/**
 * Higo Shop — Modal
 *
 * @param {boolean}       isOpen
 * @param {() => void}    onClose
 * @param {string}        title
 * @param {React.ReactNode} children
 */
export function Modal({ isOpen, onClose, title, children }) {
  /* Lock body scroll when open */
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  /* Close on Escape */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="higo-modal__backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          aria-modal="true"
          role="dialog"
        >
          <motion.div
            className="higo-modal__content"
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.97 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          >
            <div className="higo-modal__header">
              <h2 className="higo-modal__title">{title}</h2>
              <button
                className="higo-modal__close"
                onClick={onClose}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="higo-modal__body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
