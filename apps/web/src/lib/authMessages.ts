import type { AuthIssue } from '@/stores/authStore';

export function authIssueMessage(issue: AuthIssue | null): string {
  if (!issue) return '';

  switch (issue.code) {
    case 'INVALID_CREDENTIALS':
      return 'Email atau password tidak valid.';
    case 'VALIDATION_FAILED':
      return 'Periksa kembali email, password, dan pilihan ingat saya.';
    case 'TOO_MANY_LOGIN_ATTEMPTS':
      return issue.retryAfter
        ? `Terlalu banyak percobaan masuk. Coba lagi dalam ${issue.retryAfter} detik.`
        : 'Terlalu banyak percobaan masuk. Silakan coba lagi nanti.';
    case 'ACTIVE_MEMBERSHIP_REQUIRED':
      return 'Akun ini belum memiliki keanggotaan sekolah aktif. Hubungi administrator.';
    case 'SCHOOL_CONTEXT_REQUIRED':
      return 'Akun memiliki lebih dari satu konteks sekolah aktif. Pemilihan sekolah belum tersedia.';
    case 'UNSUPPORTED_ROLE':
      return 'Role akun belum didukung oleh antarmuka SmartLab. Hubungi administrator.';
    case 'AUTH_SERVICE_UNAVAILABLE':
      return 'Layanan autentikasi sedang tidak dapat dijangkau. Periksa koneksi lalu coba lagi.';
    case 'CSRF_RETRY_FAILED':
      return 'Sesi keamanan tidak dapat diperbarui. Muat ulang sesi lalu coba lagi.';
    case 'UNEXPECTED_RESPONSE':
      return 'Server mengembalikan respons yang tidak dikenali. Silakan coba lagi.';
    default:
      return 'Autentikasi tidak dapat diselesaikan. Silakan coba lagi.';
  }
}
