import './BottomSheet.css';
import { motion, AnimatePresence } from 'framer-motion';

export function BottomSheet({ isOpen, onClose, title, children, height = 'auto' }) {
  const heightMap = { auto: 'auto', half: '50dvh', full: '92dvh' };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="higo-bottomsheet__backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className={`higo-bottomsheet higo-bottomsheet--${height}`}
            style={{ maxHeight: heightMap[height] }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            <div className="higo-bottomsheet__handle" onClick={onClose}>
              <div className="higo-bottomsheet__handle-bar" />
            </div>
            {title && <div className="higo-bottomsheet__title">{title}</div>}
            <div className="higo-bottomsheet__content">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
