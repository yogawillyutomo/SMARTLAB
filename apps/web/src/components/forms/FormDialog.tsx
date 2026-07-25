import type { ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  onSubmit?: () => void;
  submitLabel?: string;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  submitDisabled?: boolean;
}

export function FormDialog({ open, onClose, title, description, children, onSubmit, submitLabel = 'Simpan', loading, size = 'md', submitDisabled }: FormDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        onSubmit ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button onClick={onSubmit} loading={loading} disabled={submitDisabled}>
              {submitLabel}
            </Button>
          </>
        ) : undefined
      }
    >
      {children}
    </Modal>
  );
}
